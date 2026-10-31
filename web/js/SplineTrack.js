import * as THREE from 'three';
import { GRID_SCALE, bytesToBase64url, base64urlToBytes } from './Track.js';

// ─── Constants ────────────────────────────────────────────
// Track pieces are 10 raw units long/wide and placed at GRID_SCALE, like the grid version.

export const TRACK_SCALE = GRID_SCALE;
export const TILE_LEN = 10 * TRACK_SCALE;           // world length of one road tile
export const ROAD_HALF = 5 * TRACK_SCALE;           // centerline → outer edge of barrier
export const WALL_OFFSET = 4.75 * TRACK_SCALE;      // centerline → barrier collider center
export const MIN_RADIUS = 4.5;                      // tighter than this folds the inner barrier (bent tiles)
export const CORNER_RADIUS = 5 * TRACK_SCALE;       // one-tile quarter turn, drawn with the Kenney corner piece
export const MIN_SEGMENT = 2;
export const MAX_GRADE = 0.3;                      // 30 % slope
export const ROAD_Y = ( 0.5 * TRACK_SCALE ) - 0.5;  // road surface height (matches grid track)

const TWO_PI = Math.PI * 2;
const SAMPLE_STEP = 0.25;
export const GRASS_UV = [ 0.031, 0.875 ]; // top face of decoration-empty in colormap.png
export const ROCK_UV = [ 0.39, 0.86 ]; // dark grey texel of colormap.png, for cliffs and banks
export const ROCK_NORMAL_Y = 0.8; // a ground facet steeper than this is drawn as rock (rally stages and circuits)

export function wrapAngle( a ) {

	a = ( a + Math.PI ) % TWO_PI;
	if ( a < 0 ) a += TWO_PI;
	return a - Math.PI;

}

// ─── Curve ────────────────────────────────────────────────
// A node is { x, z, a, y } where a is the heading: direction = ( sin a, cos a )
// and y the road elevation (0 = flat ground level).
// Each segment is a cubic Bézier whose handle length makes it a near-exact
// circular arc whenever the two headings are consistent with one.

export function segmentControls( n0, n1 ) {

	const c = Math.hypot( n1.x - n0.x, n1.z - n0.z );
	const d = Math.abs( wrapAngle( n1.a - n0.a ) );
	const h = d < 1e-4 ? c / 3 : c * ( 4 / 3 ) * Math.tan( d / 4 ) / ( 2 * Math.sin( d / 2 ) );

	return [
		n0.x, n0.z,
		n0.x + Math.sin( n0.a ) * h, n0.z + Math.cos( n0.a ) * h,
		n1.x - Math.sin( n1.a ) * h, n1.z - Math.cos( n1.a ) * h,
		n1.x, n1.z,
	];

}

// A segment that is exactly the Kenney corner piece: a quarter turn of radius
// half a tile (grid mode). It is drawn with the real piece, so it is allowed
// below MIN_RADIUS.
export function isCornerPiece( n0, n1 ) {

	if ( Math.abs( Math.abs( wrapAngle( n1.a - n0.a ) ) - Math.PI / 2 ) > 1e-3 ) return false;

	const dx = n1.x - n0.x, dz = n1.z - n0.z;
	const ahead = dx * Math.sin( n0.a ) + dz * Math.cos( n0.a );
	const side = Math.abs( dx * Math.cos( n0.a ) - dz * Math.sin( n0.a ) );
	return Math.abs( ahead - CORNER_RADIUS ) < 0.02 && Math.abs( side - CORNER_RADIUS ) < 0.02;

}

export class TrackPath {

