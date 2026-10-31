import * as THREE from 'three';
import { TrackPath, ROAD_HALF, ROAD_Y, roadPieces, finishWithoutArch } from './SplineTrack.js';
import { CELL_RAW, GRID_SCALE, ORIENT_DEG, TRACK_CELLS } from './Track.js';
import { plantForest } from './Forest.js';
import { season, seasonScenery } from './Seasons.js';
import { KitBatch, KIT_SCALE, BUILDING_SCALE, ARCHES, buildArch, NATURE_TREES, NATURE_TREE_SCALE, NATURE_BUSHES, NATURE_SCALE } from './Kit.js';

// What stands around a circuit, with the Kenney racing kit (Kit.js): an arch
// over the start line, a row of grandstand modules along the main straight
// and the pit buildings across from it (Lego-like, side by side), then around
// the lap light posts, billboards, marquees, flags, banner towers, TV cameras
// on the outside of the bends, small stands there too, and trees. Seeded by
// the circuit's shape, so a circuit always looks the same.
//
// Everything stays outside the barriers, off the decoration tiles that carry
// trees or tents, and clear of every other stretch of road.

const STATION = 7; // m between placement decisions around the lap
const GRID = 5; // m, cells of the placement grids (larger than any clearance or footprint test)
const WALL_CLEAR = ROAD_HALF + 0.55; // m from the centreline: past the barriers
const STAND_GAP = 0.1; // m between the barrier's back and a grandstand: stands hug the track
const HUG_CLEAR = ROAD_HALF + 0.05; // what a grandstand's front edge must keep from the centreline
const STRAIGHT_TURN = 0.05; // rad over 4 m: below this the road counts as straight
const MAX_STRAIGHT = 70; // m searched each way from the start line

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

const pick = ( rand, list ) => list[ Math.floor( rand() * list.length ) ];

// A seed from the circuit's shape
function shapeSeed( path ) {

	let h = 0x9e3779b9;
	const step = Math.max( 1, Math.floor( path.sampleCount / 64 ) );
	for ( let i = 0; i < path.sampleCount; i += step ) h = hash( h ^ Math.round( path.px[ i ] * 10 ), Math.round( path.pz[ i ] * 10 ) );
	return h;

}

// The centreline of a GridMap circuit (Track.js cells) as a closed
// TrackPath starting at the finish cell's centre, or null if the pieces do
// not make one loop. Straights join along their axis, corners turn.
export function pathFromCells( cells ) {

	const CELL = CELL_RAW * GRID_SCALE;
	const byKey = new Map( cells.map( ( c ) => [ c[ 0 ] + ',' + c[ 1 ], c ] ) );
	const finish = cells.find( ( c ) => c[ 2 ] === 'track-finish' );
	if ( ! finish ) return null;

	const alongX = ( c ) => ( ORIENT_DEG[ c[ 3 ] ] ?? 0 ) % 180 !== 0;
	const accepts = ( c, dx, dz ) => c[ 2 ] === 'track-corner' || ( alongX( c ) ? dz === 0 : dx === 0 );
	const links = ( c ) => [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ].filter( ( [ dx, dz ] ) => {

		const n = byKey.get( ( c[ 0 ] + dx ) + ',' + ( c[ 1 ] + dz ) );
		return n && accepts( c, dx, dz ) && accepts( n, - dx, - dz );

	} );

	const a0 = THREE.MathUtils.degToRad( ORIENT_DEG[ finish[ 3 ] ] ?? 0 );
	let dx = Math.round( Math.sin( a0 ) ), dz = Math.round( Math.cos( a0 ) );
	const centre = ( c ) => [ ( c[ 0 ] + 0.5 ) * CELL, ( c[ 1 ] + 0.5 ) * CELL ];
	const [ fx, fz ] = centre( finish );
	const nodes = [ { x: fx, z: fz, a: Math.atan2( dx, dz ), y: 0 } ];
	let cur = finish;

	for ( let guard = 0; guard <= cells.length; guard ++ ) {

		const [ cx, cz ] = centre( cur );
		nodes.push( { x: cx + dx * CELL / 2, z: cz + dz * CELL / 2, a: Math.atan2( dx, dz ), y: 0 } );
		const next = byKey.get( ( cur[ 0 ] + dx ) + ',' + ( cur[ 1 ] + dz ) );
		if ( ! next ) return null;
		if ( next === finish ) return new TrackPath( nodes, true );

		const out = links( next ).filter( ( [ ex, ez ] ) => ex !== - dx || ez !== - dz );
		if ( ! out.length ) return null;
		const straight = out.find( ( [ ex, ez ] ) => ex === dx && ez === dz );
		[ dx, dz ] = next[ 2 ] === 'track-corner' ? out.find( ( [ ex, ez ] ) => ex !== dx || ez !== dz ) || out[ 0 ] : straight || out[ 0 ];
		cur = next;

	}

	return null;

}

