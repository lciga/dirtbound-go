// Where a bonus race puts its item boxes and its boost pads along the lap.
// Pure and seeded by the circuit's shape: every racer computes the same layout.
//
// Boxes: a row every 10 to 20 s of driving (ROW_TIME at AVG_SPEED), so a
// longer circuit has more of them; at least one per lap.
// Boost pads (Trackmania style): strips over part of the road's width, here
// and there along the lap, kept off the box rows and the start line.

import { ROAD_HALF } from '../SplineTrack.js';

export const AVG_SPEED = 15; // m/s: a racer's average over a lap (cars top out near 20)
export const ROW_TIME = [ 10, 20 ]; // s of driving between two rows of boxes
export const PAD_TIME = [ 4, 9 ]; // s of driving between two boost pads
export const PAD_LENGTH = 4; // m along the road
export const PAD_WIDTH = 2.6; // m across: about a third of the road
const PAD_LATERAL = ROAD_HALF - 0.9 - PAD_WIDTH / 2; // m: centre of a pad on one side
const PAD_CLEAR = 12; // m kept between a pad and a row of boxes or the start line
const PAD_MIN_RADIUS = 9; // m: no pad in a bend tighter than this (into the barrier)

function hash( a, b ) {

	let h = Math.imul( a | 0, 374761393 ) + Math.imul( b | 0, 668265263 );
	h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
	return ( h ^ ( h >>> 16 ) ) >>> 0;

}

function mulberry( seed ) {

	let t = seed >>> 0;

	return () => {

		t = ( t + 0x6D2B79F5 ) >>> 0;
		let r = Math.imul( t ^ ( t >>> 15 ), 1 | t );
		r = ( r + Math.imul( r ^ ( r >>> 7 ), 61 | r ) ) ^ r;
		return ( ( r ^ ( r >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// The circuit's own seed (its samples, rounded to 10 cm)
export function layoutSeed( path ) {

	let h = 0x51ed27;
	const step = Math.max( 1, Math.floor( path.sampleCount / 64 ) );
	for ( let i = 0; i < path.sampleCount; i += step ) h = hash( h ^ Math.round( path.px[ i ] * 10 ), Math.round( path.pz[ i ] * 10 ) );
	return h;

}

// Rows of boxes: distances past the start line, in race order ( 0 < d < L ).
// As few rows as keep every gap under ROW_TIME[ 1 ], evenly spread, each moved
// a little at random but never closer than ROW_TIME[ 0 ] nor farther than
// ROW_TIME[ 1 ] from the next (a lap shorter than that: one row)
export function boxRows( length, seed ) {

	const rand = mulberry( hash( seed, 1 ) );
	const n = Math.max( 1, Math.ceil( length / ( ROW_TIME[ 1 ] * AVG_SPEED ) ) );
	const gap = length / n;
	// how far a row may move each way and keep every gap within ROW_TIME
	const slack = n === 1 ? 0 : Math.max( 0, Math.min( gap - ROW_TIME[ 0 ] * AVG_SPEED, ROW_TIME[ 1 ] * AVG_SPEED - gap ) / 2 );
	const first = n === 1 ? 0.3 + rand() * 0.4 : 0.5; // a lone row somewhere in the middle of the lap
	return Array.from( { length: n }, ( _, i ) => ( i + first ) * gap + ( rand() * 2 - 1 ) * slack );

}

// Boost pads: [ { d (past the start line), lateral (m, + = left of the race
// direction's centreline), length, width } ], in race order
export function boostPads( path, finishS, ahead, rows, seed ) {

	const rand = mulberry( hash( seed, 2 ) );
	const L = path.length;
	const radii = path.radii();
	const f = {};
	const pads = [];
	const clear = ( d ) => d > PAD_CLEAR && d < L - PAD_CLEAR && rows.every( ( r ) => Math.abs( r - d ) > PAD_CLEAR );
	const bendAt = ( d ) => {

		const s = ( ( finishS + ahead * d ) % L + L ) % L;
		const n = path.nearest( ...xz( path, s, f ), 1 );
		return radii[ n.index ];

	};

	for ( let d = ( PAD_TIME[ 0 ] + rand() * ( PAD_TIME[ 1 ] - PAD_TIME[ 0 ] ) ) * AVG_SPEED * 0.5; d < L; d += ( PAD_TIME[ 0 ] + rand() * ( PAD_TIME[ 1 ] - PAD_TIME[ 0 ] ) ) * AVG_SPEED ) {

		const side = Math.floor( rand() * 3 ) - 1; // right, middle or left
		if ( ! clear( d ) || bendAt( d ) < PAD_MIN_RADIUS ) continue;
		pads.push( { d, lateral: side * PAD_LATERAL, length: PAD_LENGTH, width: PAD_WIDTH } );

	}

	// A short twisty lap where no draw fitted: the first place that does, from a random start
	if ( pads.length === 0 ) {

		const from = rand() * L, side = Math.floor( rand() * 3 ) - 1;

		for ( let k = 0; k < L; k += 2 ) {

			const d = ( from + k ) % L;

			if ( clear( d ) && bendAt( d ) >= PAD_MIN_RADIUS ) {

				pads.push( { d, lateral: side * PAD_LATERAL, length: PAD_LENGTH, width: PAD_WIDTH } );
				break;

			}

		}

	}

	return pads;

}

function xz( path, s, f ) {

	path.frameAt( s, f );
	return [ f.x, f.z ];

}

// Is ( x, z ) on the pad (frame f at its centre, ahead = race direction)
export function onPad( pad, f, ahead, x, z ) {

	const dx = x - f.x, dz = z - f.z;
	const along = dx * f.tx + dz * f.tz;
	const across = ( dx * f.tz - dz * f.tx ) * ahead; // + = left of the race direction
	return Math.abs( along ) <= pad.length / 2 && Math.abs( across - pad.lateral ) <= pad.width / 2;

}