	constructor( nodes, closed = false ) {

		this.nodes = nodes;
		this.closed = closed && nodes.length >= 2;

		const px = [], pz = [], seg = [];
		const segStart = [];
		const n = nodes.length;
		const segCount = n < 2 ? 0 : ( this.closed ? n : n - 1 );

		// Segments drawn with the corner piece (see isCornerPiece)
		this.cornerSeg = [];
		for ( let i = 0; i < segCount; i ++ ) this.cornerSeg.push( isCornerPiece( nodes[ i ], nodes[ ( i + 1 ) % n ] ) );

		for ( let i = 0; i < segCount; i ++ ) {

			const c = segmentControls( nodes[ i ], nodes[ ( i + 1 ) % n ] );
			const approx = Math.hypot( c[ 2 ] - c[ 0 ], c[ 3 ] - c[ 1 ] ) +
				Math.hypot( c[ 4 ] - c[ 2 ], c[ 5 ] - c[ 3 ] ) +
				Math.hypot( c[ 6 ] - c[ 4 ], c[ 7 ] - c[ 5 ] );
			const steps = Math.max( 4, Math.ceil( approx / SAMPLE_STEP ) );
			segStart.push( px.length );

			for ( let k = 0; k < steps; k ++ ) {

				const t = k / steps, u = 1 - t;
				const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
				px.push( b0 * c[ 0 ] + b1 * c[ 2 ] + b2 * c[ 4 ] + b3 * c[ 6 ] );
				pz.push( b0 * c[ 1 ] + b1 * c[ 3 ] + b2 * c[ 5 ] + b3 * c[ 7 ] );
				seg.push( i + t );

			}

		}

		if ( n > 0 ) {

			const last = segCount > 0 && this.closed ? nodes[ 0 ] : nodes[ n - 1 ];
			px.push( last.x );
			pz.push( last.z );
			seg.push( segCount );

		}

		const count = px.length;
		this.px = Float64Array.from( px );
		this.pz = Float64Array.from( pz );
		this.seg = Float64Array.from( seg );
		this.s = new Float64Array( count );

		for ( let i = 1; i < count; i ++ ) {

			this.s[ i ] = this.s[ i - 1 ] + Math.hypot( px[ i ] - px[ i - 1 ], pz[ i ] - pz[ i - 1 ] );

		}

		this.length = count > 0 ? this.s[ count - 1 ] : 0;

		// Tangents from central differences (wrapping on closed loops, where first == last)
		this.tx = new Float64Array( count );
		this.tz = new Float64Array( count );

		for ( let i = 0; i < count; i ++ ) {

			const prev = i > 0 ? i - 1 : ( this.closed ? count - 2 : 0 );
			const next = i < count - 1 ? i + 1 : ( this.closed ? 1 : count - 1 );
			let dx = px[ next ] - px[ prev ];
			let dz = pz[ next ] - pz[ prev ];
			const len = Math.hypot( dx, dz );

			if ( len > 1e-9 ) {

				dx /= len;
				dz /= len;

			} else {

				const a = n > 0 ? nodes[ 0 ].a : 0;
				dx = Math.sin( a );
				dz = Math.cos( a );

			}

			this.tx[ i ] = dx;
			this.tz[ i ] = dz;

		}

		// At every node the tangent is the node heading, the exact Bézier tangent.
		// A difference over neighbouring samples is off by half a sample's turn:
		// at open ends two paths sharing a node (rally chunks) disagreed by up to
		// ~2°, and next to a one-tile corner piece (which leaves the node exactly
		// along its heading) the bent tiles opened a wedge. Both gapped the road.
		if ( segCount > 0 ) {

			for ( let k = 0; k < segCount; k ++ ) {

				const a = nodes[ k ].a;
				this.tx[ segStart[ k ] ] = Math.sin( a );
				this.tz[ segStart[ k ] ] = Math.cos( a );

			}

			const end = this.closed ? nodes[ 0 ] : nodes[ n - 1 ];
			this.tx[ count - 1 ] = Math.sin( end.a );
			this.tz[ count - 1 ] = Math.cos( end.a );

		}

		this.computeHeights( segStart, segCount );

	}

	// Elevation along the path: cubic Hermite over arc length between nodes,
	// with Catmull-Rom slopes so the grade stays continuous through nodes.
	computeHeights( segStart, segCount ) {

		const nodes = this.nodes;
		const n = nodes.length;
		const count = this.px.length;
		this.py = new Float64Array( count );
		this.gy = new Float64Array( count );

		if ( n === 0 ) return;

		if ( segCount === 0 ) {

			this.py.fill( nodes[ 0 ].y || 0 );
			return;

		}

		const L = this.length;
		const ns = segStart.map( ( i ) => this.s[ i ] ); // arc length at each node
		if ( ! this.closed ) ns.push( L );
		const ny = nodes.map( ( node ) => node.y || 0 );

		// Secant grade of each segment, then monotone node slopes (Fritsch–Carlson):
		// no dip before a climb, no bump at the top.
		const secant = new Float64Array( segCount );

		for ( let k = 0; k < segCount; k ++ ) {

			const h = ( k + 1 < segCount ? ns[ k + 1 ] : L ) - ns[ k ];
			secant[ k ] = h > 0 ? ( ny[ ( k + 1 ) % n ] - ny[ k ] ) / h : 0;

		}

		const slope = new Float64Array( n );

		for ( let i = 0; i < n; i ++ ) {

			const before = i > 0 ? secant[ i - 1 ] : ( this.closed ? secant[ segCount - 1 ] : null );
			const after = i < segCount ? secant[ i ] : null;

			if ( before === null ) slope[ i ] = after;
			else if ( after === null ) slope[ i ] = before;
			else if ( before * after <= 0 ) slope[ i ] = 0;
			else slope[ i ] = 2 / ( 1 / before + 1 / after );

		}

		for ( let k = 0; k < segCount; k ++ ) {

			const i0 = segStart[ k ];
			const i1 = k + 1 < segCount ? segStart[ k + 1 ] : count;
			const b = ( k + 1 ) % n;
			const s0 = ns[ k ];
			const h = ( k + 1 < segCount ? ns[ k + 1 ] : L ) - s0;
			const y0 = ny[ k ], y1 = ny[ b ], m0 = slope[ k ] * h, m1 = slope[ b ] * h;

			for ( let i = i0; i < i1; i ++ ) {

				const t = h > 0 ? ( this.s[ i ] - s0 ) / h : 0;
				const t2 = t * t, t3 = t2 * t;
				this.py[ i ] = ( 2 * t3 - 3 * t2 + 1 ) * y0 + ( t3 - 2 * t2 + t ) * m0 + ( - 2 * t3 + 3 * t2 ) * y1 + ( t3 - t2 ) * m1;
				this.gy[ i ] = h > 0 ? ( ( 6 * t2 - 6 * t ) * y0 + ( 3 * t2 - 4 * t + 1 ) * m0 + ( - 6 * t2 + 6 * t ) * y1 + ( 3 * t2 - 2 * t ) * m1 ) / h : 0;

			}

		}

		// Last sample is the end node (or the start node again on a closed loop)
		this.py[ count - 1 ] = this.closed ? ny[ 0 ] : ny[ n - 1 ];
		this.gy[ count - 1 ] = this.closed ? slope[ 0 ] : slope[ n - 1 ];

	}