// The start arch of a circuit, drawn at random by its shape: one of the kit's
// arches, or 'kenney' = the finish tile's own arch kept
export const CIRCUIT_ARCHES = [ 'kenney', ...Object.keys( ARCHES ) ];

export function circuitArch( path ) {

	return CIRCUIT_ARCHES[ hash( shapeSeed( path ), 0xa7c ) % CIRCUIT_ARCHES.length ];

}

// The models for a GridMap circuit (cells, null = the Kenney one): when the
// kit puts one of its arches over the finish (the pieces make a loop and the
// draw is not 'kenney'), the finish tile loses its own
export function gridTrackModels( models, cells ) {

	const path = models.kit ? pathFromCells( cells || TRACK_CELLS ) : null;
	if ( ! path || circuitArch( path ) === 'kenney' ) return models;
	return { ...models, 'track-finish': finishWithoutArch( models[ 'track-finish' ] ) };

}

// The trees of a GridMap circuit's forest cells (Track.js layout.forestCells),
// planted one by one on their grass tiles (Forest.js)
export function gridForest( models, layout, seasonId = 'summer' ) {

	const CELL = CELL_RAW * GRID_SCALE;
	const cells = layout.forestCells.map( ( [ gx, gz ] ) => ( { gx, gz, x: ( gx + 0.5 ) * CELL, y: ROAD_Y, z: ( gz + 0.5 ) * CELL } ) );
	return plantForest( models, cells, CELL, { seasonId } );

}

// A GridMap circuit's dressing (Track.js buildTrack's layout), added to the
// scene; performance mode keeps to plain tiles. Nothing if the pieces do not
// make a loop.
export function dressGridTrack( scene, models, layout, seasonId = 'summer' ) {

	const path = models.kit && layout?.tiles ? pathFromCells( layout.cells ) : null;
	if ( ! path ) return;

	const CELL = CELL_RAW * GRID_SCALE;
	const plain = models[ 'decoration-forest' ] === models[ 'decoration-empty' ];
	const tileAt = ( x, z ) => {

		const type = layout.tiles.get( Math.floor( x / CELL ) + ',' + Math.floor( z / CELL ) );
		return type ? { y: 0, type: plain ? 'decoration-empty' : type } : null;

	};
	scene.add( seasonScenery( dressCircuit( models.kit, path, { heightAt: () => 0 }, tileAt, { startS: 0, avoid: layout.avoid, nature: models.nature, leaves: season( seasonId ).leaves } ), seasonId ) );

}

