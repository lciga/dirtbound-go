import * as THREE from 'three';
import { CELL_RAW, GRID_SCALE } from './Track.js';
import { TRACK_SCALE, ROAD_HALF, ROAD_Y, GRASS_UV, ROCK_UV, buildRoadGeometry, extractTileGeometry, finishWithoutArch, extractCornerGeometry, splineBounds } from './SplineTrack.js';
import { TERRAIN_LIMIT, buildGroundGeometry, rockGroundMaterial } from './Terrain.js';
import { dressCircuit, circuitArch } from './CircuitDressing.js';
import { plantForest } from './Forest.js';
import { fadingBridges, headroom } from './Bridges.js';
import { season, seasonMaterial, seasonScenery } from './Seasons.js';

// Visuals for a spline track: bent road, sculpted ground, decoration grid,
// and with the racing kit loaded (models.kit) the circuit's dressing
// (CircuitDressing.js: start arch, grandstands, pits, billboards…).

const _dummy = new THREE.Object3D();
const _n = new THREE.Vector3();

const TERRAIN_SINK = - 0.08; // keeps the ground just under the road surface (visual only)
const MAX_DECO_SLOPE = 1.2;  // skip decoration tiles on cells steeper than this height range
const FOREST_REACH = 150;    // m from the road: no forest beyond (the terrain is endless)
const REACH_CELL = 32;       // m, cells of the coarse map of where the road is near

function hash( gx, gz ) {

	let h = gx * 374761393 + gz * 668265263;
	h = ( h ^ ( h >> 13 ) ) * 1274126177;
	return ( h ^ ( h >> 16 ) ) >>> 0;

}

// Distance from (x, z) to the road (every other sample, as path.nearest( x,
// z, 2 ) reads them) when it is at most `reach`, else Infinity: a spatial
// hash instead of the whole lap for every decoration cell
function nearRoad( path, reach ) {

	const cell = reach, cells = new Map();
	const keyOf = ( gx, gz ) => gx * 65536 + gz;

	for ( let k = 0; k < path.px.length; k += 2 ) {

		const key = keyOf( Math.floor( path.px[ k ] / cell ), Math.floor( path.pz[ k ] / cell ) );
		const list = cells.get( key );
		if ( list ) list.push( k );
		else cells.set( key, [ k ] );

	}

	return ( x, z ) => {

		const gx = Math.floor( x / cell ), gz = Math.floor( z / cell );
		let best = Infinity;

		for ( let a = gx - 1; a <= gx + 1; a ++ ) {

			for ( let b = gz - 1; b <= gz + 1; b ++ ) {

				const list = cells.get( keyOf( a, b ) );
				if ( ! list ) continue;

				for ( const k of list ) {

					const dx = path.px[ k ] - x, dz = path.pz[ k ] - z;
					best = Math.min( best, dx * dx + dz * dz );

				}

			}

		}

		const d = Math.sqrt( best );
		return d <= reach ? d : Infinity;

	};

}

// Is (x, z) within about `reach` of the road (REACH_CELL cells around the
// road's own, at least `reach` away)
function reachMap( path, reach ) {

	const near = new Set(), r = Math.ceil( reach / REACH_CELL );
	const keyOf = ( gx, gz ) => gx * 65536 + gz;
	const done = new Set();

	for ( let k = 0; k < path.px.length; k += 2 ) {

		const gx = Math.floor( path.px[ k ] / REACH_CELL ), gz = Math.floor( path.pz[ k ] / REACH_CELL );
		if ( done.has( keyOf( gx, gz ) ) ) continue;
		done.add( keyOf( gx, gz ) );
		for ( let a = gx - r; a <= gx + r; a ++ ) for ( let b = gz - r; b <= gz + r; b ++ ) near.add( keyOf( a, b ) );

	}

	return ( x, z ) => near.has( keyOf( Math.floor( x / REACH_CELL ), Math.floor( z / REACH_CELL ) ) );

}