	maxGrade() {

		let m = 0;
		for ( const g of this.gy ) m = Math.max( m, Math.abs( g ) );
		return m;

	}

	get sampleCount() {

		return this.px.length;

	}

	// Position + unit tangent at arc length s (wraps on closed loops, clamps otherwise)
	frameAt( s, out = {} ) {

		const n = this.px.length;
		const L = this.length;

		if ( this.closed && L > 0 ) {

			s %= L;
			if ( s < 0 ) s += L;

		} else {

			s = Math.max( 0, Math.min( L, s ) );

		}

		const S = this.s;
		let lo = 0, hi = n - 1;

		while ( hi - lo > 1 ) {

			const mid = ( lo + hi ) >> 1;
			if ( S[ mid ] <= s ) lo = mid;
			else hi = mid;

		}

		const ds = S[ hi ] - S[ lo ];
		const t = ds > 0 ? ( s - S[ lo ] ) / ds : 0;

		out.x = this.px[ lo ] + ( this.px[ hi ] - this.px[ lo ] ) * t;
		out.z = this.pz[ lo ] + ( this.pz[ hi ] - this.pz[ lo ] ) * t;

		let tx = this.tx[ lo ] + ( this.tx[ hi ] - this.tx[ lo ] ) * t;
		let tz = this.tz[ lo ] + ( this.tz[ hi ] - this.tz[ lo ] ) * t;
		const len = Math.hypot( tx, tz ) || 1;
		out.tx = tx / len;
		out.tz = tz / len;

		out.y = this.py[ lo ] + ( this.py[ hi ] - this.py[ lo ] ) * t;
		out.gy = this.gy[ lo ] + ( this.gy[ hi ] - this.gy[ lo ] ) * t;

		return out;

	}

	nearest( x, z, stride = 1 ) {

		let best = Infinity, bestI = 0;

		for ( let i = 0; i < this.px.length; i += stride ) {

			const dx = this.px[ i ] - x, dz = this.pz[ i ] - z;
			const d = dx * dx + dz * dz;

			if ( d < best ) {

				best = d;
				bestI = i;

			}

		}

		return { index: bestI, s: this.s[ bestI ], seg: this.seg[ bestI ], dist: Math.sqrt( best ) };

	}

	// Local turning radius at every sample (Infinity on straights)
	radii() {

		const n = this.px.length;
		const r = new Float64Array( n ).fill( Infinity );

		for ( let i = 0; i < n; i ++ ) {

			let a = i - 1, b = i + 1;

			if ( a < 0 ) {

				if ( ! this.closed ) continue;
				a = n - 2;

			}

			if ( b >= n ) {

				if ( ! this.closed ) continue;
				b = 1;

			}

			const ax = this.px[ i ] - this.px[ a ], az = this.pz[ i ] - this.pz[ a ];
			const bx = this.px[ b ] - this.px[ i ], bz = this.pz[ b ] - this.pz[ i ];
			const la = Math.hypot( ax, az ), lb = Math.hypot( bx, bz );
			if ( la < 1e-9 || lb < 1e-9 ) continue;

			const angle = Math.abs( Math.atan2( ax * bz - az * bx, ax * bx + az * bz ) );
			if ( angle > 1e-9 ) r[ i ] = 0.5 * ( la + lb ) / angle;

			// Inside a corner piece the Kenney model handles the tight turn
			if ( this.cornerSeg[ Math.min( Math.floor( this.seg[ i ] ), this.cornerSeg.length - 1 ) ] ) r[ i ] = Infinity;

		}

		return r;

	}

	minRadius() {

		let m = Infinity;
		for ( const v of this.radii() ) if ( v < m ) m = v;
		return m;

	}

}

// Planet Coaster style extension: the circular arc leaving `from` along its
// heading and passing through the target point. Returns the new node.
export const MAX_ARC_HALF = THREE.MathUtils.degToRad( 85 );
export const SNAP_ANGLE = THREE.MathUtils.degToRad( 15 );
export const SNAP_LENGTH = TILE_LEN / 2;

