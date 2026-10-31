import * as THREE from 'three';
import { ROAD_HALF, ROAD_Y } from './SplineTrack.js';
import { roadCrossings } from './Bridges.js';
import { rockOf, vertexRock, rockField, onRockField, rockShader } from './RockEdge.js';

// Endless heightmap on a 2 m grid, kept in square chunks of CHUNK × CHUNK
// vertices that only exist where something differs from flat ground (a
// sculpted chunk, or one the road reshapes): everywhere else the ground is
// flat at 0. Grid vertex (i, j) stands at x = i * STEP, z = j * STEP, in the
// chunk ( i >> SHIFT, j >> SHIFT ). Per chunk: `sculpt` = the heights painted
// by the user; `height` = the final ground once conformed to the road
// (flattened under it, with embankments / cuttings blending back to `sculpt`);
// `drawn` = `height` kept under every stretch of road (what the mesh shows).
// On the road the car drives on the road itself (`groundAt`), not on the grid.

export const TERRAIN_STEP = 2;
export const CHUNK = 32; // vertices per chunk side
export const CHUNK_SIZE = CHUNK * TERRAIN_STEP; // 64 m
export const TERRAIN_LIMIT = 10000; // m from the origin: nodes, brushes and camera stay inside
export const HEIGHT_MIN = - 30;
export const HEIGHT_MAX = 30;
export const HEIGHT_QUANT = 0.25;

const SHIFT = 5; // log2( CHUNK )
const MASK = CHUNK - 1;
const LIMIT_INDEX = TERRAIN_LIMIT / TERRAIN_STEP;

// Circuits saved before the endless terrain: a 400 m square of 201 × 201
// vertices centred on the origin (still written when everything sculpted
// fits in it, so those circuits keep their exact data and id)
export const LEGACY_N = 201;
const LEGACY_HALF = ( LEGACY_N - 1 ) / 2;

// Fully flattened around the centerline: every grid vertex of a cell the road
// (barriers included) passes over, so no drawn triangle rises through it
const FLAT_RADIUS = ROAD_HALF + TERRAIN_STEP * Math.SQRT2 + 0.1;
const CELL_MARGIN = 0.3; // m around a vertex's cells: road between two hashed cross-sections
const HASH_CELL = 4; // m, cells of the road samples' spatial hash
const EMBANK_MIN = 2;
const EMBANK_MAX = 14;
const EMBANK_SLOPE = 1.5;               // horizontal metres per metre of height difference
const CONFORM_RADIUS = FLAT_RADIUS + EMBANK_MAX;

function smoothstep( t ) {

	return t * t * ( 3 - 2 * t );

}

export function chunkKey( ci, cj ) {

	return ci * 65536 + cj;

}

function makeChunk( ci, cj ) {

	const count = CHUNK * CHUNK;
	return {
		ci, cj,
		sculpt: new Float32Array( count ),
		height: new Float32Array( count ),
		drawn: new Float32Array( count ),
		roadDist: new Float32Array( count ).fill( Infinity ),
		roadK: new Int32Array( count ),
		deckDist: new Float32Array( count ).fill( Infinity ), // squared distance to the nearest deck sample (keepUnderRoads)
		rev: ++ revisions, // `revisions` when `drawn` last changed (TerrainMeshes)
	};

}

let revisions = 0; // shared by every terrain: a mesh never mistakes a new terrain's chunk for an old one

const quantize = ( h ) => Math.max( - 127, Math.min( 127, Math.round( h / HEIGHT_QUANT ) ) );

export class Terrain {

	constructor() {

		this.chunks = new Map(); // chunkKey → chunk
		this.path = null;
		this.splatPath = null; // the path roadDist / roadK / deckDist were splatted for
		this.samples = null; // spatial hash of the road samples (conform)
		this.crossings = null; // Bridges.roadCrossings of the path (conform)
		const drawn = ( i, j ) => this.value( 'drawn', i, j );
		this.vertexRockAt = ( i, j ) => vertexRock( drawn, i, j, TERRAIN_STEP );
		this.rockAt = ( x, z ) => this.rockField( x, z );

	}

	// From decodeTrack's `terrain` ({ size, bytes } or null): the old 201 × 201
	// square or chunks (size 0); anything else is flat ground
	static fromData( data ) {

		const terrain = new Terrain();
		if ( ! data ) return terrain;
		const bytes = data.bytes;

		if ( data.size === LEGACY_N ) {

			const view = new Int8Array( bytes.buffer, bytes.byteOffset, bytes.length );

			for ( let idx = 0; idx < LEGACY_N * LEGACY_N && idx < view.length; idx ++ ) {

				if ( view[ idx ] !== 0 ) terrain.setSculpt( idx % LEGACY_N - LEGACY_HALF, Math.floor( idx / LEGACY_N ) - LEGACY_HALF, view[ idx ] * HEIGHT_QUANT );

			}

		} else if ( data.size === 0 && bytes.length >= 2 ) {

			// uint16 count, then per chunk: int16 ci, int16 cj, CHUNK² int8 heights
			const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.length );
			const count = view.getUint16( 0, true );
			const size = 4 + CHUNK * CHUNK;
			const limit = LIMIT_INDEX >> SHIFT;

			for ( let n = 0, o = 2; n < count && o + size <= bytes.length; n ++, o += size ) {

				const ci = view.getInt16( o, true ), cj = view.getInt16( o + 2, true );
				if ( Math.abs( ci ) > limit || Math.abs( cj ) > limit ) continue;
				const c = terrain.ensure( ci, cj );
				for ( let k = 0; k < CHUNK * CHUNK; k ++ ) c.sculpt[ k ] = view.getInt8( o + 4 + k ) * HEIGHT_QUANT;

			}

		}

