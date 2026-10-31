import * as THREE from 'three';
import { ROAD_HALF, ROAD_Y } from './SplineTrack.js';

// Where a spline circuit passes over or across itself (pure, also read by
// Terrain.conform). Two stretches of road overlap where their centrelines come
// closer than a road's width (barriers included) although they are far apart
// along the road. High enough above the other one, the upper stretch is a
// bridge: the ground under it follows the road below (no mound) and the game
// and the editor draw a deck and piers under it. Lower than that, the roads
// cross at the same level: not allowed (the editor refuses it and shows it).
// A segment can also stand on piers by choice (node.p: the segment leaving
// that node): same deck and piers, the ground left as sculpted under it.

export const BRIDGE_CLEARANCE = 4.5; // m between the two road surfaces
const OVERLAP = 2 * ROAD_HALF - 0.2; // centrelines closer: the roads overlap (two corner pieces in a U only touch)
const SAME_STRETCH = 14;            // m along the road: closer samples belong to the same stretch
const STEP = 4;                     // samples between two checks (~1 m)
const DECK_EXTEND = [ 4, 1.5 ];     // m of deck past the overlap, each way: base + per metre of height over the road
                                    // below (the abutments stay out of the line of sight to a car under it, from above)
const DECK_THICK = 0.8;
const DECK_TOP = ROAD_Y - 0.06;     // just under the road surface
const PIER_EVERY = 9;               // m along the deck
const PIER_SIZE = [ 1.1, 2.6 ];     // along, across the road
const PIER_CLEAR = ROAD_HALF + 1.5; // no pier on another road

// Arc length between samples a and b (round the loop when closed)
function along( path, a, b ) {

	const d = Math.abs( path.s[ a ] - path.s[ b ] );
	return path.closed ? Math.min( d, path.length - d ) : d;

}

// { crossing, bridge, deck }: per sample, 1 where the road crosses another
// stretch at the same level / is a bridge over one / stands on a deck (a
// bridge or a segment on piers). crossing is set on both stretches, bridge
// only on the upper one (with DECK_EXTEND on each side, longer the higher it is)
export function roadCrossings( path ) {

	const n = path.sampleCount;
	const crossing = new Uint8Array( n );
	const over = new Float32Array( n ); // height over the road below, 0 = not over it
	const result = { crossing, bridge: new Uint8Array( n ), deck: new Uint8Array( n ), hasCrossing: false, hasBridge: false };
	if ( n < 2 ) return result;

	const cell = OVERLAP;
	const grid = new Map();
	const key = ( gx, gz ) => gx * 65536 + gz;

	for ( let k = 0; k < n; k += STEP ) {

		const id = key( Math.floor( path.px[ k ] / cell ), Math.floor( path.pz[ k ] / cell ) );
		const list = grid.get( id );
		if ( list ) list.push( k );
		else grid.set( id, [ k ] );

	}

	for ( let i = 0; i < n; i += STEP ) {

		const gx = Math.floor( path.px[ i ] / cell ), gz = Math.floor( path.pz[ i ] / cell );

		for ( let a = gx - 1; a <= gx + 1; a ++ ) {

			for ( let b = gz - 1; b <= gz + 1; b ++ ) {

				const list = grid.get( key( a, b ) );
				if ( ! list ) continue;

				for ( const j of list ) {

					if ( j <= i ) continue;
					const dx = path.px[ j ] - path.px[ i ], dz = path.pz[ j ] - path.pz[ i ];
					if ( dx * dx + dz * dz >= OVERLAP * OVERLAP || along( path, i, j ) < SAME_STRETCH ) continue;

					const dy = path.py[ i ] - path.py[ j ];

					if ( Math.abs( dy ) < BRIDGE_CLEARANCE ) {

						crossing[ i ] = crossing[ j ] = 1;
						result.hasCrossing = true;

					} else {

						const k = dy > 0 ? i : j;
						over[ k ] = Math.max( over[ k ], Math.abs( dy ) );

					}

				}

			}

		}

	}

	// Checked samples are STEP apart: fill the gaps, and the deck runs on
	// DECK_EXTEND past the overlap
	spread( path, crossing, 0.6 );
	reach( path, over, result.bridge, ( dy ) => DECK_EXTEND[ 0 ] + DECK_EXTEND[ 1 ] * dy );
	result.hasBridge = result.bridge.includes( 1 );

	// Segments on piers by choice
	const nodes = path.nodes;
	const lastSeg = ( path.closed ? nodes.length : nodes.length - 1 ) - 1;

	for ( let k = 0; k < n; k ++ ) {

		const i = Math.min( Math.floor( path.seg[ k ] ), lastSeg );
		result.deck[ k ] = result.bridge[ k ] || ( i >= 0 && nodes[ i ].p ) ? 1 : 0;

	}

	return result;

}