export function arcTo( from, tx, tz, { straight = false, snap = false } = {} ) {

	const dx = tx - from.x, dz = tz - from.z;
	let dist = Math.hypot( dx, dz );
	let r = 0;

	if ( straight ) {

		dist = Math.max( 0, dx * Math.sin( from.a ) + dz * Math.cos( from.a ) );

	} else {

		r = wrapAngle( Math.atan2( dx, dz ) - from.a );
		r = Math.max( - MAX_ARC_HALF, Math.min( MAX_ARC_HALF, r ) );

	}

	if ( snap ) {

		// Snap the turn to SNAP_ANGLE and the arc length to half tiles
		r = Math.round( 2 * r / SNAP_ANGLE ) * SNAP_ANGLE / 2;
		const k = Math.abs( r ) > 1e-6 ? Math.abs( r ) / Math.sin( Math.abs( r ) ) : 1; // arc / chord
		const arcLen = Math.max( 1, Math.round( dist * k / SNAP_LENGTH ) ) * SNAP_LENGTH;
		dist = arcLen / k;

	}

	const phi = from.a + r;

	return {
		x: from.x + Math.sin( phi ) * dist,
		z: from.z + Math.cos( phi ) * dist,
		a: wrapAngle( from.a + 2 * r ),
	};

}

// ─── Codec ────────────────────────────────────────────────
// v2: [ version, flags, count u16 ] then per node int16 x*20, int16 z*20,
// uint16 heading, int16 y*20. flags bit0 = closed, bit1 = a terrain block
// follows: uint16 grid size, uint32 byte length, deflate-raw int8 heights
// (size 201: the old 400 m square; size 0: chunks, Terrain.toData).
// v4 = v3 with int32 x*20, z*20, only when a node lies past ±1638 m.
// v1 (no heights, no terrain) is still decoded.

const POS_SCALE = 20;

async function pipeBytes( bytes, transform ) {

	const stream = new Blob( [ bytes ] ).stream().pipeThrough( transform );
	return new Uint8Array( await new Response( stream ).arrayBuffer() );

}

// Most bytes a circuit's terrain may inflate to: ~8 000 sculpted 64 m chunks (Terrain.js:
// 4 + 32² bytes each), far past any drawn circuit. The server inflates the terrain of every
// circuit a lap is checked on (published ones, or the track sent with a lap): unbounded,
// 400 kB of deflate could inflate to ~400 MB
export const MAX_TERRAIN_BYTES = 8 * 1024 * 1024;

async function inflateBounded( bytes, max = MAX_TERRAIN_BYTES ) {

	const reader = new Blob( [ bytes ] ).stream().pipeThrough( new DecompressionStream( 'deflate-raw' ) ).getReader();
	const parts = [];
	let total = 0;
	for ( ;; ) {

		const { done, value } = await reader.read();
		if ( done ) break;
		total += value.length;
		if ( total > max ) {

			await reader.cancel();
			throw new Error( 'terrain too large' );

		}

		parts.push( value );

	}

	const out = new Uint8Array( total );
	let o = 0;
	for ( const part of parts ) { out.set( part, o ); o += part.length; }
	return out;

}

// Bytes per node by format version. v3 = v2 + a flags byte per node (bit 0:
// the segment leaving the node stands on piers, node.p), written only when a
// node needs it: circuits without piers keep their exact data (and id)
export const NODE_STRIDE = { 1: 6, 2: 8, 3: 9, 4: 13 };
const POS_MAX = 32767 / POS_SCALE; // m, farthest a v2 / v3 node can lie

export async function encodeTrack( nodes, closed, terrainBytes = null, terrainSize = 0 ) {

	const packed = terrainBytes ? await pipeBytes( terrainBytes, new CompressionStream( 'deflate-raw' ) ) : null;
	const far = nodes.some( ( n ) => Math.abs( n.x ) > POS_MAX || Math.abs( n.z ) > POS_MAX );
	const version = far ? 4 : nodes.some( ( n ) => n.p ) ? 3 : 2;
	const wide = version === 4 ? 4 : 0; // extra bytes of the int32 positions
	const stride = NODE_STRIDE[ version ];
	const bytes = new Uint8Array( 4 + nodes.length * stride + ( packed ? 6 + packed.length : 0 ) );
	const view = new DataView( bytes.buffer );

	view.setUint8( 0, version );
	view.setUint8( 1, ( closed ? 1 : 0 ) | ( packed ? 2 : 0 ) );
	view.setUint16( 2, nodes.length, true );

	const clamp16 = ( v ) => Math.max( - 32768, Math.min( 32767, Math.round( v * POS_SCALE ) ) );

	for ( let i = 0; i < nodes.length; i ++ ) {

		const o = 4 + i * stride;
		let a = nodes[ i ].a % TWO_PI;
		if ( a < 0 ) a += TWO_PI;

		if ( wide ) {

			view.setInt32( o, Math.round( nodes[ i ].x * POS_SCALE ), true );
			view.setInt32( o + 4, Math.round( nodes[ i ].z * POS_SCALE ), true );

		} else {

			view.setInt16( o, clamp16( nodes[ i ].x ), true );
			view.setInt16( o + 2, clamp16( nodes[ i ].z ), true );

		}

		view.setUint16( o + 4 + wide, Math.round( a / TWO_PI * 65536 ) & 0xffff, true );
		view.setInt16( o + 6 + wide, clamp16( nodes[ i ].y || 0 ), true );
		if ( version >= 3 ) view.setUint8( o + 8 + wide, nodes[ i ].p ? 1 : 0 );

	}

	if ( packed ) {

		const o = 4 + nodes.length * stride;
		view.setUint16( o, terrainSize, true );
		view.setUint32( o + 2, packed.length, true );
		bytes.set( packed, o + 6 );

	}

	return bytesToBase64url( bytes );

}

