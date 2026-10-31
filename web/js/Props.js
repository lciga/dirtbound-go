import * as THREE from 'three';

// The Kenney decoration tiles are single merged meshes: a flat 10×10 ground
// plate with trees and stones on it. Flat plates can't sit on a slope, so this
// splits them back into individual props (each tree = trunk + foliage layers,
// stones grouped into small clusters), every prop re-centred with its base at
// the origin, ready to be planted one by one on uneven ground.
//
// Pieces are found as connected components (triangles sharing a vertex
// position), then classified by their bounding box in the tile's raw units:
//   - ground: flat and wide (the plate, grass patches) — dropped
//   - trunk: narrow, tall, starting near the ground — one tree each
//   - foliage: starting above the ground — joins the nearest trunk
//   - stone: small and low — grouped with its neighbours into a cluster

const WELD = 1e3; // position rounding for vertex welding (mm)

function components( geometry ) {

	const pos = geometry.attributes.position;
	const index = geometry.index ? geometry.index.array : null;
	const triCount = ( index ? index.length : pos.count ) / 3;
	const vertexAt = ( t, k ) => index ? index[ t * 3 + k ] : t * 3 + k;

	const parent = new Map();
	const find = ( a ) => {

		while ( parent.get( a ) !== a ) {

			const up = parent.get( parent.get( a ) );
			parent.set( a, up );
			a = up;

		}

		return a;

	};

	const keyOf = ( i ) => {

		const k = Math.round( pos.getX( i ) * WELD ) + ',' + Math.round( pos.getY( i ) * WELD ) + ',' + Math.round( pos.getZ( i ) * WELD );
		if ( ! parent.has( k ) ) parent.set( k, k );
		return k;

	};

	for ( let t = 0; t < triCount; t ++ ) {

		const a = find( keyOf( vertexAt( t, 0 ) ) );
		for ( let k = 1; k < 3; k ++ ) parent.set( find( keyOf( vertexAt( t, k ) ) ), a );

	}

	const groups = new Map();

	for ( let t = 0; t < triCount; t ++ ) {

		const root = find( keyOf( vertexAt( t, 0 ) ) );
		if ( ! groups.has( root ) ) groups.set( root, { tris: [], box: new THREE.Box3() } );
		const g = groups.get( root );
		g.tris.push( t );

		for ( let k = 0; k < 3; k ++ ) {

			const i = vertexAt( t, k );
			g.box.expandByPoint( new THREE.Vector3( pos.getX( i ), pos.getY( i ), pos.getZ( i ) ) );

		}

	}

	return { groups: [ ...groups.values() ], vertexAt };

}

// Non-indexed geometry from a set of triangles, moved so `base` is the origin
function buildGeometry( geometry, vertexAt, tris, base ) {

	const src = geometry.attributes;
	const n = tris.length * 3;
	const position = new Float32Array( n * 3 );
	const normal = new Float32Array( n * 3 );
	const uv = new Float32Array( n * 2 );
	let v = 0;

	for ( const t of tris ) {

		for ( let k = 0; k < 3; k ++ ) {

			const i = vertexAt( t, k );
			position[ v * 3 ] = src.position.getX( i ) - base.x;
			position[ v * 3 + 1 ] = src.position.getY( i ) - base.y;
			position[ v * 3 + 2 ] = src.position.getZ( i ) - base.z;
			normal[ v * 3 ] = src.normal.getX( i );
			normal[ v * 3 + 1 ] = src.normal.getY( i );
			normal[ v * 3 + 2 ] = src.normal.getZ( i );
			uv[ v * 2 ] = src.uv.getX( i );
			uv[ v * 2 + 1 ] = src.uv.getY( i );
			v ++;

		}

	}

	const out = new THREE.BufferGeometry();
	out.setAttribute( 'position', new THREE.BufferAttribute( position, 3 ) );
	out.setAttribute( 'normal', new THREE.BufferAttribute( normal, 3 ) );
	out.setAttribute( 'uv', new THREE.BufferAttribute( uv, 2 ) );
	out.computeBoundingSphere();
	return out;

}

function firstMesh( model ) {

	let mesh = model.isMesh ? model : null;
	if ( ! mesh ) model.traverse( ( c ) => { if ( ! mesh && c.isMesh ) mesh = c; } );
	return mesh;

}

// Returns { trees: [ geometry ], stones: [ geometry ], material } in raw tile
// units (scale by TRACK_SCALE when placing)
export function extractProps( models, names = [ 'decoration-forest', 'decoration-empty' ] ) {

	const trees = [], stones = [];
	let material = null;
	const size = new THREE.Vector3(), center = new THREE.Vector3();

	for ( const name of names ) {

		const mesh = firstMesh( models[ name ] );
		if ( ! mesh ) continue;
		material = material || mesh.material;

		const { groups, vertexAt } = components( mesh.geometry );
		const trunks = [], foliage = [], stoneParts = [];

		for ( const g of groups ) {

			g.box.getSize( size );
			g.box.getCenter( center );
			const footprint = Math.max( size.x, size.z );

			if ( size.y < 0.3 && footprint > 1.5 ) continue; // ground plate / patches
			if ( g.box.min.y > 0.8 ) foliage.push( g );
			else if ( size.y > 1 && footprint < 1 ) trunks.push( g );
			else if ( footprint < 0.8 ) stoneParts.push( g );

		}

		// Foliage → nearest trunk (horizontal distance between box centers)
		for ( const trunk of trunks ) trunk.parts = [ ...trunk.tris ];
		const c1 = new THREE.Vector3(), c2 = new THREE.Vector3();

		for ( const f of foliage ) {

			f.box.getCenter( c1 );
			let best = null, bestD = 1.5;

			for ( const trunk of trunks ) {

				trunk.box.getCenter( c2 );
				const d = Math.hypot( c1.x - c2.x, c1.z - c2.z );

				if ( d < bestD ) {

					bestD = d;
					best = trunk;

				}

			}

			if ( best ) best.parts.push( ...f.tris );

		}

		for ( const trunk of trunks ) {

			trunk.box.getCenter( c2 );
			trees.push( buildGeometry( mesh.geometry, vertexAt, trunk.parts, new THREE.Vector3( c2.x, trunk.box.min.y, c2.z ) ) );

		}

		// Stones → clusters of neighbours
		const used = new Set();

		for ( const s of stoneParts ) {

			if ( used.has( s ) ) continue;
			const cluster = [ s ];
			used.add( s );

			for ( let k = 0; k < cluster.length; k ++ ) {

				cluster[ k ].box.getCenter( c1 );

				for ( const o of stoneParts ) {

					if ( used.has( o ) ) continue;
					o.box.getCenter( c2 );

					if ( Math.hypot( c1.x - c2.x, c1.z - c2.z ) < 0.8 ) {

						cluster.push( o );
						used.add( o );

					}

				}

			}

			const box = new THREE.Box3();
			for ( const p of cluster ) box.union( p.box );
			box.getCenter( c2 );
			stones.push( buildGeometry( mesh.geometry, vertexAt, cluster.flatMap( ( p ) => p.tris ), new THREE.Vector3( c2.x, box.min.y, c2.z ) ) );

		}

	}

	return { trees, stones, material };

}
