// Ghost replay format, shared by the game (record / play back) and the
// leaderboard server (validate). Pure: no three.js, no DOM.
//
// A ghost is one lap sampled at GHOST_RATE Hz from the lap start. Each frame is
// [ x, y, z, qx, qy, qz, qw, steer ]: the car container position and
// quaternion, and the front wheel steer angle. On the wire the channels are
// quantized to integers and delta-encoded frame to frame, which keeps a one
// minute lap around 20 kB of JSON.

export const GHOST_VERSION = 1;
export const GHOST_RATE = 20; // Hz
export const GHOST_CHANNELS = 8;
export const GHOST_MAX_TIME = 600; // s, longest lap accepted
export const GHOST_MAX_SPEED = 35; // world units / s between two frames: the cars top out near 20 (23 seen in a record, 25 with the uncounted accelerator)

const SCALES = [ 100, 100, 100, 10000, 10000, 10000, 10000, 1000 ];
const MAX_FRAMES = GHOST_MAX_TIME * GHOST_RATE + 2;
const MAX_ABS = 1e7; // quantized value bound: positions within ±100 km

// The keys of the lap (added 2026-10-15), so a lap can be replayed step by step: a ghost may carry
//   keys:  { rate: 120, runs: [ code, count, code, count, … ] }  one code per physics step, run-length encoded
//   start: STATE_SIZE numbers (Vehicle.saveState) taken when the lap clock started
// keys[ 0 ] is the input of the first physics step after that moment, the last one is the step that
// crossed the finish line. Optional: older laps and clients have none; v stays 1 (they ignore the fields).
// code = ( x + 8 ) + 17 * ( ( z + 4 ) + 9 * flags ): x in eighths, z in quarters, flags = handbrake 1, boost 2, touch 4
export const KEYS_RATE = 120;
export const KEY_CODES = 17 * 9 * 8;
const KEYS_START_SIZE = 18; // Vehicle.STATE_SIZE
const KEYS_MAX_STEPS = GHOST_MAX_TIME * KEYS_RATE + 10;
const KEYS_TOLERANCE = 3; // steps between the claimed lap time and the recorded keys

export function keyCode( input ) {

	const x = Math.max( - 8, Math.min( 8, Math.round( ( input.x || 0 ) * 8 ) ) ) + 8;
	const z = Math.max( - 4, Math.min( 4, Math.round( ( input.z || 0 ) * 4 ) ) ) + 4;
	return x + 17 * ( z + 9 * ( ( input.handbrake ? 1 : 0 ) | ( input.boost ? 2 : 0 ) | ( input.touchActive ? 4 : 0 ) ) );

}

// The input a code stands for, as the game's Controls hand it to Vehicle.update
export function keyInput( code ) {

	const x = code % 17, rest = ( code - x ) / 17, z = rest % 9, flags = ( rest - z ) / 9;
	return { x: ( x - 8 ) / 8, z: ( z - 4 ) / 4, handbrake: ( flags & 1 ) !== 0, boost: ( flags & 2 ) !== 0, touchActive: ( flags & 4 ) !== 0 };

}

// One code per physics step, from the run-length form (throws when malformed)
export function decodeKeys( ghost, time = null ) {

	const { keys, start } = ghost;
	if ( ! keys || typeof keys !== 'object' || keys.rate !== KEYS_RATE ) throw new Error( 'keys: wrong rate' );
	const { runs } = keys;
	if ( ! Array.isArray( runs ) || runs.length === 0 || runs.length % 2 !== 0 || runs.length > 2 * KEYS_MAX_STEPS ) throw new Error( 'keys: bad runs' );
	if ( ! Array.isArray( start ) || start.length !== KEYS_START_SIZE || ! start.every( ( n ) => typeof n === 'number' && Number.isFinite( n ) && Math.abs( n ) < 1e7 ) ) throw new Error( 'keys: bad start' );

	const steps = [];

	for ( let i = 0; i < runs.length; i += 2 ) {

		const code = runs[ i ], count = runs[ i + 1 ];
		if ( ! Number.isInteger( code ) || code < 0 || code >= KEY_CODES ) throw new Error( 'keys: bad code' );
		if ( ! Number.isInteger( count ) || count < 1 || steps.length + count > KEYS_MAX_STEPS ) throw new Error( 'keys: bad count' );
		for ( let k = 0; k < count; k ++ ) steps.push( code );

	}

	if ( time !== null && Math.abs( steps.length - time * KEYS_RATE ) > KEYS_TOLERANCE ) throw new Error( 'keys: length does not match the time' );
	return steps;

}