// Returns { nodes, closed, terrain } where terrain is { size, bytes } or null
export async function decodeTrack( str ) {

	const bytes = base64urlToBytes( str );
	const view = new DataView( bytes.buffer );
	const version = bytes.length >= 4 ? view.getUint8( 0 ) : 0;

	if ( ! NODE_STRIDE[ version ] ) throw new Error( 'Unsupported track data' );

	const flags = view.getUint8( 1 );
	const count = view.getUint16( 2, true );
	const stride = NODE_STRIDE[ version ];
	if ( bytes.length < 4 + count * stride ) throw new Error( 'Truncated track data' );

	const nodes = [];

	for ( let i = 0; i < count; i ++ ) {

		const o = 4 + i * stride;
		const wide = version === 4 ? 4 : 0;
		nodes.push( {
			x: ( wide ? view.getInt32( o, true ) : view.getInt16( o, true ) ) / POS_SCALE,
			z: ( wide ? view.getInt32( o + 4, true ) : view.getInt16( o + 2, true ) ) / POS_SCALE,
			a: wrapAngle( view.getUint16( o + 4 + wide, true ) / 65536 * TWO_PI ),
			y: version >= 2 ? view.getInt16( o + 6 + wide, true ) / POS_SCALE : 0,
		} );
		if ( version >= 3 && ( view.getUint8( o + 8 + wide ) & 1 ) ) nodes[ i ].p = true;

	}

	let terrain = null;

	if ( version >= 2 && ( flags & 2 ) ) {

		const o = 4 + count * stride;
		const size = view.getUint16( o, true );
		const length = view.getUint32( o + 2, true );
		const packed = bytes.subarray( o + 6, o + 6 + length );
		terrain = { size, bytes: await inflateBounded( packed ) };

	}

	return { nodes, closed: ( flags & 1 ) === 1, terrain };

}

// ─── Road geometry ────────────────────────────────────────
// The Kenney road tiles are extruded along local Z (-5..5). Each tile is
// bent onto the curve: local Z → arc length, local X → lateral offset.

// The Kenney finish tile without its arch: only the triangles of the road
// and its barriers (within the tile's width, at most 1 raw unit high). With
// the racing kit an arch of the kit stands there instead (CircuitDressing).
export function finishWithoutArch( model ) {

	let mesh = null;
	if ( model.isMesh ) mesh = model;
	else model.traverse( ( c ) => { if ( ! mesh && c.isMesh ) mesh = c; } );

	const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
	const pos = src.attributes.position;
	const keep = [];

	for ( let t = 0; t < pos.count; t += 3 ) {

		let low = true;
		for ( let k = t; k < t + 3; k ++ ) if ( pos.getY( k ) > 1.01 || Math.abs( pos.getX( k ) ) > 5.01 ) low = false;
		if ( low ) keep.push( t, t + 1, t + 2 );

	}

	const geometry = new THREE.BufferGeometry();

	for ( const name in src.attributes ) {

		const a = src.attributes[ name ];
		const out = new Float32Array( keep.length * a.itemSize );
		keep.forEach( ( i, j ) => { for ( let c = 0; c < a.itemSize; c ++ ) out[ j * a.itemSize + c ] = a.array[ i * a.itemSize + c ]; } );
		geometry.setAttribute( name, new THREE.BufferAttribute( out, a.itemSize ) );

	}

	const result = new THREE.Mesh( geometry, mesh.material );
	result.position.copy( mesh.position );
	result.quaternion.copy( mesh.quaternion );
	result.scale.copy( mesh.scale );
	return result;

}

export function extractTileGeometry( model ) {

	let mesh = null;

	if ( model.isMesh ) mesh = model;
	else model.traverse( ( c ) => { if ( ! mesh && c.isMesh ) mesh = c; } );

	model.updateMatrixWorld( true );

	const geometry = mesh.geometry.clone();
	geometry.applyMatrix4( mesh.matrixWorld );

	return { geometry: sliceAlongZ( geometry ), material: mesh.material };

}

