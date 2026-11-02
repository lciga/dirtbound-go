import * as THREE from 'three';
import { rigidBody, box, sphere, MotionType, MotionQuality } from 'crashcat';
import { TRACK_CELLS, CELL_RAW, ORIENT_DEG, GRID_SCALE } from './Track.js';
import { splineWallBoxes } from './WallBoxes.js';

function createWall(world,options){
 (world._clubWalls??=[]).push({position:options.position,quaternion:options.quaternion,halfExtents:options.shape.halfExtents});
 return rigidBody.create(world,options);
}

const _debugMat = new THREE.MeshBasicMaterial( { color: 0x00ff00, wireframe: true } );

function addDebugBox( group, halfExtents, position, quaternion ) {

	const geo = new THREE.BoxGeometry( halfExtents[ 0 ] * 2, halfExtents[ 1 ] * 2, halfExtents[ 2 ] * 2 );
	const mesh = new THREE.Mesh( geo, _debugMat );
	mesh.position.set( position[ 0 ], position[ 1 ], position[ 2 ] );
	if ( quaternion ) mesh.quaternion.set( quaternion[ 0 ], quaternion[ 1 ], quaternion[ 2 ], quaternion[ 3 ] );
	group.add( mesh );

}

export function buildWallColliders( world, debugGroup, customCells ) {

	const S = GRID_SCALE;
	const CELL_HALF = CELL_RAW / 2;

	const WALL_HALF_THICK = 0.25;
	const WALL_X = 4.75;
	const WALL_HALF_H = 1.5;

	const wallY = ( 0.5 + WALL_HALF_H ) * S - 0.5;
	const hThick = WALL_HALF_THICK * S;
	const hHeight = WALL_HALF_H * S;
	const hLen = CELL_HALF * S;

	const ARC_SPAN = - Math.PI / 2;
	const ARC_CENTER_X = - CELL_HALF;
	const ARC_CENTER_Z = CELL_HALF;
	const OUTER_R = 2 * CELL_HALF - WALL_HALF_THICK;
	const OUTER_SEG = 8;
	const OUTER_SEG_HALF_LEN = ( OUTER_R * ( Math.PI / 2 ) / OUTER_SEG / 2 ) * S;
	const INNER_R = WALL_HALF_THICK;
	const INNER_SEG = 3;
	const INNER_SEG_HALF_LEN = ( INNER_R * ( Math.PI / 2 ) / INNER_SEG / 2 ) * S;

	function addArcWall( wcx, wcz, arcStart, radius, numSeg, segHalfLen ) {

		for ( let i = 0; i < numSeg; i ++ ) {

			const aMid = arcStart + ( ( i + 0.5 ) / numSeg ) * ARC_SPAN;
			const halfExtents = [ hThick, hHeight, segHalfLen ];
			const position = [
				wcx + radius * Math.cos( aMid ) * S,
				wallY,
				wcz + radius * Math.sin( aMid ) * S
			];
			const quaternion = [ 0, Math.sin( - aMid / 2 ), 0, Math.cos( - aMid / 2 ) ];

			createWall( world, {
				shape: box.create( { halfExtents } ),
				motionType: MotionType.STATIC,
				objectLayer: world._OL_STATIC,
				position,
				quaternion,
				friction: 0.0,
				restitution: 0.1,
			} );

			if ( debugGroup ) addDebugBox( debugGroup, halfExtents, position, quaternion );

		}

	}

	const cells = customCells || TRACK_CELLS;

	for ( const [ gx, gz, key, orient ] of cells ) {

		if ( key === 'track-bump' ) continue;

		const cx = ( gx + 0.5 ) * CELL_RAW * S;
		const cz = ( gz + 0.5 ) * CELL_RAW * S;

		const deg = ORIENT_DEG[ orient ] ?? 0;
		const rad = deg * Math.PI / 180;
		const cr = Math.cos( rad ), sr = Math.sin( rad );

		if ( key === 'track-straight' || key === 'track-finish' ) {

			for ( const side of [ - 1, 1 ] ) {

				const lx = side * WALL_X;
				const wx = cx + ( lx * cr ) * S;
				const wz = cz + ( - lx * sr ) * S;
				const halfExtents = [ hThick, hHeight, hLen ];
				const position = [ wx, wallY, wz ];
				const quaternion = [ 0, Math.sin( rad / 2 ), 0, Math.cos( rad / 2 ) ];

				createWall( world, {
					shape: box.create( { halfExtents } ),
					motionType: MotionType.STATIC,
					objectLayer: world._OL_STATIC,
					position,
					quaternion,
					friction: 0.0,
					restitution: 0.1,
				} );

				if ( debugGroup ) addDebugBox( debugGroup, halfExtents, position, quaternion );

			}

		} else if ( key === 'track-corner' ) {

			const wcx = cx + ( ARC_CENTER_X * cr + ARC_CENTER_Z * sr ) * S;
			const wcz = cz + ( - ARC_CENTER_X * sr + ARC_CENTER_Z * cr ) * S;
			const arcStart = - rad;

			addArcWall( wcx, wcz, arcStart, OUTER_R, OUTER_SEG, OUTER_SEG_HALF_LEN );
			addArcWall( wcx, wcz, arcStart, INNER_R, INNER_SEG, INNER_SEG_HALF_LEN );

		}

	}

}