		for ( const c of terrain.chunks.values() ) {

			c.height.set( c.sculpt );
			c.drawn.set( c.sculpt );

		}

		return terrain;

	}

	// For encodeTrack: { size, bytes } (the old square when it holds every
	// sculpted vertex, else chunks), null when the ground is flat
	toData() {

		const parts = [];
		let legacy = true;

		for ( const c of this.chunks.values() ) {

			const q = new Int8Array( CHUNK * CHUNK );
			let any = false;

			for ( let k = 0; k < q.length; k ++ ) {

				q[ k ] = quantize( c.sculpt[ k ] );
				if ( q[ k ] === 0 ) continue;
				any = true;
				const i = ( c.ci << SHIFT ) + ( k & MASK ), j = ( c.cj << SHIFT ) + ( k >> SHIFT );
				if ( Math.abs( i ) > LEGACY_HALF || Math.abs( j ) > LEGACY_HALF ) legacy = false;

			}

			if ( any ) parts.push( { ci: c.ci, cj: c.cj, q } );

		}

		if ( parts.length === 0 ) return null;

		if ( legacy ) {

			const out = new Int8Array( LEGACY_N * LEGACY_N );

			for ( const { ci, cj, q } of parts ) {

				for ( let k = 0; k < q.length; k ++ ) {

					if ( q[ k ] === 0 ) continue;
					const i = ( ci << SHIFT ) + ( k & MASK ) + LEGACY_HALF, j = ( cj << SHIFT ) + ( k >> SHIFT ) + LEGACY_HALF;
					out[ j * LEGACY_N + i ] = q[ k ];

				}

			}

			return { size: LEGACY_N, bytes: new Uint8Array( out.buffer ) };

		}

		parts.sort( ( a, b ) => a.cj - b.cj || a.ci - b.ci );
		const size = 4 + CHUNK * CHUNK;
		const bytes = new Uint8Array( 2 + parts.length * size );
		const view = new DataView( bytes.buffer );
		view.setUint16( 0, parts.length, true );

		parts.forEach( ( { ci, cj, q }, n ) => {

			const o = 2 + n * size;
			view.setInt16( o, ci, true );
			view.setInt16( o + 2, cj, true );
			bytes.set( new Uint8Array( q.buffer ), o + 4 );

		} );

		return { size: 0, bytes };

	}

	isFlat() {

		for ( const c of this.chunks.values() ) {

			for ( let k = 0; k < c.sculpt.length; k ++ ) if ( Math.abs( c.sculpt[ k ] ) >= HEIGHT_QUANT / 2 ) return false;

		}

		return true;

	}

	// ─── Chunks ───────────────────────────────────────────

	chunk( ci, cj ) {

		return this.chunks.get( chunkKey( ci, cj ) );

	}

	ensure( ci, cj ) {

		const key = chunkKey( ci, cj );
		let c = this.chunks.get( key );

		if ( ! c ) {

			c = makeChunk( ci, cj );
			this.chunks.set( key, c );

		}

		return c;

	}

	// A vertex's value of one of the chunk fields (flat ground: 0)
	value( field, i, j ) {

		const c = this.chunks.get( chunkKey( i >> SHIFT, j >> SHIFT ) );
		return c ? c[ field ][ ( ( j & MASK ) << SHIFT ) | ( i & MASK ) ] : 0;

	}

	setSculpt( i, j, h ) {

		this.ensure( i >> SHIFT, j >> SHIFT ).sculpt[ ( ( j & MASK ) << SHIFT ) | ( i & MASK ) ] = h;

	}

	// Sculpt every vertex of a world rectangle with fn( x, z )
	sculptWith( fn, x0, z0, x1, z1 ) {

		for ( let j = Math.ceil( z0 / TERRAIN_STEP ); j <= Math.floor( z1 / TERRAIN_STEP ); j ++ ) {

			for ( let i = Math.ceil( x0 / TERRAIN_STEP ); i <= Math.floor( x1 / TERRAIN_STEP ); i ++ ) {

				this.setSculpt( i, j, fn( i * TERRAIN_STEP, j * TERRAIN_STEP ) );

			}

		}

	}

	// fn( chunk, idx, i, j ) for every vertex of [ i0, i1 ] × [ j0, j1 ],
	// creating the chunks it needs
	eachVertex( i0, j0, i1, j1, fn ) {

		for ( let cj = j0 >> SHIFT; cj <= j1 >> SHIFT; cj ++ ) {

			const b0 = Math.max( j0, cj << SHIFT ), b1 = Math.min( j1, ( cj << SHIFT ) + MASK );

			for ( let ci = i0 >> SHIFT; ci <= i1 >> SHIFT; ci ++ ) {

				const c = this.ensure( ci, cj );
				const a0 = Math.max( i0, ci << SHIFT ), a1 = Math.min( i1, ( ci << SHIFT ) + MASK );

				for ( let j = b0; j <= b1; j ++ ) {

					const row = ( j & MASK ) << SHIFT;
					for ( let i = a0; i <= a1; i ++ ) fn( c, row | ( i & MASK ), i, j );

				}

			}

		}

	}

	// The user's sculpt, to put back later (undo)
	snapshot() {

		const out = new Map();

		for ( const [ key, c ] of this.chunks ) {

			if ( c.sculpt.some( ( h ) => h !== 0 ) ) out.set( key, { ci: c.ci, cj: c.cj, sculpt: c.sculpt.slice() } );

		}

		return out;

	}

	restore( snapshot ) {

		for ( const [ key, c ] of this.chunks ) {

			const s = snapshot.get( key );
			if ( s ) c.sculpt.set( s.sculpt );
			else c.sculpt.fill( 0 );

		}

		for ( const s of snapshot.values() ) this.ensure( s.ci, s.cj ).sculpt.set( s.sculpt );

	}

	clearSculpt() {

		for ( const c of this.chunks.values() ) c.sculpt.fill( 0 );

	}

	// ─── Sampling ─────────────────────────────────────────

	// The four vertices of the grid cell (i, j)..(i+1, j+1) of a field, into
	// a shared array: h00, h10, h01, h11
	cell( field, i, j ) {

		if ( ( i & MASK ) !== MASK && ( j & MASK ) !== MASK ) {

			const c = this.chunks.get( chunkKey( i >> SHIFT, j >> SHIFT ) );

			if ( ! c ) {

				_cell[ 0 ] = _cell[ 1 ] = _cell[ 2 ] = _cell[ 3 ] = 0;

			} else {

				const arr = c[ field ], k = ( ( j & MASK ) << SHIFT ) | ( i & MASK );
				_cell[ 0 ] = arr[ k ];
				_cell[ 1 ] = arr[ k + 1 ];
				_cell[ 2 ] = arr[ k + CHUNK ];
				_cell[ 3 ] = arr[ k + CHUNK + 1 ];

			}

		} else {

			_cell[ 0 ] = this.value( field, i, j );
			_cell[ 1 ] = this.value( field, i + 1, j );
			_cell[ 2 ] = this.value( field, i, j + 1 );
			_cell[ 3 ] = this.value( field, i + 1, j + 1 );

		}

		return _cell;

	}

	// Bilinear height of a field ('sculpt', 'height' or 'drawn') at (x, z)
	sample( field, x, z ) {

		const fx = x / TERRAIN_STEP, fz = z / TERRAIN_STEP;
		const i = Math.floor( fx ), j = Math.floor( fz );
		const tx = fx - i, tz = fz - j;
		const h = this.cell( field, i, j );

		return ( h[ 0 ] * ( 1 - tx ) + h[ 1 ] * tx ) * ( 1 - tz ) + ( h[ 2 ] * ( 1 - tx ) + h[ 3 ] * tx ) * tz;

	}


	heightAt( x, z ) {

		return this.sample( 'height', x, z );

	}

	sculptAt( x, z ) {

		return this.sample( 'sculpt', x, z );

	}

	normalAt( x, z, out = new THREE.Vector3() ) {

		const d = TERRAIN_STEP;
		return out.set(
			this.heightAt( x - d, z ) - this.heightAt( x + d, z ),
			2 * d,
			this.heightAt( x, z - d ) - this.heightAt( x, z + d )
		).normalize();

	}

	// Height range of the final ground inside a world rectangle
	range( x0, z0, x1, z1 ) {

		const i0 = Math.round( x0 / TERRAIN_STEP ), i1 = Math.round( x1 / TERRAIN_STEP );
		const j0 = Math.round( z0 / TERRAIN_STEP ), j1 = Math.round( z1 / TERRAIN_STEP );
		let min = Infinity, max = - Infinity, covered = 0;

		for ( const c of this.chunks.values() ) {

			const a0 = Math.max( i0, c.ci << SHIFT ), a1 = Math.min( i1, ( c.ci << SHIFT ) + MASK );
			const b0 = Math.max( j0, c.cj << SHIFT ), b1 = Math.min( j1, ( c.cj << SHIFT ) + MASK );
			if ( a0 > a1 || b0 > b1 ) continue;
			covered += ( a1 - a0 + 1 ) * ( b1 - b0 + 1 );

			for ( let j = b0; j <= b1; j ++ ) {

				for ( let i = a0; i <= a1; i ++ ) {

					const h = c.height[ ( ( j & MASK ) << SHIFT ) | ( i & MASK ) ];
					if ( h < min ) min = h;
					if ( h > max ) max = h;

				}

			}

		}

		// Vertices outside every chunk: flat ground
		if ( covered < ( i1 - i0 + 1 ) * ( j1 - j0 + 1 ) ) {

			min = Math.min( min, 0 );
			max = Math.max( max, 0 );

		}

		return { min, max };

	}

	// ─── Road conforming ──────────────────────────────────

	conform( path ) {

		const STRIDE = 2;
		const hasPath = path && path.sampleCount >= 2;

		// Where the road passes only depends on the path: a brush stroke keeps it
		if ( path !== this.splatPath ) {

			this.splat( hasPath ? path : null, STRIDE );
			this.splatPath = path;

		}

		const last = hasPath ? path.sampleCount - 1 : 0;

		for ( const c of this.chunks.values() ) {

			const i0 = c.ci << SHIFT, j0 = c.cj << SHIFT;

			for ( let idx = 0; idx < c.height.length; idx ++ ) {

				const s = c.sculpt[ idx ];

				if ( c.roadDist[ idx ] === Infinity ) {

					c.height[ idx ] = s;
					continue;

				}

				// Refine: exact projection onto the polyline segments around the nearest sample,
				// so the height matches the road on slopes (a sample-snapped height could poke through)
				const vx = ( i0 + ( idx & MASK ) ) * TERRAIN_STEP;
				const vz = ( j0 + ( idx >> SHIFT ) ) * TERRAIN_STEP;
				const k0 = c.roadK[ idx ];
				let d2 = Infinity, r = 0;

				for ( let a = Math.max( 0, k0 - STRIDE ); a < Math.min( last, k0 + STRIDE ); a ++ ) {

					const ax = path.px[ a ], az = path.pz[ a ];
					const ex = path.px[ a + 1 ] - ax, ez = path.pz[ a + 1 ] - az;
					const len2 = ex * ex + ez * ez;
					const t = len2 > 0 ? THREE.MathUtils.clamp( ( ( vx - ax ) * ex + ( vz - az ) * ez ) / len2, 0, 1 ) : 0;
					const qx = ax + ex * t - vx, qz = az + ez * t - vz;
					const dd = qx * qx + qz * qz;

					if ( dd < d2 ) {

						d2 = dd;
						r = path.py[ a ] + ( path.py[ a + 1 ] - path.py[ a ] ) * t;

					}

				}

				const d = Math.sqrt( d2 );
				let w = 1;

				if ( d > FLAT_RADIUS ) {

					const embank = THREE.MathUtils.clamp( Math.abs( s - r ) * EMBANK_SLOPE, EMBANK_MIN, EMBANK_MAX );
					const t = ( d - FLAT_RADIUS ) / embank;
					w = t >= 1 ? 0 : 1 - smoothstep( t );

				}

				c.height[ idx ] = s + ( r - s ) * w;

			}

		}

		this.path = hasPath ? path : null;
		this.keepUnderRoads();
		this.prune();

	}

	// Splat path samples onto nearby grid vertices, keeping the closest one
	// (roadDist, roadK), creating the chunks the road reshapes. Not a deck's
	// (bridge, segment on piers): the ground under it stays as it is / follows
	// the road below
	splat( path, STRIDE ) {

		for ( const c of this.chunks.values() ) {

			c.roadDist.fill( Infinity );
			c.deckDist.fill( Infinity );

		}

		this.crossings = path ? roadCrossings( path ) : null;
		this.samples = path ? hashSamples( path ) : null;
		if ( ! path ) return;

		const reach = Math.ceil( CONFORM_RADIUS / TERRAIN_STEP );
		const deckReach = Math.ceil( ( ROAD_HALF + ( TERRAIN_STEP + CELL_MARGIN ) * Math.SQRT2 ) / TERRAIN_STEP );
		const deck = this.crossings.deck;

		for ( let k = 0; k < path.sampleCount; k += STRIDE ) {

			const px = path.px[ k ], pz = path.pz[ k ];
			const ci = Math.round( px / TERRAIN_STEP ), cj = Math.round( pz / TERRAIN_STEP );

			// A deck's samples don't flatten the ground, but it still has to be
			// kept under them (keepUnderRoads): only remember how close they are
			if ( deck[ k ] ) {

				this.eachVertex( ci - deckReach, cj - deckReach, ci + deckReach, cj + deckReach, ( c, idx, i, j ) => {

					const dx = i * TERRAIN_STEP - px, dz = j * TERRAIN_STEP - pz;
					c.deckDist[ idx ] = Math.min( c.deckDist[ idx ], dx * dx + dz * dz );

				} );

				continue;

			}

			this.eachVertex( ci - reach, cj - reach, ci + reach, cj + reach, ( c, idx, i, j ) => {

				const dx = i * TERRAIN_STEP - px, dz = j * TERRAIN_STEP - pz;
				const d = dx * dx + dz * dz;

				if ( d < c.roadDist[ idx ] ) {

					c.roadDist[ idx ] = d;
					c.roadK[ idx ] = k;

				}

			} );

		}

	}

	// drawn = height, but no vertex stands above a stretch of road crossing one
	// of its cells (the triangles it belongs to): for each road cross-section
	// (a sample, ROAD_HALF each side) through the vertex's cells, the vertex
	// stays at or under that road. A road beside another one at another height
	// (a hairpin on a slope, two straights side by side) then never gets grass
	// through it; the car does not care (it drives on the road, groundAt)
	keepUnderRoads() {

		const path = this.path;
		const end = path ? path.sampleCount - 1 : 0;
		const box = TERRAIN_STEP + CELL_MARGIN; // the vertex's cells, half side
		const reach = ROAD_HALF + box * Math.SQRT2;

		for ( const c of this.chunks.values() ) {

			const i0 = c.ci << SHIFT, j0 = c.cj << SHIFT;
			let changed = false;

			for ( let idx = 0; idx < c.height.length; idx ++ ) {

				let cap = c.height[ idx ];

				// Near a road: an ordinary one or a deck (a bridge, a segment on piers,
				// whose samples don't conform the ground: it used to poke through them)
				if ( path && ( c.roadDist[ idx ] <= reach * reach || c.deckDist[ idx ] <= reach * reach ) ) {

					const vx = ( i0 + ( idx & MASK ) ) * TERRAIN_STEP;
					const vz = ( j0 + ( idx >> SHIFT ) ) * TERRAIN_STEP;

					this.eachSample( vx, vz, reach, ( k ) => {

						const low = Math.min( path.py[ k ], path.py[ Math.min( end, k + 1 ) ], path.py[ Math.min( end, k + 2 ) ] );
						if ( low >= cap ) return;
						const a = Math.max( 0, k - 1 ), b = Math.min( end, k + 1 );
						const tx = path.px[ b ] - path.px[ a ], tz = path.pz[ b ] - path.pz[ a ];
						const len = Math.hypot( tx, tz ) || 1;
						// cross-section from the left edge to the right edge
						if ( segmentHitsBox( path.px[ k ] + tz / len * ROAD_HALF, path.pz[ k ] - tx / len * ROAD_HALF, - 2 * tz / len * ROAD_HALF, 2 * tx / len * ROAD_HALF, vx, vz, box ) ) cap = low;

					} );

				}

				if ( c.drawn[ idx ] !== cap ) {

					c.drawn[ idx ] = cap;
					changed = true;

				}

			}

			if ( changed ) c.rev = ++ revisions;

		}

	}

	// Drops the chunks that hold nothing but flat ground away from the road
	prune() {

		for ( const [ key, c ] of this.chunks ) {

			if ( c.sculpt.some( ( h ) => h !== 0 ) || c.drawn.some( ( h ) => h !== 0 ) ) continue;
			if ( c.roadDist.some( ( d ) => d !== Infinity ) || c.deckDist.some( ( d ) => d !== Infinity ) ) continue;
			this.chunks.delete( key );

		}

	}

	// Calls fn( k ) for every hashed road sample within r of (x, z)
	eachSample( x, z, r, fn ) {

		const path = this.path, reach = Math.ceil( r / HASH_CELL ), r2 = r * r;
		const gx = Math.floor( x / HASH_CELL ), gz = Math.floor( z / HASH_CELL );

		for ( let a = gx - reach; a <= gx + reach; a ++ ) {

			for ( let b = gz - reach; b <= gz + reach; b ++ ) {

				const list = this.samples.get( a * 65536 + b );
				if ( ! list ) continue;

				for ( const k of list ) {

					const dx = path.px[ k ] - x, dz = path.pz[ k ] - z;
					if ( dx * dx + dz * dz <= r2 ) fn( k );

				}

			}

		}

	}

	// Ground under (x, z) for a car at height y (terrain units, without
	// ROAD_Y): on a stretch of road the road itself (the stretch nearest to y
	// where two overlap), else the terrain. Writes the normal into `normal`
	groundAt( x, z, y, normal ) {

		const path = this.path;

		if ( path ) {

			// Stretches under (x, z), nearest to the car's height first
			const near = [];
			this.eachSample( x, z, ROAD_HALF + 0.5, ( k ) => near.push( k ) );
			near.sort( ( a, b ) => Math.abs( path.py[ a ] - y ) - Math.abs( path.py[ b ] - y ) );

			for ( const k of near ) {

				const road = this.roadAt( x, z, k, normal );
				if ( road !== null ) return road;

			}

		}

		this.normalAt( x, z, normal );
		return this.heightAt( x, z );

	}

	// The road of the stretch around sample k under (x, z): projection on the
	// centreline (the road is flat across), or null if (x, z) is off that road
	roadAt( x, z, k, normal ) {

		const path = this.path;
		const end = path.sampleCount - 1;
		const span = Math.ceil( ( ROAD_HALF + 1 ) / 0.2 ); // samples are ≤ 0.25 m apart
		let d2 = Infinity, y = 0, a0 = 0;

		for ( let a = Math.max( 0, k - span ); a < Math.min( end, k + span ); a ++ ) {

			const ax = path.px[ a ], az = path.pz[ a ];
			const ex = path.px[ a + 1 ] - ax, ez = path.pz[ a + 1 ] - az;
			const len2 = ex * ex + ez * ez;
			const t = len2 > 0 ? THREE.MathUtils.clamp( ( ( x - ax ) * ex + ( z - az ) * ez ) / len2, 0, 1 ) : 0;
			const qx = ax + ex * t - x, qz = az + ez * t - z;
			const dd = qx * qx + qz * qz;

			if ( dd < d2 ) {

				d2 = dd;
				a0 = a;
				y = path.py[ a ] + ( path.py[ a + 1 ] - path.py[ a ] ) * t;

			}

		}

		if ( d2 > ROAD_HALF * ROAD_HALF ) return null;

		// Normal: the grade along the road, level across it
		const ex = path.px[ a0 + 1 ] - path.px[ a0 ], ez = path.pz[ a0 + 1 ] - path.pz[ a0 ];
		const ey = path.py[ a0 + 1 ] - path.py[ a0 ];
		const len = Math.hypot( ex, ez ) || 1;
		const grade = ey / len;
		normal.set( - ex / len * grade, 1, - ez / len * grade ).normalize();
		return y;

	}

	// The facet of the drawn mesh under (x, z) (same triangles as
	// chunkGeometry): its height (terrain units) and normal into `normal`
	drawnFacet( x, z, normal ) {

		const S = TERRAIN_STEP;
		const fx = x / S, fz = z / S;
		const i = Math.floor( fx ), j = Math.floor( fz );
		const u = fx - i, v = fz - j;
		const cell = this.cell( 'drawn', i, j );
		const h00 = cell[ 0 ], h10 = cell[ 1 ], h01 = cell[ 2 ], h11 = cell[ 3 ];
		let h, dx, dz;

		// Diagonal (i, j+1) – (i+1, j), as chunkGeometry
		if ( u + v <= 1 ) {

			dx = ( h10 - h00 ) / S;
			dz = ( h01 - h00 ) / S;
			h = h00 + u * S * dx + v * S * dz;

		} else {

			dx = ( h11 - h01 ) / S;
			dz = ( h11 - h10 ) / S;
			h = h11 - ( 1 - u ) * S * dx - ( 1 - v ) * S * dz;

		}

		if ( normal ) normal.set( - dx, 1, - dz ).normalize();
		return h;

	}

	// Is the ground drawn as rock at (x, z) or within r of it: nothing grows
	// there (RockEdge.js: the field the ground's shader draws)
	isRock( x, z, r = 0.6 ) {

		return onRockField( this.rockAt, x, z, r );

	}

	// The rock field at (x, z), as the ground's aRock attribute
	rockField( x, z ) {

		return rockField( this.vertexRockAt, x, z, TERRAIN_STEP );

	}

	// ─── Sculpting ────────────────────────────────────────
	// mode: 'raise' | 'lower' | 'smooth' | 'flatten'. Returns true if anything changed.

	brush( mode, x, z, radius, amount, target = 0 ) {

		const reach = Math.ceil( radius / TERRAIN_STEP );
		const ci = Math.round( x / TERRAIN_STEP );
		const cj = Math.round( z / TERRAIN_STEP );
		const i0 = Math.max( - LIMIT_INDEX, ci - reach ), i1 = Math.min( LIMIT_INDEX, ci + reach );
		const j0 = Math.max( - LIMIT_INDEX, cj - reach ), j1 = Math.min( LIMIT_INDEX, cj + reach );
		if ( i0 > i1 || j0 > j1 ) return false;

		// Every new height from the heights before the stroke (smooth reads its neighbours)
		const updates = [];

		for ( let j = j0; j <= j1; j ++ ) {

			const dz = j * TERRAIN_STEP - z;

			for ( let i = i0; i <= i1; i ++ ) {

				const dx = i * TERRAIN_STEP - x;
				const q = ( dx * dx + dz * dz ) / ( radius * radius );
				if ( q >= 1 ) continue;

				const falloff = ( 1 - q ) * ( 1 - q );
				const h = this.value( 'sculpt', i, j );
				let next = h;

				if ( mode === 'raise' ) next = h + amount * falloff;
				else if ( mode === 'lower' ) next = h - amount * falloff;
				else if ( mode === 'flatten' ) next = h + ( target - h ) * Math.min( 1, amount * 0.35 * falloff );
				else if ( mode === 'smooth' ) {

					const avg = ( this.value( 'sculpt', i - 1, j ) + this.value( 'sculpt', i + 1, j ) + this.value( 'sculpt', i, j - 1 ) + this.value( 'sculpt', i, j + 1 ) + h * 4 ) / 8;
					next = h + ( avg - h ) * Math.min( 1, amount * 0.5 * falloff );

				}

				next = THREE.MathUtils.clamp( next, HEIGHT_MIN, HEIGHT_MAX );
				if ( next !== h ) updates.push( i, j, next );

			}

		}

		for ( let n = 0; n < updates.length; n += 3 ) this.setSculpt( updates[ n ], updates[ n + 1 ], updates[ n + 2 ] );
		return updates.length > 0;

	}

}