// The Kenney tiles use single long quads (the asphalt spans the whole tile).
// Bent as-is they become chords that cut curves and sink under crests, so
// every triangle is sliced by planes z = const into short slabs first.
export function sliceAlongZ( geometry, slabs = 8, zMin = - 5, zMax = 5 ) {

	const src = geometry.index ? geometry.toNonIndexed() : geometry;
	const pos = src.attributes.position, nor = src.attributes.normal, uv = src.attributes.uv;
	const planes = [];
	for ( let k = 1; k < slabs; k ++ ) planes.push( zMin + ( zMax - zMin ) * k / slabs );

	const vertex = ( i ) => [ pos.getX( i ), pos.getY( i ), pos.getZ( i ), nor.getX( i ), nor.getY( i ), nor.getZ( i ), uv.getX( i ), uv.getY( i ) ];
	const lerp = ( a, b, t ) => a.map( ( v, k ) => v + ( b[ k ] - v ) * t );
	const out = [];

	for ( let t = 0; t < pos.count; t += 3 ) {

		let polys = [ [ vertex( t ), vertex( t + 1 ), vertex( t + 2 ) ] ];

		for ( const z of planes ) {

			const next = [];

			for ( const poly of polys ) {

				const below = [], above = [];

				for ( let i = 0; i < poly.length; i ++ ) {

					const a = poly[ i ], b = poly[ ( i + 1 ) % poly.length ];

					if ( Math.abs( a[ 2 ] - z ) < 1e-6 ) {

						// On the plane: shared by both sides
						below.push( a );
						above.push( a );

					} else {

						( a[ 2 ] < z ? below : above ).push( a );

					}

					if ( ( a[ 2 ] < z && b[ 2 ] > z ) || ( a[ 2 ] > z && b[ 2 ] < z ) ) {

						const cut = lerp( a, b, ( z - a[ 2 ] ) / ( b[ 2 ] - a[ 2 ] ) );
						below.push( cut );
						above.push( cut );

					}

				}

				if ( below.length >= 3 ) next.push( below );
				if ( above.length >= 3 ) next.push( above );

			}

			polys = next;

		}

		// Slabs of a triangle are convex: fan-triangulate
		for ( const poly of polys ) {

			for ( let i = 1; i + 1 < poly.length; i ++ ) out.push( poly[ 0 ], poly[ i ], poly[ i + 1 ] );

		}

	}

	const positions = new Float32Array( out.length * 3 );
	const normals = new Float32Array( out.length * 3 );
	const uvs = new Float32Array( out.length * 2 );

	out.forEach( ( v, i ) => {

		positions.set( v.slice( 0, 3 ), i * 3 );
		const n = Math.hypot( v[ 3 ], v[ 4 ], v[ 5 ] ) || 1;
		normals.set( [ v[ 3 ] / n, v[ 4 ] / n, v[ 5 ] / n ], i * 3 );
		uvs.set( v.slice( 6, 8 ), i * 2 );

	} );

	const result = new THREE.BufferGeometry();
	result.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	result.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
	result.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
	return result;

}

export function tileLayout( path ) {

	const count = Math.max( 1, Math.round( path.length / TILE_LEN ) );
	const len = path.length / count;
	const offset = path.closed ? - len / 2 : 0;

	return { count, len, offset, finishS: offset + len / 2 };

}

// ─── Road pieces ──────────────────────────────────────────
// The road is a list of pieces along the arc length: bent tiles (straight or
// finish) and, for the one-tile quarter turns of the grid mode, the Kenney
// corner piece placed as is. Without corners the layout is the historic one
// (equal tiles over the whole path, the finish tile centred on the start).

// Arc length at the start of each segment ( + the total length at the end)
function segmentStarts( path ) {

	const n = path.nodes.length;
	const segCount = n < 2 ? 0 : ( path.closed ? n : n - 1 );
	const starts = new Array( segCount + 1 ).fill( path.length );
	starts[ 0 ] = 0;

	for ( let i = 1, k = 1; i < path.sampleCount && k < segCount; i ++ ) {

		while ( k < segCount && Math.floor( path.seg[ i ] + 1e-9 ) >= k ) starts[ k ++ ] = path.s[ i ];

	}

	return starts;

}

// { pieces: [ { s0, s1, finish } | { s0, s1, corner: segIndex } ], finishS }
export function roadPieces( path, withFinish = false, finishAtEnd = false, withCorners = true ) {

	const corners = withCorners && path.cornerSeg.some( Boolean );

	if ( ! corners ) {

		const { count, len, offset, finishS } = tileLayout( path );
		const finishTile = finishAtEnd ? count - 1 : 0;
		const pieces = [];
		for ( let k = 0; k < count; k ++ ) pieces.push( { s0: offset + k * len, s1: offset + ( k + 1 ) * len, finish: withFinish && k === finishTile } );
		return { pieces, finishS };

	}

	const L = path.length;
	const starts = segmentStarts( path );
	const segCount = starts.length - 1;
	const pieces = [];
	let runs = [];
	let run = null;

	for ( let k = 0; k < segCount; k ++ ) {

		if ( path.cornerSeg[ k ] ) {

			if ( run ) runs.push( run );
			run = null;
			pieces.push( { s0: starts[ k ], s1: starts[ k + 1 ], corner: k } );

		} else if ( run ) {

			run.b = starts[ k + 1 ];

		} else {

			run = { a: starts[ k ], b: starts[ k + 1 ] };

		}

	}

	if ( run ) runs.push( run );

	// A loop's first and last runs are one stretch through the start line
	if ( path.closed && runs.length > 1 && runs[ 0 ].a === 0 && runs[ runs.length - 1 ].b === L ) {

		const last = runs.pop();
		runs[ 0 ] = { a: last.a - L, b: runs[ 0 ].b };

	} else if ( path.closed && runs.length > 0 && runs[ runs.length - 1 ].b === L && runs[ 0 ].a !== 0 ) {

		const last = runs.pop();
		runs.unshift( { a: last.a - L, b: 0 } );

	}

	const fill = ( a, b ) => {

		if ( b - a < 0.01 ) return;
		const count = Math.max( 1, Math.round( ( b - a ) / TILE_LEN ) );
		const len = ( b - a ) / count;
		for ( let k = 0; k < count; k ++ ) pieces.push( { s0: a + k * len, s1: a + ( k + 1 ) * len, finish: false } );

	};

	let finishS = null;

	for ( const r of runs ) {

		if ( withFinish && path.closed && finishS === null && r.a <= 0 && r.b > 0 ) {

			// Finish tile on the tile that starts at the start line (grid circuits
			// start on a tile edge, so every tile stays on the grid), stretched over
			// a sliver too short to be a tile
			let fb = Math.min( r.b, TILE_LEN );
			if ( r.b - fb < TILE_LEN * 0.35 ) fb = r.b;
			pieces.push( { s0: 0, s1: fb, finish: true } );
			finishS = fb / 2;
			fill( r.a, 0 );
			fill( fb, r.b );

		} else {

			fill( r.a, r.b );

		}

	}

	if ( finishS === null ) {

		const first = pieces.filter( ( p ) => p.corner === undefined ).sort( ( p, q ) => p.s0 - q.s0 )[ 0 ];
		finishS = path.closed || ! first ? 0 : ( first.s0 + first.s1 ) / 2;

	}

	return { pieces, finishS };

}