// Flags every sample within `metres` along the road of a flagged one
function spread( path, flags, metres ) {

	const n = path.sampleCount;
	const src = flags.slice();
	let last = - Infinity;

	for ( let k = 0; k < n; k ++ ) {

		if ( src[ k ] ) last = path.s[ k ];
		else if ( path.s[ k ] - last <= metres ) flags[ k ] = 1;

	}

	last = Infinity;

	for ( let k = n - 1; k >= 0; k -- ) {

		if ( src[ k ] ) last = path.s[ k ];
		else if ( last - path.s[ k ] <= metres ) flags[ k ] = 1;

	}

}

// Flags every sample within extent( v ) m along the road of a sample whose
// value v is > 0 (each its own extent)
function reach( path, values, flags, extent ) {

	const n = path.sampleCount;
	let until = - Infinity;

	for ( let k = 0; k < n; k ++ ) {

		if ( values[ k ] > 0 ) until = Math.max( until, path.s[ k ] + extent( values[ k ] ) );
		if ( path.s[ k ] <= until || values[ k ] > 0 ) flags[ k ] = 1;

	}

	until = Infinity;

	for ( let k = n - 1; k >= 0; k -- ) {

		if ( values[ k ] > 0 ) until = Math.min( until, path.s[ k ] - extent( values[ k ] ) );
		if ( path.s[ k ] >= until ) flags[ k ] = 1;

	}

}

// Runs of flagged samples: [ [ first, last ], … ]
export function spans( flags ) {

	const out = [];
	let start = - 1;

	for ( let k = 0; k <= flags.length; k ++ ) {

		if ( k < flags.length && flags[ k ] ) {

			if ( start < 0 ) start = k;

		} else if ( start >= 0 ) {

			out.push( [ start, k - 1 ] );
			start = - 1;

		}

	}

	return out;

}