// Barrier colliders along both edges of a spline track. The offset edge is
// sampled finely (following the road elevation), then runs of nearly
// collinear samples are merged into one pitched box. Returns the bodies
// (the rally stage removes them when their chunk is dropped).
export function buildSplineWallColliders( world, path, debugGroup ) {

	return splineWallBoxes( path ).map( ( { halfExtents, position, quaternion } ) => {

		if ( debugGroup ) addDebugBox( debugGroup, halfExtents, position, quaternion );

		return createWall( world, {
			shape: box.create( { halfExtents } ),
			motionType: MotionType.STATIC,
			objectLayer: world._OL_STATIC,
			position,
			quaternion,
			friction: 0.0,
			restitution: 0.1,
		} );

	} );

}

// Smooth ground for terrain with relief: one static box whose top face is kept
// tangent to the ground right under the car. A triangle mesh makes the rolling
// sphere hop on triangle edges and fires a new contact (impact sound) per triangle.
// sample( x, z, outNormal ) returns the ground height and writes its normal.
export function createGroundProxy( world, sample ) {

	const HALF = 6;
	const THICK = 1;
	const normal = new THREE.Vector3();
	const up = new THREE.Vector3( 0, 1, 0 );
	const quat = new THREE.Quaternion();

	const body = rigidBody.create( world, {
		shape: box.create( { halfExtents: [ HALF, THICK, HALF ] } ),
		motionType: MotionType.STATIC,
		objectLayer: world._OL_STATIC,
		position: [ 0, - THICK, 0 ],
		friction: 5.0,
		restitution: 0.0,
	} );

	function update( x, z ) {

		const h = sample( x, z, normal );
		quat.setFromUnitVectors( up, normal );

		rigidBody.setTransform( world, body,
			[ x - normal.x * THICK, h - normal.y * THICK, z - normal.z * THICK ],
			[ quat.x, quat.y, quat.z, quat.w ],
			false
		);

	}

	return { body, update };

}

export function createSphereBody( world, spawnPos, { beta = false } = {} ) {

	const body = rigidBody.create( world, {
		shape: sphere.create( { radius: 0.5 } ),
		motionType: MotionType.DYNAMIC,
		objectLayer: world._OL_MOVING,
		position: spawnPos || [ 3.5, 0.5, 5 ],
		mass: beta ? 1200.0 : 1000.0,
		// Beta owns tyre forces in Vehicle; rolling-sphere friction would apply
		// a second, incompatible driveline on the moving tangent ground proxy.
		friction: beta ? 0.0 : 5.0,
		restitution: 0.1,
		linearDamping: beta ? 0.015 : 0.1,
		angularDamping: beta ? 0.05 : 4.0,
		// The default 47 rad/s caps a rolling radius-0.5 body at ~170 km/h.
		maxAngularVelocity: beta ? 200 : 47.12388980384689,
		// Beta uses SI gravity at half-scale geometry (9.81 / 2 world units/s²).
		gravityFactor: beta ? 0.5 : 1.5,
		motionQuality: MotionQuality.LINEAR_CAST,
	} );

	return body;

}