// The Kenney corner piece: arc centred on the tile corner ( -5, +5 ) raw,
// joining the middle of the +Z edge to the middle of the -X edge. Only the
// road and its barriers are kept (the far corner of the tile holds a flat
// plate and trees, which would float over relief).
export function extractCornerGeometry( model ) {

	const { geometry, material } = extractTileGeometry( model );
	const pos = geometry.attributes.position;
	const keep = [];

	for ( let t = 0; t < pos.count; t += 3 ) {

		let inside = true;
		for ( let k = 0; k < 3; k ++ ) if ( Math.hypot( pos.getX( t + k ) + 5, pos.getZ( t + k ) - 5 ) > 10.2 ) inside = false;
		if ( inside ) keep.push( t );

	}

	const out = new THREE.BufferGeometry();

	for ( const name of [ 'position', 'normal', 'uv' ] ) {

		const src = geometry.attributes[ name ];
		const data = new Float32Array( keep.length * 3 * src.itemSize );
		keep.forEach( ( t, j ) => data.set( src.array.subarray( t * src.itemSize, ( t + 3 ) * src.itemSize ), j * 3 * src.itemSize ) );
		out.setAttribute( name, new THREE.BufferAttribute( data, src.itemSize ) );

	}

	return { geometry: out, material };

}

const CORNER_HALF = 5 * TRACK_SCALE; // half a tile in world units

// Writes the corner piece of segment k into the arrays at vertex v; returns the new v
function placeCorner( path, piece, geo, positions, normals, uvs, v ) {

	const n = path.nodes.length;
	const n0 = path.nodes[ piece.corner ], n1 = path.nodes[ ( piece.corner + 1 ) % n ];
	const left = wrapAngle( n1.a - n0.a ) > 0;

	// Local entry point and heading of the piece for this turn direction
	const ex = left ? 0 : - CORNER_HALF, ez = left ? CORNER_HALF : 0;
	const theta = n0.a - ( left ? Math.PI : Math.PI / 2 );
	const c = Math.cos( theta ), s = Math.sin( theta );
	const rot = ( x, z ) => [ x * c + z * s, - x * s + z * c ];
	const [ rx, rz ] = rot( ex, ez );
	const cx = n0.x - rx, cz = n0.z - rz;

	// Arc centre in local units, for the height along the turn
	const ax = - CORNER_HALF, az = CORNER_HALF;
	const e0 = Math.atan2( ez - az, ex - ax );

	const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;

	for ( let i = 0; i < pos.count; i ++ ) {

		const x = pos.getX( i ) * TRACK_SCALE, y = pos.getY( i ) * TRACK_SCALE, z = pos.getZ( i ) * TRACK_SCALE;
		let t = Math.abs( wrapAngle( Math.atan2( z - az, x - ax ) - e0 ) ) / ( Math.PI / 2 );
		t = Math.min( 1, Math.max( 0, t ) );
		path.frameAt( piece.s0 + t * ( piece.s1 - piece.s0 ), _f );

		const [ wx, wz ] = rot( x, z );
		positions[ v * 3 ] = cx + wx;
		positions[ v * 3 + 1 ] = _f.y + ROAD_Y + y;
		positions[ v * 3 + 2 ] = cz + wz;

		const [ nx, nz ] = rot( nor.getX( i ), nor.getZ( i ) );
		normals[ v * 3 ] = nx;
		normals[ v * 3 + 1 ] = nor.getY( i );
		normals[ v * 3 + 2 ] = nz;

		uvs[ v * 2 ] = uv.getX( i );
		uvs[ v * 2 + 1 ] = uv.getY( i );
		v ++;

	}

	return v;

}

const _f = {};