// The decks and piers under the bridges: a Mesh (null without any). The
// ground comes from terrain (conformed to path: terrain.crossings, its drawn
// heights). only: the deck spans to build ([ [ k0, k1 ], … ], default all)
export function buildBridges( path, terrain, material, only = null ) {

	const flags = terrain.crossings?.deck;
	if ( ! flags || ! flags.includes( 1 ) ) return null;
	const list = only || spans( flags );
	if ( ! list.length ) return null;

	const pos = [];
	const quad = ( a, b, c, d ) => pos.push( ...a, ...b, ...c, ...a, ...c, ...d ); // a b c d counter-clockwise seen from outside

	for ( const [ k0, k1 ] of list ) {

		// Deck: a slab under the road, sides and ends closed
		const rows = [];

		for ( let k = k0; k <= k1; k = Math.min( k1, k + 2 ) ) {

			const lx = path.tz[ k ] * ROAD_HALF, lz = - path.tx[ k ] * ROAD_HALF;
			const top = path.py[ k ] + DECK_TOP, bottom = top - DECK_THICK;
			const x = path.px[ k ], z = path.pz[ k ];
			rows.push( { l: [ x + lx, z + lz ], r: [ x - lx, z - lz ], top, bottom } );
			if ( k === k1 ) break;

		}

		for ( let i = 0; i + 1 < rows.length; i ++ ) {

			const p = rows[ i ], q = rows[ i + 1 ];
			const v = ( side, y ) => [ side[ 0 ], y, side[ 1 ] ];
			quad( v( p.l, p.top ), v( p.r, p.top ), v( q.r, q.top ), v( q.l, q.top ) ); // top (hidden by the road, closes the slab)
			quad( v( p.r, p.bottom ), v( p.l, p.bottom ), v( q.l, q.bottom ), v( q.r, q.bottom ) ); // underside
			quad( v( p.l, p.bottom ), v( p.l, p.top ), v( q.l, q.top ), v( q.l, q.bottom ) ); // sides
			quad( v( p.r, p.top ), v( p.r, p.bottom ), v( q.r, q.bottom ), v( q.r, q.top ) );

		}

		for ( const [ row, sign ] of [ [ rows[ 0 ], 1 ], [ rows[ rows.length - 1 ], - 1 ] ] ) {

			const v = ( side, y ) => [ side[ 0 ], y, side[ 1 ] ];
			const ends = [ v( row.l, row.bottom ), v( row.r, row.bottom ), v( row.r, row.top ), v( row.l, row.top ) ];
			if ( sign > 0 ) quad( ...ends );
			else quad( ends[ 3 ], ends[ 2 ], ends[ 1 ], ends[ 0 ] );

		}

		// Piers: every PIER_EVERY m where the ground is well below the deck,
		// never on the road passing under
		const length = path.s[ k1 ] - path.s[ k0 ];
		const count = Math.floor( length / PIER_EVERY );

		for ( let p = 1; p <= count; p ++ ) {

			const target = path.s[ k0 ] + length * p / ( count + 1 );
			let k = k0;
			while ( k < k1 && path.s[ k ] < target ) k ++;

			const x = path.px[ k ], z = path.pz[ k ];
			let blocked = false;
			terrain.eachSample( x, z, PIER_CLEAR, ( j ) => { if ( along( path, j, k ) >= SAME_STRETCH ) blocked = true; } );
			if ( blocked ) continue;

			const bottom = path.py[ k ] + DECK_TOP - DECK_THICK;
			const ground = terrain.sample( 'drawn', x, z ) + ROAD_Y - 0.4;
			if ( bottom - ground < 0.6 ) continue;
			box( pos, x, z, path.tx[ k ], path.tz[ k ], ground, bottom, PIER_SIZE[ 0 ] / 2, PIER_SIZE[ 1 ] / 2 );

		}

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	geometry.computeVertexNormals();
	const mesh = new THREE.Mesh( geometry, material );
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;

}

// A box from y0 to y1 centred on (x, z), its long side across the road (t = road direction)
function box( pos, x, z, tx, tz, y0, y1, along, across ) {

	const ax = tx * along, az = tz * along; // along the road
	const cx = tz * across, cz = - tx * across; // across
	const c = [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ].map( ( [ u, w ] ) => [ x + ax * u + cx * w, z + az * u + cz * w ] );
	const at = ( i, y ) => [ c[ i ][ 0 ], y, c[ i ][ 1 ] ];

	for ( let i = 0; i < 4; i ++ ) {

		const j = ( i + 1 ) % 4;
		pos.push( ...at( i, y0 ), ...at( j, y0 ), ...at( j, y1 ), ...at( i, y0 ), ...at( j, y1 ), ...at( i, y1 ) );

	}

}

// The bridges' concrete
export function bridgeMaterial() {

	return new THREE.MeshStandardMaterial( { color: 0xcfd3da, roughness: 0.92, flatShading: true, side: THREE.DoubleSide } );

}

// ─── Seeing the car under a bridge ────────────────────────
// A bridge hides the car driving under it (the view from above most of all):
// while a deck stands between the camera and the car, that bridge (its road,
// barriers, deck and piers) fades to FADE_OPACITY.

const FADE_OPACITY = 1 / 3;
const FADE_RATE = 8;       // 1/s, how fast it fades in and out
const UNDER = 1.5;         // m: a deck at least this much above the car can hide it
// Depth only, drawn just before a faded bridge (transparent too, to come after the car)
const PREPASS = new THREE.MeshBasicMaterial( { colorWrite: false, transparent: true, side: THREE.DoubleSide } );

// Splits the bridges out of the scenery so each can fade on its own: the road
// mesh loses its triangles on bridge decks (into one mesh per bridge, sharing
// its vertices, with a transparent copy of its material), decks and piers are
// built per bridge. Returns { group (static decks + the bridges), update( car,
// camera, dt ) }, or null when the road never passes over itself.
export function fadingBridges( path, terrain, road ) {

	const c = terrain.crossings;
	if ( ! c ) return null;

	const deckSpans = spans( c.deck );
	const fading = deckSpans.filter( ( [ k0, k1 ] ) => c.bridge.subarray( k0, k1 + 1 ).includes( 1 ) );
	const fixed = deckSpans.filter( ( s ) => ! fading.includes( s ) );
	const group = new THREE.Group();

	const still = buildBridges( path, terrain, bridgeMaterial(), fixed );
	if ( still ) group.add( still );
	if ( ! fading.length ) return still ? { group, update() {} } : null;

	// Each bridge: the box around its deck, its samples
	const bridges = fading.map( ( [ k0, k1 ] ) => {

		let x0 = Infinity, x1 = - Infinity, z0 = Infinity, z1 = - Infinity, y0 = Infinity, y1 = - Infinity;

		for ( let k = k0; k <= k1; k ++ ) {

			x0 = Math.min( x0, path.px[ k ] ); x1 = Math.max( x1, path.px[ k ] );
			z0 = Math.min( z0, path.pz[ k ] ); z1 = Math.max( z1, path.pz[ k ] );
			y0 = Math.min( y0, path.py[ k ] ); y1 = Math.max( y1, path.py[ k ] );

		}

		const m = ROAD_HALF + 1;
		return { k0, k1, box: { x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m, y0: y0 + ROAD_Y - 2.5, y1: y1 + ROAD_Y + 2.5 }, indices: [], opacity: 1, materials: [] };

	} );

	// The road's triangles on a deck go to their bridge
	const geometry = road.geometry;
	const index = geometry.index.array, pos = geometry.attributes.position.array;
	const rest = [];

	for ( let t = 0; t < index.length; t += 3 ) {

		const a = index[ t ] * 3, b = index[ t + 1 ] * 3, d = index[ t + 2 ] * 3;
		const x = ( pos[ a ] + pos[ b ] + pos[ d ] ) / 3, y = ( pos[ a + 1 ] + pos[ b + 1 ] + pos[ d + 1 ] ) / 3, z = ( pos[ a + 2 ] + pos[ b + 2 ] + pos[ d + 2 ] ) / 3;
		const owner = bridges.find( ( br ) => {

			const B = br.box;
			if ( x < B.x0 || x > B.x1 || z < B.z0 || z > B.z1 || y < B.y0 || y > B.y1 ) return false;

			for ( let k = br.k0; k <= br.k1; k += 2 ) {

				const dx = path.px[ k ] - x, dz = path.pz[ k ] - z;
				if ( dx * dx + dz * dz < ( ROAD_HALF + 0.5 ) ** 2 && Math.abs( y - path.py[ k ] - ROAD_Y ) < 2.5 ) return true;

			}

			return false;

		} );

		( owner ? owner.indices : rest ).push( index[ t ], index[ t + 1 ], index[ t + 2 ] );

	}

	geometry.setIndex( rest );

	for ( const br of bridges ) {

		const roadMaterial = road.material.clone();
		const part = new THREE.BufferGeometry();
		for ( const name in geometry.attributes ) part.setAttribute( name, geometry.attributes[ name ] );
		part.setIndex( br.indices );
		const mesh = new THREE.Mesh( part, roadMaterial );
		mesh.castShadow = mesh.receiveShadow = true;

		const deckMaterial = bridgeMaterial();
		const deck = buildBridges( path, terrain, deckMaterial, [ [ br.k0, br.k1 ] ] );
		br.materials = [ roadMaterial, deckMaterial ];
		br.indices = null;
		// Transparent from the start: three compiles an opaque material with
		// its alpha forced to 1, and turning transparent on later would need a
		// recompile (a stutter right as the car goes under)
		for ( const m of br.materials ) m.transparent = true;

		// Faded, the bridge is several layers deep (road, deck top, underside,
		// sides): each at 1/3 they added up to nearly opaque. A depth pre-pass
		// (shown only while fading) keeps just the nearest surface, blended once
		br.prepass = [];

		// Drawn first among the transparent objects (renderOrder < 0): drawn
		// after them (sorted by its centre, far off), a bridge — opaque at full
		// opacity, but in the transparent list — painted over the ghost or the
		// tyre marks on it (they don't write depth): the ghost vanished on bridges
		for ( const m of deck ? [ mesh, deck ] : [ mesh ] ) {

			m.renderOrder = - 1;
			group.add( m );
			const depth = new THREE.Mesh( m.geometry, PREPASS );
			depth.renderOrder = - 2;
			depth.visible = false;
			group.add( depth );
			br.prepass.push( depth );

		}

	}

	const ray = new THREE.Vector3();

	return {

		group,

		// car: its position (world), camera: the view's camera, dt: seconds
		update( car, camera, dt ) {

			ray.copy( camera.position ).sub( car );

			for ( const br of bridges ) {

				const B = br.box;
				let hides = false;

				// Only near the bridge and under its deck
				if ( car.x > B.x0 - 25 && car.x < B.x1 + 25 && car.z > B.z0 - 25 && car.z < B.z1 + 25 && car.y < B.y1 ) {

					for ( let k = br.k0; k <= br.k1 && ! hides; k += 4 ) {

						const deckY = path.py[ k ] + ROAD_Y;
						if ( deckY < car.y + UNDER || ray.y <= deckY - car.y ) continue; // not above the car, or the camera under it
						const t = ( deckY - car.y ) / ray.y; // where the car → camera line crosses the deck's height
						const dx = car.x + ray.x * t - path.px[ k ], dz = car.z + ray.z * t - path.pz[ k ];
						hides = dx * dx + dz * dz < ( ROAD_HALF + 0.5 ) ** 2;

					}

				}

				const target = hides ? FADE_OPACITY : 1;
				if ( br.opacity === target ) continue;
				br.opacity += ( target - br.opacity ) * ( 1 - Math.exp( - dt * FADE_RATE ) );
				if ( Math.abs( br.opacity - target ) < 0.01 ) br.opacity = target;

				for ( const m of br.materials ) m.opacity = br.opacity;

				for ( const d of br.prepass ) d.visible = br.opacity < 1;

			}

		},

	};

}

// The lowest deck bottom over (x, z) within r (a plant's half width), in
// world units, or Infinity: a plant whose top would reach it does not grow
// there (right beside the deck is fine)
export function headroom( path, terrain, x, z, r = 0 ) {

	const deck = terrain.crossings?.deck;
	if ( ! deck || ! terrain.samples ) return Infinity;
	let low = Infinity;

	terrain.eachSample( x, z, ROAD_HALF + r, ( k ) => {

		if ( deck[ k ] ) low = Math.min( low, path.py[ k ] + DECK_TOP - DECK_THICK );

	} );

	return low;

}