const _cell = [ 0, 0, 0, 0 ];

// A clone of the circuit's colormap material that paints the rock texel
// (rockUV) with a ragged edge where the geometry's aRock field says
// (RockEdge.js)
export function rockGroundMaterial( material, rockUV ) {

	const out = material.clone();

	out.onBeforeCompile = ( shader ) => {

		const rock = rockShader( shader, rockUV );
		shader.fragmentShader = shader.fragmentShader.replace( '#include <map_fragment>', '#include <map_fragment>' + rock );

	};

	out.customProgramCacheKey = () => 'circuit-rock-ground';
	return out;

}

// ─── Geometry ─────────────────────────────────────────────
// A chunk's mesh covers its own vertices and the first row / column of the
// next chunks, so neighbouring meshes meet. The winding (a, b, c) / (c, b, d)
// gives upward-facing triangles, diagonal (i, j+1) – (i+1, j) as drawnFacet.
// Away from every drawn chunk the ground is a flat plane at 0, drawn up to
// FLAT_REACH past them (the horizon).

const SIDE = CHUNK + 1; // vertices per side of a chunk's mesh
const FLAT_REACH = 20000;

// The drawn heights of a chunk's mesh and one more ring of vertices around it
// (for the normals), or null when they are all 0 (flat: drawn as plain ground)
function chunkHeights( terrain, ci, cj ) {

	const W = SIDE + 2;
	const h = new Float32Array( W * W );
	const i0 = ( ci << SHIFT ) - 1, j0 = ( cj << SHIFT ) - 1;
	let flat = true;

	for ( let b = 0; b < W; b ++ ) {

		for ( let a = 0; a < W; a ++ ) {

			const v = terrain.value( 'drawn', i0 + a, j0 + b );
			h[ b * W + a ] = v;
			// only the mesh's own vertices decide (the ring is for normals)
			if ( v !== 0 && a > 0 && b > 0 && a < W - 1 && b < W - 1 ) flat = false;

		}

	}

	return flat ? null : h;

}