// finishGeo goes on the first tile, or on the last one with finishAtEnd
// (the arrival of a rally stage). cornerGeo (extractCornerGeometry) draws the
// one-tile quarter turns; without it they are bent tiles like any curve.
export function buildRoadGeometry( path, straightGeo, finishGeo = null, finishAtEnd = false, cornerGeo = null ) {

	if ( path.length < 0.01 ) return null;

	const { pieces } = roadPieces( path, !! finishGeo, finishAtEnd, !! cornerGeo );
	const geoOf = ( p ) => p.corner !== undefined ? cornerGeo : p.finish ? finishGeo : straightGeo;

	let vertCount = 0, indexCount = 0;

	for ( const p of pieces ) {

		const g = geoOf( p );
		vertCount += g.attributes.position.count;
		indexCount += g.index ? g.index.count : g.attributes.position.count;

	}

	const positions = new Float32Array( vertCount * 3 );
	const normals = new Float32Array( vertCount * 3 );
	const uvs = new Float32Array( vertCount * 2 );
	const indices = new Uint32Array( indexCount );

	let v = 0, ii = 0;

	for ( const p of pieces ) {

		const g = geoOf( p );
		const base = v;

		if ( p.corner !== undefined ) {

			v = placeCorner( path, p, g, positions, normals, uvs, v );

		} else {

			const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
			const len = p.s1 - p.s0;

			for ( let i = 0; i < pos.count; i ++ ) {

				const x = pos.getX( i ), y = pos.getY( i ), z = pos.getZ( i );
				path.frameAt( p.s0 + ( z + 5 ) / 10 * len, _f );

				// Lateral axis (local +X) is the tangent rotated -90° around Y
				const lx = _f.tz, lz = - _f.tx;

				positions[ v * 3 ] = _f.x + lx * x * TRACK_SCALE;
				positions[ v * 3 + 1 ] = _f.y + ROAD_Y + y * TRACK_SCALE;
				positions[ v * 3 + 2 ] = _f.z + lz * x * TRACK_SCALE;

				// Normals in the local frame pitched by the grade g: up' ∝ up - g·T, T' ∝ T + g·up
				const nx = nor.getX( i ), ny = nor.getY( i ), nz = nor.getZ( i );
				const gr = _f.gy, k = 1 / Math.sqrt( 1 + gr * gr );
				normals[ v * 3 ] = nx * lx + ( nz - ny * gr ) * _f.tx * k;
				normals[ v * 3 + 1 ] = ( ny + nz * gr ) * k;
				normals[ v * 3 + 2 ] = nx * lz + ( nz - ny * gr ) * _f.tz * k;

				uvs[ v * 2 ] = uv.getX( i );
				uvs[ v * 2 + 1 ] = uv.getY( i );

				v ++;

			}

		}

		if ( g.index ) {

			for ( let i = 0; i < g.index.count; i ++ ) indices[ ii ++ ] = base + g.index.getX( i );

		} else {

			for ( let i = 0; i < g.attributes.position.count; i ++ ) indices[ ii ++ ] = base + i;

		}

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
	geometry.setIndex( new THREE.BufferAttribute( indices, 1 ) );
	geometry.computeBoundingSphere();

	return geometry;

}

// ─── Game helpers ─────────────────────────────────────────

export function splineSpawn( path ) {

	const f = path.frameAt( roadPieces( path, path.closed ).finishS );
	return { position: [ f.x, f.y + 0.5, f.z ], angle: Math.atan2( f.tx, f.tz ) };

}

export function splineBounds( path ) {

	let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

	for ( let i = 0; i < path.sampleCount; i ++ ) {

		minX = Math.min( minX, path.px[ i ] );
		maxX = Math.max( maxX, path.px[ i ] );
		minZ = Math.min( minZ, path.pz[ i ] );
		maxZ = Math.max( maxZ, path.pz[ i ] );

	}

	return {
		centerX: ( minX + maxX ) / 2,
		centerZ: ( minZ + maxZ ) / 2,
		halfWidth: ( maxX - minX ) / 2 + ROAD_HALF + TILE_LEN,
		halfDepth: ( maxZ - minZ ) / 2 + ROAD_HALF + TILE_LEN,
	};

}

// Lap config for LapTimer: checkpoints spread along the loop
export function splineLapConfig( path ) {

	if ( ! path.closed ) return null;

	const spawn = splineSpawn( path );
	const count = Math.max( 4, Math.floor( path.length / 12 ) );
	const radius = ROAD_HALF + 1.5;
	const points = [];

	for ( let k = 1; k < count; k ++ ) {

		const f = path.frameAt( k / count * path.length );
		points.push( [ f.x, f.z ] );

	}

	return {
		center: [ spawn.position[ 0 ], spawn.position[ 2 ] ],
		angle: spawn.angle,
		halfWidth: ROAD_HALF + 1,
		checkpointCount: points.length,
		checkpointAt( p ) {

			for ( let i = 0; i < points.length; i ++ ) {

				const dx = p.x - points[ i ][ 0 ], dz = p.z - points[ i ][ 1 ];
				if ( dx * dx + dz * dz < radius * radius ) return i;

			}

			return null;

		},
	};

}