export function buildSplineTrack( scene, models, path, terrain, seasonId = 'summer' ) {

	const group = new THREE.Group();

	const straight = extractTileGeometry( models[ 'track-straight' ] );
	// With the kit, the arch drawn for this circuit (circuitArch) replaces the
	// finish tile's own, unless the draw keeps it ('kenney')
	const kitArch = models.kit && path.closed && circuitArch( path ) !== 'kenney';
	const finish = path.closed ? extractTileGeometry( kitArch ? finishWithoutArch( models[ 'track-finish' ] ) : models[ 'track-finish' ] ) : null;

	const corner = extractCornerGeometry( models[ 'track-corner' ] );
	const road = new THREE.Mesh( buildRoadGeometry( path, straight.geometry, finish?.geometry, false, corner.geometry ), straight.material );
	road.castShadow = true;
	road.receiveShadow = true;
	group.add( road );

	const bounds = splineBounds( path );

	// Grass, grey rock where the ground is too steep (cliffs, as on the rally
	// stages) with a ragged edge, flat grass out to the horizon around the relief
	const groundMaterial = seasonId === 'summer' ? rockGroundMaterial( straight.material, ROCK_UV ) : seasonMaterial( straight.material, seasonId, { rock: ROCK_UV } );
	const ground = new THREE.Mesh( buildGroundGeometry( terrain, { grass: GRASS_UV, yOffset: TERRAIN_SINK, centre: [ bounds.centerX, bounds.centerZ ] } ), groundMaterial );
	ground.castShadow = true;
	ground.receiveShadow = true;
	group.add( ground );

	// Where the road passes over itself: decks and piers (the ground under them
	// follows the road below); each bridge fades while the car is under it
	const bridges = fadingBridges( path, terrain, road );
	if ( bridges ) group.add( bridges.group );
	group.userData.bridges = bridges;

	// Decoration grid: keep cells clear of the road, empty ring next to it, forest beyond

	const CELL = CELL_RAW * GRID_SCALE;
	const PAD = 3;
	const clear = CELL * Math.SQRT1_2 + ROAD_HALF + 0.25;
	const limit = Math.floor( TERRAIN_LIMIT / CELL ) - 1;
	const roadDistance = nearRoad( path, clear + CELL );
	const inReach = reachMap( path, FOREST_REACH );

	const gx0 = Math.max( - limit, Math.floor( ( bounds.centerX - bounds.halfWidth ) / CELL ) - PAD );
	const gx1 = Math.min( limit, Math.ceil( ( bounds.centerX + bounds.halfWidth ) / CELL ) + PAD );
	const gz0 = Math.max( - limit, Math.floor( ( bounds.centerZ - bounds.halfDepth ) / CELL ) - PAD );
	const gz1 = Math.min( limit, Math.ceil( ( bounds.centerZ + bounds.halfDepth ) / CELL ) + PAD );

	const buckets = { 'decoration-empty': [], 'decoration-forest': [] }; // never the Kenney tents tile
	const half = CELL / 2;
	const tiles = new Map(); // "gx,gz" → { y, type }: what the dressing must keep off
	// Forest cells get a grass tile and trees planted one by one (Forest.js),
	// except in performance mode (forest tiles swapped for plain ones: none)
	const plantTrees = models[ 'decoration-forest' ] !== models[ 'decoration-empty' ];
	const forestCells = [];

	for ( let gz = gz0; gz < gz1; gz ++ ) {

		for ( let gx = gx0; gx < gx1; gx ++ ) {

			const x = ( gx + 0.5 ) * CELL;
			const z = ( gz + 0.5 ) * CELL;
			if ( ! inReach( x, z ) ) continue;
			const d = roadDistance( x, z );

			if ( d < clear ) continue;

			// Tiles are flat: sit them on the cell's mean height. A steep cell
			// gets no tile; its forest still grows, tree by tree on the slope
			const corners = [
				terrain.heightAt( x - half, z - half ), terrain.heightAt( x + half, z - half ),
				terrain.heightAt( x - half, z + half ), terrain.heightAt( x + half, z + half ),
			];
			const lo = Math.min( ...corners ), hi = Math.max( ...corners );
			const flat = hi - lo <= MAX_DECO_SLOPE;
			const y = ( corners[ 0 ] + corners[ 1 ] + corners[ 2 ] + corners[ 3 ] ) / 4;

			if ( d < clear + CELL ) {

				if ( ! flat ) continue; // plain ground (grass or rock) next to the road
				buckets[ 'decoration-empty' ].push( x, y, z, 0 );
				tiles.set( gx + ',' + gz, { y, type: 'decoration-empty' } );

			} else {

				if ( plantTrees ) {

					if ( flat ) buckets[ 'decoration-empty' ].push( x, y, z, 0 );
					forestCells.push( { gx, gz, x, y: y + ROAD_Y, z, flat } );

				} else if ( flat ) buckets[ 'decoration-forest' ].push( x, y, z, 0 );
				else continue; // performance mode: its forest tiles are flat

				tiles.set( gx + ',' + gz, { y, type: 'decoration-forest' } );

			}

		}

	}

	for ( const key in buckets ) {

		const list = buckets[ key ];
		const src = models[ key ];
		if ( ! src || list.length === 0 ) continue;

		const count = list.length / 4;

		src.traverse( ( child ) => {

			if ( ! child.isMesh ) return;

			const inst = new THREE.InstancedMesh( child.geometry, child.material, count );
			inst.castShadow = true;
			inst.receiveShadow = true;

			for ( let i = 0; i < count; i ++ ) {

				_dummy.position.set( list[ i * 4 ], list[ i * 4 + 1 ] + ROAD_Y, list[ i * 4 + 2 ] );
				_dummy.rotation.y = list[ i * 4 + 3 ] * Math.PI / 2;
				_dummy.scale.setScalar( TRACK_SCALE );
				_dummy.updateMatrix();
				inst.setMatrixAt( i, _dummy.matrix );

			}

			group.add( seasonScenery( inst, seasonId ) );

		} );

	}

	// Trees and bushes on the relief as drawn, sunk by its slope; never on
	// rock, never under a bridge they would reach (beside it is fine)
	const plantGround = ( x, z ) => {

		if ( terrain.isRock( x, z ) ) return null;
		const y = terrain.drawnFacet( x, z, _n ) + ROAD_Y + TERRAIN_SINK;
		return { y, grad: Math.sqrt( Math.max( 0, 1 - _n.y * _n.y ) ) / _n.y };

	};
	const canGrow = ( x, z, top, r ) => top < headroom( path, terrain, x, z, r ) - 0.2;
	group.add( plantForest( models, forestCells, CELL, { ground: plantGround, canGrow, seasonId } ) );

	// The dressing keeps off the forest tiles (in performance mode they are
	// all plain grass)
	if ( models.kit ) {

		const plain = models[ 'decoration-forest' ] === models[ 'decoration-empty' ];
		const tileAt = ( x, z ) => {

			const t = tiles.get( Math.floor( x / CELL ) + ',' + Math.floor( z / CELL ) );
			return t && plain ? { y: t.y, type: 'decoration-empty' } : t || null;

		};
		group.add( seasonScenery( dressCircuit( models.kit, path, terrain, tileAt, { nature: models.nature, plantGround, canGrow, leaves: season( seasonId ).leaves } ), seasonId ) );

	}

	scene.add( group );

	return group;

}