// kit: Kit.js pieces; terrain: heightAt( x, z ); tileAt( x, z ): the
// decoration tile under a point ({ y, type }) or null.
// options: startS (arc length of the start line; by default the finish tile
// of a spline loop), avoid: [ [ x, z, r ] ] kept clear, leaves: tree colours;
// plantGround( x, z ) → { y, grad } | null and canGrow( x, z, top, r ): trees
// and bushes on the relief, sunk by its slope, not on rock nor under a bridge
// they would reach (TrackScene); without them, on flat ground like the rest
export function dressCircuit( kit, path, terrain, tileAt, { startS = null, avoid = [], leaves = [ 0x4f9a4c, 0x5e9e45, 0x6aa24a ], nature = null, plantGround = null, canGrow = null } = {} ) {

	const group = new THREE.Group();
	const batch = new KitBatch();
	const rand = mulberry( shapeSeed( path ) );
	const f = {};

	// Spatial grids (GRID m cells): what is placed ([ x, z, r, row ]) and the
	// road samples (every other one, as path.nearest( x, z, 2 ) reads them),
	// so a placement test looks at its neighbourhood instead of the whole lap
	const cellOf = ( x, z ) => Math.floor( x / GRID ) * 65536 + Math.floor( z / GRID );
	const placed = new Map();
	const addPlaced = ( e ) => {

		const key = cellOf( e[ 0 ], e[ 1 ] );
		const list = placed.get( key );
		if ( list ) list.push( e );
		else placed.set( key, [ e ] );

	};
	for ( const e of avoid ) addPlaced( e );

	const samples = new Map();

	for ( let i = 0; i < path.sampleCount; i += 2 ) {

		const key = cellOf( path.px[ i ], path.pz[ i ] );
		const list = samples.get( key );
		if ( list ) list.push( path.px[ i ], path.pz[ i ] );
		else samples.set( key, [ path.px[ i ], path.pz[ i ] ] );

	}

	// Is a road sample within `clear` of (x, z) (clear ≤ GRID)
	const nearRoad = ( x, z, clear ) => {

		const gx = Math.floor( x / GRID ), gz = Math.floor( z / GRID ), c2 = clear * clear;

		for ( let iz = gz - 1; iz <= gz + 1; iz ++ ) {

			for ( let ix = gx - 1; ix <= gx + 1; ix ++ ) {

				const list = samples.get( ix * 65536 + iz );
				if ( ! list ) continue;

				for ( let i = 0; i < list.length; i += 2 ) {

					const dx = list[ i ] - x, dz = list[ i + 1 ] - z;
					if ( dx * dx + dz * dz < c2 ) return true;

				}

			}

		}

		return false;

	};

	// Does a footprint of radius r at (x, z) touch something placed (except its own row)
	const touches = ( x, z, r, row ) => {

		const gx = Math.floor( x / GRID ), gz = Math.floor( z / GRID );

		for ( let iz = gz - 1; iz <= gz + 1; iz ++ ) {

			for ( let ix = gx - 1; ix <= gx + 1; ix ++ ) {

				const list = placed.get( ix * 65536 + iz );
				if ( list ) for ( const [ px, pz, pr, tag ] of list ) if ( ( ! row || tag !== row ) && Math.hypot( px - x, pz - z ) < pr + r * 0.8 ) return true;

			}

		}

		return false;

	};

	// Ground as drawn: the terrain, or the flat decoration tile on top of it
	const ground = ( x, z ) => {

		const h = terrain.heightAt( x, z ) + ROAD_Y - 0.08;
		const tile = tileAt( x, z );
		return tile ? Math.max( h, tile.y + ROAD_Y ) : h;

	};

	// A point is usable off the road, off the tiles with trees or tents
	const usable = ( x, z, clear = WALL_CLEAR ) => {

		if ( nearRoad( x, z, clear ) ) return false;
		const tile = tileAt( x, z );
		return ! tile || tile.type === 'decoration-empty';

	};

	// A footprint (w × d, turned by rot) free of the road, the busy tiles and
	// what is already placed (except pieces of the same `row`, which touch
	// side by side); `clear` from the centreline; its lowest ground, or null
	const footprint = ( x, z, rot, w, d, row, clear ) => {

		const r = Math.hypot( w, d ) / 2;
		if ( touches( x, z, r, row ) ) return null;

		const c = Math.cos( rot ), s = Math.sin( rot );
		let lo = Infinity, hi = - Infinity;

		for ( const [ u, v ] of [ [ 0, 0 ], [ - 1, - 1 ], [ 1, - 1 ], [ - 1, 1 ], [ 1, 1 ], [ 0, - 1 ], [ 0, 1 ] ] ) {

			const lx = u * w / 2, lz = v * d / 2;
			const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
			if ( ! usable( px, pz, clear ) ) return null;
			const y = ground( px, pz );
			lo = Math.min( lo, y );
			hi = Math.max( hi, y );

		}

		if ( hi - lo > 0.8 ) return null; // too steep for a flat piece
		return lo;

	};

	// Places piece `name` at (x, z) turned by rot if its footprint is free
	// (opts.row: a tag shared by modules laid side by side; opts.clear: the
	// distance kept from the centreline, WALL_CLEAR by default)
	const put = ( name, x, z, rot, scale, opts = {} ) => {

		const tpl = kit[ name ] ?? nature[ name ]; // racing kit or nature kit (pines)
		const w = tpl.size.x * scale, d = tpl.size.z * scale;
		const y = footprint( x, z, rot, w, d, opts.row, opts.clear );
		if ( y === null ) return false;
		batch.add( tpl, x, y - 0.03, z, rot, scale, opts );
		addPlaced( [ x, z, Math.hypot( w, d ) / 2, opts.row ] );
		return true;

	};

	// A tree or a bush: like put, but on slopes too (the relief as drawn, sunk
	// by `sink` m per unit of gradient), never on rock nor under a bridge
	const plant = ( name, x, z, rot, scale, opts = {}, sink = 0.3 ) => {

		if ( ! plantGround ) return put( name, x, z, rot, scale, opts );
		const tpl = kit[ name ] ?? nature[ name ];
		const r = Math.hypot( tpl.size.x, tpl.size.z ) * scale / 2;
		if ( ! usable( x, z, opts.clear ) || touches( x, z, r, opts.row ) ) return false;
		const g = plantGround( x, z );
		if ( ! g ) return false;
		const tile = tileAt( x, z );
		const y = ( tile ? Math.max( g.y, tile.y + ROAD_Y ) : g.y ) - 0.03 - g.grad * sink * scale;
		if ( canGrow && ! canGrow( x, z, y + tpl.size.y * scale, r ) ) return false;
		batch.add( tpl, x, y, z, rot, scale, opts );
		addPlaced( [ x, z, r, opts.row ] );
		return true;

	};

	// Point `lat` m to the left of the road (side +1) or right (-1) at frame f,
	// and the heading that faces the road from there
	const at = ( fr, side, lat, along = 0 ) => ( { x: fr.x + fr.tz * lat * side + fr.tx * along, z: fr.z - fr.tx * lat * side + fr.tz * along } );
	const facing = ( fr, side ) => Math.atan2( - fr.tz * side, fr.tx * side );
	const heading = ( s ) => {

		path.frameAt( s, f );
		return Math.atan2( f.tx, f.tz );

	};
	const turnAt = ( s ) => {

		let d = heading( s + 2 ) - heading( s - 2 );
		return Math.atan2( Math.sin( d ), Math.cos( d ) ); // > 0: bending left

	};

	const L = path.length;
	if ( startS === null ) startS = path.closed ? roadPieces( path, true ).finishS : 0;

	// ─── Start line: an arch, start lights, flags ──────────

	rand(); // the old arch draw: kept so the rest of the layout does not move
	const archName = circuitArch( path );

	if ( path.closed && archName !== 'kenney' ) {

		path.frameAt( startS, f );
		const arch = buildArch( kit, archName, { ...f, y: f.y + ROAD_Y }, ROAD_HALF + 0.35 );
		group.add( arch.group );
		addPlaced( [ f.x + f.tz * ( ROAD_HALF + 0.6 ), f.z - f.tx * ( ROAD_HALF + 0.6 ), 1 ] );
		addPlaced( [ f.x - f.tz * ( ROAD_HALF + 0.6 ), f.z + f.tx * ( ROAD_HALF + 0.6 ), 1 ] );

	}

	for ( const side of path.closed ? [ 1, - 1 ] : [] ) {

		for ( const along of [ - 3, 3 ] ) {

			path.frameAt( startS + along, f );
			const p = at( f, side, WALL_CLEAR + 0.5 );
			put( 'flagCheckers', p.x, p.z, facing( f, side ), KIT_SCALE * 1.2 );

		}

	}

	if ( path.closed && archName !== 'overheadLights' ) {

		path.frameAt( startS + 1.5, f );
		const p = at( f, 1, WALL_CLEAR + 0.4 );
		put( 'lightRedDouble', p.x, p.z, Math.atan2( - f.tx, - f.tz ), KIT_SCALE * 2.2 ); // facing the grid

	}

	// ─── Main straight: grandstands on one side, the pits across ──

	if ( path.closed ) {

		let a = startS, b = startS;
		while ( startS - a < MAX_STRAIGHT && Math.abs( turnAt( a - 2 ) ) < STRAIGHT_TURN ) a -= 2;
		while ( b - startS < MAX_STRAIGHT && Math.abs( turnAt( b + 2 ) ) < STRAIGHT_TURN ) b += 2;

		const standSide = rand() < 0.5 ? 1 : - 1;
		const standType = pick( rand, [ 'grandStand', 'grandStandCovered', 'grandStandAwning' ] );
		const W = BUILDING_SCALE; // every module is one kit unit wide
		const rows = [
			{ side: standSide, lat: ROAD_HALF + STAND_GAP, clear: HUG_CLEAR, piece: ( i, n ) => ( standType === 'grandStand' && Math.abs( i - ( n - 1 ) / 2 ) < n / 6 ) ? 'grandStandCovered' : standType },
			{ side: - standSide, lat: WALL_CLEAR + 1.8, piece: ( i, n ) => i === Math.floor( n / 2 ) ? pick( rand, [ 'pitsOffice', 'pitsOfficeRoof' ] ) : ( rand() < 0.3 ? 'pitsGarageClosed' : 'pitsGarage' ) },
		];

		for ( const row of rows ) {

			const n = Math.min( 12, Math.floor( ( b - a - 6 ) / W ) );
			if ( n < 2 ) continue;
			const first = ( a + b ) / 2 - ( n - 1 ) / 2 * W;

			for ( let i = 0; i < n; i ++ ) {

				path.frameAt( first + i * W, f );
				const name = row.piece( i, n );
				const p = at( f, row.side, row.lat + kit[ name ].size.z * BUILDING_SCALE / 2 );
				put( name, p.x, p.z, facing( f, row.side ), BUILDING_SCALE, { row, clear: row.clear } );

			}

		}

	}

	// ─── Around the lap ────────────────────────────────────

	const postSide = rand() < 0.5 ? 1 : - 1;
	const postName = pick( rand, [ 'lightPostLarge', 'lightPostModern', 'lightPost' ] ); // one model per circuit
	let station = 0;

	for ( let s = startS + STATION; s < startS + L - STATION; s += STATION, station ++ ) {

		const turn = turnAt( s );
		const corner = Math.abs( turn ) > 0.12;
		path.frameAt( s, f );

		for ( const side of [ 1, - 1 ] ) {

			const r = mulberry( hash( shapeSeed( path ) ^ station, side > 0 ? 3 : 5 ) );
			const outside = corner && Math.sign( turn ) !== side;
			const face = facing( f, side );

			// Light posts right behind the barrier on both sides, one per
			// station, the other side half a station further on
			{

				const along = side === postSide ? 0 : STATION / 2;
				path.frameAt( s + along, f );
				const p = at( f, side, ROAD_HALF + 0.2 );
				put( postName, p.x, p.z, facing( f, side ), KIT_SCALE * 2, { clear: HUG_CLEAR } );
				path.frameAt( s, f );

			}

			// The outside of a bend: a TV camera, now and then a small stand
			if ( outside && r() < 0.25 ) {

				const p = at( f, side, WALL_CLEAR + 0.6, ( r() - 0.5 ) * 3 );
				put( 'camera', p.x, p.z, face + ( r() - 0.5 ) * 0.8, KIT_SCALE * 1.6 );

			}

			if ( outside && r() < 0.12 ) {

				const name = pick( r, [ 'grandStand', 'grandStandCovered' ] );
				const row = { bend: s, side };

				for ( const along of [ - 1, 1 ] ) {

					path.frameAt( s + along * BUILDING_SCALE * 0.5, f );
					const p = at( f, side, ROAD_HALF + STAND_GAP + kit[ name ].size.z * BUILDING_SCALE / 2 );
					put( name, p.x, p.z, facing( f, side ), BUILDING_SCALE, { row, clear: HUG_CLEAR } );

				}

				path.frameAt( s, f );

			}

			const roll = r();

			if ( roll < 0.07 ) {

				const p = at( f, side, WALL_CLEAR + 1.0 );
				put( pick( r, [ 'billboard', 'billboardLow', 'billboardDouble' ] ), p.x, p.z, face, KIT_SCALE * 1.4 );

			} else if ( roll < 0.12 ) {

				const p = at( f, side, WALL_CLEAR + 0.6 );
				put( pick( r, [ 'flagRed', 'flagGreen', 'flagTankco', 'flagCheckers' ] ), p.x, p.z, face, KIT_SCALE * 1.2 );

			} else if ( roll < 0.14 ) {

				const p = at( f, side, WALL_CLEAR + 0.8 );
				put( r() < 0.5 ? 'bannerTowerRed' : 'bannerTowerGreen', p.x, p.z, face, KIT_SCALE * 1.4 );

			} else if ( roll < 0.19 ) {

				// A few marquees together
				const n = 1 + Math.floor( r() * 3 );
				const lat = WALL_CLEAR + 2.5 + r() * 3;

				for ( let i = 0; i < n; i ++ ) {

					const p = at( f, side, lat + ( r() - 0.5 ) * 1.5, ( i - ( n - 1 ) / 2 ) * 2.4 );
					put( pick( r, [ 'tent', 'tentLong', 'tentClosed', 'tentClosedLong', 'tentRoof', 'tentRoofDouble' ] ), p.x, p.z, face + ( r() < 0.3 ? Math.PI / 2 : 0 ), KIT_SCALE );

				}

			}

			// Bushes on the grass by the track (their own stream), off the pieces
			if ( nature ) {

				const b = mulberry( hash( shapeSeed( path ) ^ station, side > 0 ? 11 : 17 ) );

				for ( let i = 0; i < 2; i ++ ) {

					if ( b() > 0.45 ) continue;
					const p = at( f, side, WALL_CLEAR + 0.6 + b() * 6, ( b() - 0.5 ) * STATION );
					plant( pick( b, NATURE_BUSHES ), p.x, p.z, b() * Math.PI * 2, NATURE_SCALE * ( 1.2 + b() * 0.9 ), { recolor: { grass: pick( b, [ 0x5e9a44, 0x6ea24a, 0x4f8a45 ] ) } }, 0.12 );

				}

			}

			// Trees in the grass between the road and the forest
			for ( let i = 0; i < 2; i ++ ) {

				if ( r() > 0.22 ) continue;
				const p = at( f, side, WALL_CLEAR + 1.5 + r() * 7, ( r() - 0.5 ) * STATION );
				const size = 1.4 + r() * 0.9;

				// Half of them a Nature Kit pine or fir, when it is loaded
				if ( nature && r() < 0.5 ) {

					const leaf = pick( r, leaves );
					plant( pick( r, NATURE_TREES ), p.x, p.z, r() * Math.PI * 2, NATURE_TREE_SCALE * size / 1.7, { recolor: { leafsDark: leaf, leafsGreen: leaf } } );

				} else plant( r() < 0.6 ? 'treeLarge' : 'treeSmall', p.x, p.z, r() * Math.PI * 2, size, { recolor: { grass: pick( r, leaves ) } } );

			}

		}

	}

	group.add( batch.object() );
	group.userData.skipProbeBake = true; // see main.js: a probe under the arch or in a building would darken a whole probe cell
	return group;

}
