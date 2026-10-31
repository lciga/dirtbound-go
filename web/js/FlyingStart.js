// Quick restart on circuits (the `restart` key, R by default; pad Select): the
// car comes back FLYING s before the start line, as it drove there on its last
// lap (position, speed, heading), and the lap clock starts at the line: a lap
// missed in its first bend starts over at once, without driving the rest of
// the circuit. Before any lap, or when the run-up used the secret accelerator:
// RUN_UP m of road before the line, stopped (what full throttle covers from a
// standstill in FLYING s), the clock still starting at the line.

import { STATE_SIZE } from './Vehicle.js';

export const FLYING = 5; // s before the line
export const RUN_UP = 60; // m: 5 s flat out from a standstill (game physics: ~16 m in 2.5 s, then ~19 m/s)
const RUN_UP_SHARE = 0.4; // of the lap at most, on a tiny circuit

// Where the standing run-up starts: road = the circuit's closed path, spawn =
// { position, angle } on the line. { position, angle }, roadY = the road's height over the path
export function runUpStart( road, spawn, roadY ) {

	const [ x, , z ] = spawn.position;
	const s0 = road.nearest( x, z, 2 ).s;
	const f0 = road.frameAt( s0 );
	const ahead = f0.tx * Math.sin( spawn.angle ) + f0.tz * Math.cos( spawn.angle ) < 0 ? - 1 : 1;
	const L = road.length;
	const f = road.frameAt( ( ( s0 - ahead * Math.min( RUN_UP, L * RUN_UP_SHARE ) ) % L + L ) % L );
	return { position: [ f.x, f.y + roadY + 0.5, f.z ], angle: Math.atan2( f.tx * ahead, f.tz * ahead ) };

}

export class FlyingStart {

	constructor( step ) {

		this.size = Math.round( FLYING / step ) + 1; // states in the ring
		this.ring = new Float64Array( this.size * STATE_SIZE );
		this.boosted = new Uint8Array( this.size );
		this.count = 0; // states recorded since the last clear
		this.start = null; // the state FLYING s before the line, last lap

	}

	// Every physics step, after the car moved
	record( vehicle ) {

		const i = this.count % this.size;
		vehicle.saveState( this.ring, i * STATE_SIZE );
		this.boosted[ i ] = vehicle.boost || vehicle.boostUsed ? 1 : 0;
		this.count ++;

	}

	// The line was just crossed (lap or flying start): keep the state FLYING s
	// ago, unless the car did not drive that long since a restart or was boosted
	lineCrossed() {

		if ( this.count < this.size || this.boosted.some( Boolean ) ) return;
		const i = this.count % this.size; // the oldest state
		this.start = this.ring.slice( i * STATE_SIZE, ( i + 1 ) * STATE_SIZE );

	}

	// The car was put somewhere else: the run-up starts over
	clear() {

		this.count = 0;
		this.boosted.fill( 0 );

	}

}