// Smooth normal of the vertex (a, b) of a heights block: the sum of its six
// triangles' face normals weighted by area (what computeVertexNormals gives)
function vertexNormal( h, W, a, b, out ) {

	const S = TERRAIN_STEP;
	const y = ( p, q ) => h[ q * W + p ];
	let nx = 0, ny = 0, nz = 0;

	// cross( C - B, A - B ) of a triangle A, B, C given as grid offsets
	const add = ( pa, qa, pb, qb, pc, qc ) => {

		const cx = ( pc - pb ) * S, cy = y( pc, qc ) - y( pb, qb ), cz = ( qc - qb ) * S;
		const ax = ( pa - pb ) * S, ay = y( pa, qa ) - y( pb, qb ), az = ( qa - qb ) * S;
		nx += cy * az - cz * ay;
		ny += cz * ax - cx * az;
		nz += cx * ay - cy * ax;

	};

	// Cell (a, b): T1 = (a,b) (a,b+1) (a+1,b)
	add( a, b, a, b + 1, a + 1, b );
	// Cell (a-1, b): T1 = (a-1,b) (a-1,b+1) (a,b), T2 = (a,b) (a-1,b+1) (a,b+1)
	add( a - 1, b, a - 1, b + 1, a, b );
	add( a, b, a - 1, b + 1, a, b + 1 );
	// Cell (a, b-1): T1 = (a,b-1) (a,b) (a+1,b-1), T2 = (a+1,b-1) (a,b) (a+1,b)
	add( a, b - 1, a, b, a + 1, b - 1 );
	add( a + 1, b - 1, a, b, a + 1, b );
	// Cell (a-1, b-1): T2 = (a,b-1) (a-1,b) (a,b)
	add( a, b - 1, a - 1, b, a, b );

	const len = Math.hypot( nx, ny, nz ) || 1;
	out[ 0 ] = nx / len;
	out[ 1 ] = ny / len;
	out[ 2 ] = nz / len;

}