export function encodeGhost( frames, keys = null ) {

	const data = [];
	const prev = new Array( GHOST_CHANNELS ).fill( 0 );

	for ( const frame of frames ) {

		for ( let c = 0; c < GHOST_CHANNELS; c ++ ) {

			const q = Math.round( frame[ c ] * SCALES[ c ] );
			data.push( q - prev[ c ] );
			prev[ c ] = q;

		}

	}

	const ghost = { v: GHOST_VERSION, rate: GHOST_RATE, data };
	if ( keys && keys.runs.length > 0 ) { ghost.keys = { rate: KEYS_RATE, runs: keys.runs }; ghost.start = keys.start; }
	return ghost;

}

// Throws on anything malformed: the input may come from the network
export function decodeGhost( ghost ) {

	if ( ! ghost || typeof ghost !== 'object' ) throw new Error( 'ghost: not an object' );
	if ( ghost.v !== GHOST_VERSION ) throw new Error( 'ghost: unknown version' );
	if ( ghost.rate !== GHOST_RATE ) throw new Error( 'ghost: wrong rate' );

	const { data } = ghost;
	if ( ! Array.isArray( data ) || data.length === 0 || data.length % GHOST_CHANNELS !== 0 ) throw new Error( 'ghost: bad data length' );
	if ( data.length / GHOST_CHANNELS > MAX_FRAMES ) throw new Error( 'ghost: too long' );

	const frames = [];
	const acc = new Array( GHOST_CHANNELS ).fill( 0 );

	for ( let i = 0; i < data.length; i += GHOST_CHANNELS ) {

		const frame = new Array( GHOST_CHANNELS );

		for ( let c = 0; c < GHOST_CHANNELS; c ++ ) {

			const d = data[ i + c ];
			if ( ! Number.isInteger( d ) ) throw new Error( 'ghost: non-integer value' );
			acc[ c ] += d;
			if ( Math.abs( acc[ c ] ) > MAX_ABS ) throw new Error( 'ghost: value out of range' );
			frame[ c ] = acc[ c ] / SCALES[ c ];

		}

		frames.push( frame );

	}

	return frames;

}

export function ghostDuration( frames ) {

	return Math.max( 0, frames.length - 1 ) / GHOST_RATE;

}

// Checks a decoded ghost against the lap time it claims: the recording must
// last as long as the lap and the car must never jump. Returns an error
// message, or null when the lap looks genuine. Deterrence, not proof.
export function checkGhost( frames, time ) {

	if ( frames.length < 2 ) return 'ghost too short';
	if ( Math.abs( ghostDuration( frames ) - time ) > 2 / GHOST_RATE ) return 'ghost length does not match the time';

	const maxStep = GHOST_MAX_SPEED / GHOST_RATE;

	for ( let i = 1; i < frames.length; i ++ ) {

		const a = frames[ i - 1 ];
		const b = frames[ i ];
		const step = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] );
		if ( step > maxStep ) return 'car moves too fast';

	}

	return null;

}

// Frame at time t (s), linearly interpolated; the rotation is renormalized by
// the caller (three.js slerp) so a plain lerp of the channels is enough here.
// Returns null past the end.
export function sampleGhost( frames, t, out ) {

	const f = t * GHOST_RATE;
	if ( f < 0 || f > frames.length - 1 ) return null;

	const i = Math.min( Math.floor( f ), frames.length - 2 );
	const k = f - i;
	const a = frames[ i ];
	const b = frames[ Math.min( i + 1, frames.length - 1 ) ];

	for ( let c = 0; c < GHOST_CHANNELS; c ++ ) out[ c ] = a[ c ] + ( b[ c ] - a[ c ] ) * k;

	return out;

}
