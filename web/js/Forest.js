import * as THREE from 'three';
import { TRACK_SCALE } from './SplineTrack.js';
import { extractProps } from './Props.js';
import { pieceGeometry, NATURE_TREES, NATURE_TREE_SCALE, NATURE_BUSHES, NATURE_SCALE } from './Kit.js';
import { seasonMaterial } from './Seasons.js';

// The forest of a circuit: instead of the Kenney forest tiles (the same few
// trees baked into every tile), trees planted one by one on each forest cell
// — the tiles' own trees (Props.js) and the Nature Kit's pines and firs,
// like the rally forest (RallyStage.decorate), and Nature Kit bushes under
// them. The cell keeps a plain grass
// tile under them (the caller draws it). Two BatchedMesh in all (colormap
// trees, Nature Kit), culled per tree.

const TREES_PER_CELL = [ 5, 7 ]; // min..max, on a jittered 3×3 grid
const SIZE = [ 0.8, 1.25 ]; // random scale on top of the kit's
const BUSHES_PER_CELL = [ 2, 4 ]; // Nature Kit bushes under the trees

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

const _m = new THREE.Object3D();

// cells: [ { gx, gz, x, y, z } ] (cell indices, world centre, ground height
// at the base of the trees: the cell's flat tile), cell: side in m.
// options.ground( x, z ) → { y, grad } | null: the ground under each plant
// instead (relief: trees on slopes, sunk by them; null = nothing grows
// there, rock); options.canGrow( x, z, top, r ): false keeps a plant whose
// top would reach a bridge deck from growing under it. Returns a Group.
export function plantForest( models, cells, cell, { ground = null, canGrow = null } = {} ) {

	const group = new THREE.Group();
	if ( ! cells.length ) return group;

	const props = extractProps( models );
	const nature = models.nature;
	const pines = nature ? NATURE_TREES : [];
	const pool = props.trees.length + pines.length;
	const lists = new Map(); // variant → [ x, y, z, rot, scale, ... ] (variants past the trees: bushes)
	const bushBase = pool;

	const geometries = new Map(); // variant → geometry, built once
	const geometryOf = ( v ) => {

		if ( ! geometries.has( v ) ) geometries.set( v, v < props.trees.length ? props.trees[ v ] : pieceGeometry( nature[ v >= bushBase ? NATURE_BUSHES[ v - bushBase ] : pines[ v - props.trees.length ] ] ) );
		return geometries.get( v );

	};

	// Height and half width of each variant at scale 1 (bridge headroom)
	const sizes = new Map();
	const sizeOf = ( v ) => {

		if ( ! sizes.has( v ) ) {

			const g = geometryOf( v );
			if ( ! g.boundingBox ) g.computeBoundingBox();
			const b = g.boundingBox;
			sizes.set( v, { h: b.max.y, r: Math.max( b.max.x - b.min.x, b.max.z - b.min.z ) / 2 } );

		}

		return sizes.get( v );

	};

	// Where a plant goes: on the cell's tile, or on the relief (sunk by the
	// slope, by `sink` m per unit of gradient); null when it cannot grow there
	const place = ( c, x, z, v, scale, lift, sink ) => {

		let y = c.y + lift;

		if ( ground ) {

			const g = ground( x, z );
			if ( ! g ) return null;
			y = Math.max( g.y, c.flat ? c.y : - Infinity ) + lift - g.grad * sink * scale;

		}

		const size = sizeOf( v );
		if ( canGrow && ! canGrow( x, z, y + size.h * scale, size.r * scale ) ) return null;
		return y;

	};

	for ( const c of cells ) {

		const rand = mulberry( hash( c.gx, c.gz ) ^ 0xf0e57 );
		const count = TREES_PER_CELL[ 0 ] + Math.floor( rand() * ( TREES_PER_CELL[ 1 ] - TREES_PER_CELL[ 0 ] + 1 ) );
		const slots = [ 0, 1, 2, 3, 4, 5, 6, 7, 8 ];

		for ( let k = 0; k < count; k ++ ) {

			const pick = k + Math.floor( rand() * ( slots.length - k ) );
			[ slots[ k ], slots[ pick ] ] = [ slots[ pick ], slots[ k ] ];

			const x = c.x + ( slots[ k ] % 3 - 1 + ( rand() - 0.5 ) * 0.6 ) * cell / 3;
			const z = c.z + ( Math.floor( slots[ k ] / 3 ) - 1 + ( rand() - 0.5 ) * 0.6 ) * cell / 3;
			const variant = Math.floor( rand() * pool );
			const size = SIZE[ 0 ] + rand() * ( SIZE[ 1 ] - SIZE[ 0 ] );
			const scale = ( variant < props.trees.length ? TRACK_SCALE : NATURE_TREE_SCALE ) * size;
			const rot = rand() * Math.PI * 2;

			const y = place( c, x, z, variant, scale, - 0.1, 0.3 );
			if ( y === null ) continue;
			let list = lists.get( variant );
			if ( ! list ) lists.set( variant, list = [] );
			list.push( x, y, z, rot, scale );

		}

		// Bushes anywhere in the cell (their own stream: the trees stay put)
		if ( ! nature ) continue;
		const bush = mulberry( hash( c.gx, c.gz ) ^ 0xb05e );

		for ( let k = 0, n = BUSHES_PER_CELL[ 0 ] + Math.floor( bush() * ( BUSHES_PER_CELL[ 1 ] - BUSHES_PER_CELL[ 0 ] + 1 ) ); k < n; k ++ ) {

			const variant = bushBase + Math.floor( bush() * NATURE_BUSHES.length );
			const x = c.x + ( bush() - 0.5 ) * cell, z = c.z + ( bush() - 0.5 ) * cell;
			const rot = bush() * Math.PI * 2, scale = NATURE_SCALE * ( 1.2 + bush() * 0.9 );
			const y = place( c, x, z, variant, scale, - 0.03, 0.12 );
			if ( y === null ) continue;
			let list = lists.get( variant );
			if ( ! list ) lists.set( variant, list = [] );
			list.push( x, y, z, rot, scale );

		}

	}

	const materials = [
		seasonMaterial( props.material, 'summer' ),
		nature ? seasonMaterial( new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true } ), 'summer' ) : null,
	];

	for ( const natureKit of [ false, true ] ) {

		const variants = [ ...lists.keys() ].filter( ( v ) => ( v >= props.trees.length ) === natureKit );
		if ( ! variants.length ) continue;

		let instances = 0, vertices = 0;
		const geometries = new Map( variants.map( ( v ) => [ v, geometryOf( v ) ] ) );

		for ( const v of variants ) {

			instances += lists.get( v ).length / 5;
			vertices += geometries.get( v ).attributes.position.count;

		}

		const batch = new THREE.BatchedMesh( instances, vertices, 0, materials[ natureKit ? 1 : 0 ] );
		batch.sortObjects = false;
		batch.castShadow = true;
		batch.receiveShadow = true;

		for ( const v of variants ) {

			const list = lists.get( v );
			const id = batch.addGeometry( geometries.get( v ) );

			for ( let i = 0; i < list.length; i += 5 ) {

				_m.position.set( list[ i ], list[ i + 1 ], list[ i + 2 ] );
				_m.rotation.set( 0, list[ i + 3 ], 0 );
				_m.scale.setScalar( list[ i + 4 ] );
				_m.updateMatrix();
				batch.setMatrixAt( batch.addInstance( id ), _m.matrix );

			}

		}

		group.add( batch );

	}

	return group;

}