let _indices = null;

function chunkIndices() {

	if ( _indices ) return _indices;
	const indices = [];

	for ( let b = 0; b < SIDE - 1; b ++ ) {

		for ( let a = 0; a < SIDE - 1; a ++ ) {

			const p = b * SIDE + a, q = p + SIDE, r = p + 1, s = q + 1;
			indices.push( p, q, r, r, q, s );

		}

	}

	return ( _indices = indices );

}

// Indexed mesh of one chunk (positions, smooth normals), null when flat
export function chunkGeometry( terrain, ci, cj, { yOffset = 0 } = {} ) {

	const h = chunkHeights( terrain, ci, cj );
	if ( ! h ) return null;

	const W = SIDE + 2;
	const y0 = ROAD_Y + yOffset;
	const positions = new Float32Array( SIDE * SIDE * 3 ), normals = new Float32Array( SIDE * SIDE * 3 );
	const n = [ 0, 0, 0 ];

	for ( let b = 0; b < SIDE; b ++ ) {

		for ( let a = 0; a < SIDE; a ++ ) {

			const k = ( b * SIDE + a ) * 3;
			positions[ k ] = ( ( ci << SHIFT ) + a ) * TERRAIN_STEP;
			positions[ k + 1 ] = h[ ( b + 1 ) * W + a + 1 ] + y0;
			positions[ k + 2 ] = ( ( cj << SHIFT ) + b ) * TERRAIN_STEP;
			vertexNormal( h, W, a + 1, b + 1, n );
			normals.set( n, k );

		}

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
	geometry.setIndex( chunkIndices() );
	geometry.computeBoundingSphere();
	geometry.computeBoundingBox();
	return geometry;

}

// Chunks whose mesh can hold relief: every chunk and the ones before it
// (their mesh reaches its first row / column)
function meshKeys( terrain ) {

	const keys = new Map();

	for ( const c of terrain.chunks.values() ) {

		for ( const [ di, dj ] of [ [ 0, 0 ], [ - 1, 0 ], [ 0, - 1 ], [ - 1, - 1 ] ] ) {

			keys.set( chunkKey( c.ci + di, c.cj + dj ), [ c.ci + di, c.cj + dj ] );

		}

	}

	return keys;

}

// The flat ground around the drawn chunks: a quad per chunk of their bounding
// box (with a margin) that has no mesh, then four bands out to FLAT_REACH.
// Triangles as [ x, z ] corners, upward facing
function flatQuads( drawn, centre = [ 0, 0 ] ) {

	let c0 = Infinity, c1 = - Infinity, r0 = Infinity, r1 = - Infinity;

	for ( const [ ci, cj ] of drawn.values() ) {

		c0 = Math.min( c0, ci ); c1 = Math.max( c1, ci );
		r0 = Math.min( r0, cj ); r1 = Math.max( r1, cj );

	}

	if ( c0 === Infinity ) {

		c0 = c1 = Math.floor( centre[ 0 ] / CHUNK_SIZE );
		r0 = r1 = Math.floor( centre[ 1 ] / CHUNK_SIZE );

	}

	const M = 2;
	c0 -= M; c1 += M; r0 -= M; r1 += M;
	const quads = [];

	for ( let cj = r0; cj <= r1; cj ++ ) {

		for ( let ci = c0; ci <= c1; ci ++ ) {

			if ( ! drawn.has( chunkKey( ci, cj ) ) ) quads.push( [ ci * CHUNK_SIZE, cj * CHUNK_SIZE, ( ci + 1 ) * CHUNK_SIZE, ( cj + 1 ) * CHUNK_SIZE ] );

		}

	}

	const x0 = c0 * CHUNK_SIZE, x1 = ( c1 + 1 ) * CHUNK_SIZE, z0 = r0 * CHUNK_SIZE, z1 = ( r1 + 1 ) * CHUNK_SIZE;
	const far = FLAT_REACH;
	quads.push(
		[ x0 - far, z0 - far, x1 + far, z0 ], // north band, full width
		[ x0 - far, z1, x1 + far, z1 + far ], // south band
		[ x0 - far, z0, x0, z1 ], // west
		[ x1, z0, x1 + far, z1 ], // east
	);
	return quads;

}

function flatPositions( quads, y ) {

	const positions = new Float32Array( quads.length * 18 );

	quads.forEach( ( [ x0, z0, x1, z1 ], n ) => {

		// (x0,z0) (x0,z1) (x1,z0) / (x1,z0) (x0,z1) (x1,z1): facing up
		positions.set( [ x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1 ], n * 18 );

	} );

	return positions;

}

// The editor's ground: one mesh per chunk with relief, rebuilt when its
// heights change (`update` after every conform), and the flat ground around
export class TerrainMeshes {

	constructor( material, { yOffset = 0 } = {} ) {

		this.group = new THREE.Group();
		this.material = material;
		this.yOffset = yOffset;
		this.meshes = new Map(); // chunkKey → { mesh, sig }
		this.flatSig = '';
		this.flat = new THREE.Mesh( new THREE.BufferGeometry(), material );
		this.flat.receiveShadow = true;
		this.group.add( this.flat );

	}

	update( terrain, centre ) {

		const keys = meshKeys( terrain );
		const drawn = new Map();

		for ( const [ key, [ ci, cj ] ] of keys ) {

			// Its heights come from this chunk and the next ones
			const sig = [ [ 0, 0 ], [ 1, 0 ], [ 0, 1 ], [ 1, 1 ] ].map( ( [ di, dj ] ) => terrain.chunk( ci + di, cj + dj )?.rev ?? - 1 ).join( ',' );
			let entry = this.meshes.get( key );

			if ( ! entry || entry.sig !== sig ) {

				const geometry = chunkGeometry( terrain, ci, cj, { yOffset: this.yOffset } );
				if ( entry ) this.remove( key );

				if ( geometry ) {

					const mesh = new THREE.Mesh( geometry, this.material );
					mesh.castShadow = true;
					mesh.receiveShadow = true;
					this.group.add( mesh );
					entry = { mesh, sig, ci, cj };
					this.meshes.set( key, entry );

				} else {

					entry = null;

				}

			}

			if ( entry ) drawn.set( key, [ ci, cj ] );

		}

		for ( const key of [ ...this.meshes.keys() ] ) if ( ! keys.has( key ) ) this.remove( key );

		// The flat ground around them
		const flatSig = [ ...drawn.keys() ].sort( ( a, b ) => a - b ).join( ',' ) + ( drawn.size ? '' : '@' + ( centre || [ 0, 0 ] ).map( ( v ) => Math.floor( v / CHUNK_SIZE ) ).join( ',' ) );

		if ( flatSig !== this.flatSig ) {

			this.flatSig = flatSig;
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute( 'position', new THREE.BufferAttribute( flatPositions( flatQuads( drawn, centre ), ROAD_Y + this.yOffset ), 3 ) );
			geometry.computeVertexNormals();
			geometry.computeBoundingSphere();
			this.flat.geometry.dispose();
			this.flat.geometry = geometry;

		}

	}

	remove( key ) {

		const entry = this.meshes.get( key );
		if ( ! entry ) return;
		this.group.remove( entry.mesh );
		entry.mesh.geometry.dispose();
		this.meshes.delete( key );

	}

	clear() {

		for ( const key of [ ...this.meshes.keys() ] ) this.remove( key );
		this.flatSig = '';

	}

}

// Road samples (every other one) by HASH_CELL cell
function hashSamples( path ) {

	const map = new Map();

	for ( let k = 0; k < path.sampleCount; k += 2 ) {

		const key = Math.floor( path.px[ k ] / HASH_CELL ) * 65536 + Math.floor( path.pz[ k ] / HASH_CELL );
		const list = map.get( key );
		if ( list ) list.push( k );
		else map.set( key, [ k ] );

	}

	return map;

}

// Does the segment from (x, z) along (dx, dz) touch the square of half side h
// centred on (cx, cz) (Liang–Barsky)
function segmentHitsBox( x, z, dx, dz, cx, cz, h ) {

	const span = [ 0, 1 ];
	return clip( - dx, x - cx + h, span ) && clip( dx, cx + h - x, span ) && clip( - dz, z - cz + h, span ) && clip( dz, cz + h - z, span );

}

// One slab of Liang–Barsky: narrows span [ t0, t1 ], false once it is empty
function clip( p, q, span ) {

	if ( p === 0 ) return q >= 0;
	const r = q / p;

	if ( p < 0 ) {

		if ( r > span[ 1 ] ) return false;
		if ( r > span[ 0 ] ) span[ 0 ] = r;

	} else {

		if ( r < span[ 0 ] ) return false;
		if ( r < span[ 1 ] ) span[ 1 ] = r;

	}

	return true;

}

// The ground of a circuit in the game, one geometry: the chunks with relief
// (their triangles, non-indexed), then the flat ground around them; all in
// the grass texel, with the rock field per vertex (`aRock`, drawn by
// rockGroundMaterial)
export function buildGroundGeometry( terrain, { grass, yOffset = 0, centre = [ 0, 0 ] } ) {

	const parts = [];
	const drawn = new Map();
	let count = 0;

	for ( const [ key, [ ci, cj ] ] of meshKeys( terrain ) ) {

		const g = chunkGeometry( terrain, ci, cj, { yOffset } );
		if ( ! g ) continue;
		parts.push( g );
		drawn.set( key, [ ci, cj ] );
		count += g.index.count;

	}

	const flat = flatPositions( flatQuads( drawn, centre ), ROAD_Y + yOffset );
	const total = count + flat.length / 3;
	const positions = new Float32Array( total * 3 ), normals = new Float32Array( total * 3 ), uvs = new Float32Array( total * 2 );
	const rocks = new Float32Array( total ).fill( rockOf( 1 ) );
	for ( let v = 0; v < total; v ++ ) uvs.set( grass, v * 2 );
	let o = 0; // vertices written

	for ( const g of parts ) {

		const src = g.attributes.position.array, srcN = g.attributes.normal.array, index = g.index.array;

		for ( let t = 0; t < index.length; t ++, o ++ ) {

			const k = index[ t ] * 3;
			positions.set( [ src[ k ], src[ k + 1 ], src[ k + 2 ] ], o * 3 );
			normals.set( [ srcN[ k ], srcN[ k + 1 ], srcN[ k + 2 ] ], o * 3 );
			rocks[ o ] = rockOf( srcN[ k + 1 ] );

		}

		g.dispose();

	}

	positions.set( flat, o * 3 );

	for ( ; o < total; o ++ ) normals[ o * 3 + 1 ] = 1;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
	geometry.setAttribute( 'aRock', new THREE.BufferAttribute( rocks, 1 ) );
	geometry.computeBoundingSphere();
	geometry.computeBoundingBox();
	return geometry;

}
