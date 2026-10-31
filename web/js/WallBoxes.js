import * as THREE from 'three';
import { GRID_SCALE } from './Track.js';
import { WALL_OFFSET } from './SplineTrack.js';

// The barriers of a spline circuit as boxes (pure: Physics.js turns them into
// crashcat bodies). Each side's wall line, WALL_OFFSET off the centreline, is
// cut into straight runs (within TOLERANCE, dropping at most MAX_DROP); one
// upright box per run, tall enough for its drop. Boxes used to be pitched
// along the slope: on the inside of a bend going down the wall line is very
// short for the road's drop, so they leaned out over the road (invisible walls).

const S = GRID_SCALE;
export const WALL_THICK = 0.25 * S; // half thickness
export const WALL_HEIGHT = 1.5 * S; // half height
const WALL_Y = ( 0.5 + 1.5 ) * S - 0.5; // box centre above the road
const TOLERANCE = 0.03;
const MAX_DROP = 0.25; // m of height along one box (its top / bottom stick out by half of it)

// [ { halfExtents, position, quaternion } ]
export function splineWallBoxes( path ) {

	const L = path.length;
	const boxes = [];
	if ( L <= 0 ) return boxes;

	const steps = Math.max( 2, Math.ceil( L / 0.5 ) );
	const f = {};
	const euler = new THREE.Euler( 0, 0, 0, 'YXZ' );
	const quat = new THREE.Quaternion();

	function isStraight( pts, a, b ) {

		const [ ax, ay, az ] = pts[ a ];
		const dx = pts[ b ][ 0 ] - ax, dy = pts[ b ][ 1 ] - ay, dz = pts[ b ][ 2 ] - az;
		const len2 = dx * dx + dy * dy + dz * dz;
		if ( len2 < 1e-12 ) return false;

		for ( let k = a + 1; k < b; k ++ ) {

			const px = pts[ k ][ 0 ] - ax, py = pts[ k ][ 1 ] - ay, pz = pts[ k ][ 2 ] - az;
			const t = ( px * dx + py * dy + pz * dz ) / len2;
			const ex = px - dx * t, ey = py - dy * t, ez = pz - dz * t;
			if ( ex * ex + ey * ey + ez * ez > TOLERANCE * TOLERANCE ) return false;

		}

		return true;

	}

	for ( const side of [ - 1, 1 ] ) {

		const pts = [];

		for ( let i = 0; i <= steps; i ++ ) {

			path.frameAt( i / steps * L, f );
			pts.push( [ f.x + side * f.tz * WALL_OFFSET, f.y + WALL_Y, f.z - side * f.tx * WALL_OFFSET ] );

		}

		let a = 0;

		while ( a < pts.length - 1 ) {

			let b = a + 1;
			while ( b + 1 < pts.length && Math.abs( pts[ b + 1 ][ 1 ] - pts[ a ][ 1 ] ) <= MAX_DROP && isStraight( pts, a, b + 1 ) ) b ++;

			const dx = pts[ b ][ 0 ] - pts[ a ][ 0 ];
			const dy = pts[ b ][ 1 ] - pts[ a ][ 1 ];
			const dz = pts[ b ][ 2 ] - pts[ a ][ 2 ];
			const flat = Math.hypot( dx, dz );

			euler.set( 0, Math.atan2( dx, dz ), 0 );
			quat.setFromEuler( euler );

			boxes.push( {
				halfExtents: [ WALL_THICK, WALL_HEIGHT + Math.abs( dy ) / 2, flat / 2 + WALL_THICK ],
				position: [ ( pts[ a ][ 0 ] + pts[ b ][ 0 ] ) / 2, ( pts[ a ][ 1 ] + pts[ b ][ 1 ] ) / 2, ( pts[ a ][ 2 ] + pts[ b ][ 2 ] ) / 2 ],
				quaternion: [ quat.x, quat.y, quat.z, quat.w ],
			} );

			a = b;

		}

	}

	return boxes;

}
