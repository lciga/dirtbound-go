// The states received for one remote car, sampled at a race time: linear
// interpolation between the two around it, a short extrapolation past the
// last one (lost packets), then frozen. Pure, no three.js.
// The car is drawn `delay` in the past, a delay that follows the lag really
// seen on this connection: long enough that the next state is (nearly) always
// there, so the car is interpolated, not extrapolated and pulled back.

export const INTERP_DELAY = 0.1; // s: shortest delay a remote car is drawn in the past
export const MAX_DELAY = 0.5; // s: longest
const DELAY_MARGIN = 0.02; // s above the worst wait seen
const DELAY_UP = 0.25; // s of delay gained per s (the car plays back at 75 % speed meanwhile)
const DELAY_DOWN = 0.05; // s of delay lost per s (105 % speed)
const WAITS_KEPT = 40; // arrivals (2 s at 20 per second)
export const MAX_EXTRAPOLATION = 0.25; // s
const MAX_TRACK_SPEED = 100; // m/s between two states: faster is a respawn, never extrapolated
export const MAX_PREDICTION = 0.2; // s past the last state, for collisions (where the car is now)
const HISTORY = 40; // states kept (2 s at 20 per second)
const FIELDS = [ 'x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'st', 'sp', 'p' ];

function mix( a, b, t ) {

	const out = { rt: a.rt + ( b.rt - a.rt ) * t };
	for ( const k of FIELDS ) out[ k ] = a[ k ] + ( b[ k ] - a[ k ] ) * t;

	// Quaternions: take the short way, then renormalise (nlerp)
	if ( a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw < 0 ) {

		for ( const k of [ 'qx', 'qy', 'qz', 'qw' ] ) out[ k ] = a[ k ] + ( - b[ k ] - a[ k ] ) * t;

	}

	const n = Math.hypot( out.qx, out.qy, out.qz, out.qw ) || 1;
	for ( const k of [ 'qx', 'qy', 'qz', 'qw' ] ) out[ k ] /= n;
	return out;

}

export class RemoteTrack {

	constructor() {

		this.samples = [];
		this.waits = []; // s: how old the newest state was when the next one arrived
		this.delay = INTERP_DELAY;

	}

	// now: this player's race time when the state arrived (measures the lag)
	push( state, now = null ) {

		const last = this.samples[ this.samples.length - 1 ];
		if ( last && state.rt <= last.rt ) return false;
		this.samples = [ ...this.samples.slice( - ( HISTORY - 1 ) ), state ];
		if ( last && now !== null ) this.waits = [ ...this.waits.slice( - ( WAITS_KEPT - 1 ) ), now - last.rt ];
		return true;

	}

	// The delay that would have kept the car interpolated over the last arrivals
	targetDelay() {

		const worst = this.waits.length ? Math.max( ...this.waits ) : 0;
		return Math.min( MAX_DELAY, Math.max( INTERP_DELAY, worst + DELAY_MARGIN ) );

	}

	// Once per drawn frame: the delay eases towards its target (no jump in time)
	updateDelay( dt ) {

		const d = this.targetDelay() - this.delay;
		this.delay += d > 0 ? Math.min( d, DELAY_UP * dt ) : Math.max( d, - DELAY_DOWN * dt );
		return this.delay;

	}

	// Where the car is drawn (no collisions): delay in the past
	display( rt ) {

		return this.sample( rt - this.delay );

	}

	latest() {

		return this.samples[ this.samples.length - 1 ] || null;

	}

	// Velocity (m/s) from the last two states; zero before two states or across a respawn
	velocity() {

		const s = this.samples;
		if ( s.length < 2 ) return [ 0, 0, 0 ];
		const [ a, b ] = [ s[ s.length - 2 ], s[ s.length - 1 ] ];
		const dt = b.rt - a.rt;
		const v = [ ( b.x - a.x ) / dt, ( b.y - a.y ) / dt, ( b.z - a.z ) / dt ];
		return Math.hypot( v[ 0 ], v[ 2 ] ) > MAX_TRACK_SPEED ? [ 0, 0, 0 ] : v;

	}

	// Where the car probably is right now: the last motion carried forward,
	// at most maxAhead past the last state received
	predict( rt, maxAhead = MAX_PREDICTION ) {

		const last = this.latest();
		return last ? this.sample( Math.min( rt, last.rt + maxAhead ) ) : null;

	}

	sample( rt ) {

		const s = this.samples;
		if ( s.length === 0 ) return null;
		if ( s.length === 1 || rt <= s[ 0 ].rt ) return s[ rt <= s[ 0 ].rt ? 0 : s.length - 1 ];

		const last = s[ s.length - 1 ];

		if ( rt >= last.rt ) {

			const prev = s[ s.length - 2 ];
			const speed = Math.hypot( last.x - prev.x, last.z - prev.z ) / ( last.rt - prev.rt );
			if ( speed > MAX_TRACK_SPEED ) return last;
			const ahead = Math.min( rt - last.rt, MAX_EXTRAPOLATION );
			return mix( prev, last, 1 + ahead / ( last.rt - prev.rt ) );

		}

		let i = s.length - 2;
		while ( s[ i ].rt > rt ) i --;
		return mix( s[ i ], s[ i + 1 ], ( rt - s[ i ].rt ) / ( s[ i + 1 ].rt - s[ i ].rt ) );

	}

}
