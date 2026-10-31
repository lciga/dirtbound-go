// Relief around the rally stage, shaped by its biomes (RallyBiomes.js): the
// side facing the valley (world +X, DOWNHILL, the screen's bottom-right), the
// other side, and legs running across the slope (both sides) each take one of
// the biome's three side shapes: a drop, or a wall then a slope.
//
// Height is defined relative to the road, never stored: for a point P, every
// nearby road sample Q (position, tangent, arc length) proposes
//   Y(Q) + profile( lateral offset of P from Q, how much that side faces DOWNHILL )
// and the proposals are blended with a soft-min on distance, so the nearest
// stretch wins, and between two legs of
// a switchback (different elevations) the ground slopes smoothly instead of
// stepping. Only road running along the slope gets the cliff and the bank:
// the effect fades out as the heading turns past ~30° toward DOWNHILL, so the
// legs of a switchback (which run across it) get flat ground on both sides
// instead of half-cliffs digging trenches between them. Up to the barriers the ground is pinned to the
// nearest sample's road level (on tight curves the blend alone would lift the
// outer edge), then fades into the blend over PIN_FADE.
//
// Pure (no three.js) so it can be checked from Node; RallyStage turns it into
// meshes (faceted, grass or rock by slope) and the car's ground.

import { cellKey, HASH_SIZE, STRIDE } from './RallyRoute.js';
import { F, SNOW_LINE } from './RallyBiomes.js';

export const DOWNHILL_X = 1; // unit vector ( DOWNHILL_X, DOWNHILL_Z )
export const DOWNHILL_Z = 0;

const SHOULDER = 0.75; // m past roadHalf (× the biome's width) before the ground leaves road level

// The game's camera is fixed (Camera.js: 45° azimuth from +X +Z, 35° up, a
// ray of slope 0.70): toward it, the ground stays under a plane of slope
// CAM_SLOPE through the road, so no wall ever stands between car and camera
const CAM_X = Math.SQRT1_2, CAM_Z = Math.SQRT1_2;
const CAM_SLOPE = 0.5;
const CAM_FREE = 1; // m toward the camera before the plane starts rising
const CAM_BAND = 10; // m either side of the line of sight that the plane covers
const SNOW_SEARCH = [ 40, 100 ]; // m: nearest road for a ground point's biome (snow)
export const SNOW_EDGE = 0.6; // amplitude of the noise added to the snow field: a ragged edge, flakes past it

// 0..1 value noise (three octaves, 4.5, 1.8 and 0.7 m) that ruffles the snow's edge.
// Mirrored in GLSL by Seasons.js SNOW_NOISE: the hash stays on small
// integers (mod 101) so CPU and GPU agree
const mod101 = ( v ) => v - Math.floor( v / 101 ) * 101;

function snowHash( i, j ) {

	let a = mod101( i );
	a = mod101( a * ( a * 13 + 7 ) ) + mod101( j );
	return mod101( a * ( a * 13 + 7 ) ) / 101;

}

function snowValue( x, z ) {

	const i = Math.floor( x ), j = Math.floor( z );
	let u = x - i, v = z - j;
	u = u * u * ( 3 - 2 * u );
	v = v * v * ( 3 - 2 * v );
	const a = snowHash( i, j ), b = snowHash( i + 1, j ), c = snowHash( i, j + 1 ), d = snowHash( i + 1, j + 1 );
	return a + ( b - a ) * u + ( c - a ) * v + ( a - b - c + d ) * u * v;

}

export function snowNoise( x, z ) {

	return 0.5 * snowValue( x / 4.5, z / 4.5 ) + 0.3 * snowValue( x / 1.8 + 31, z / 1.8 + 31 ) + 0.2 * snowValue( x / 0.7 + 57, z / 0.7 + 57 );

}

const BLEND = 2.5; // m, soft-min falloff between competing road stretches
const PIN_FADE = 2.5; // m past the barriers over which the blend takes over
const SEARCH = [ 16, 40, 120 ]; // growing search radii for the nearest road

function smooth( t ) {

	t = Math.min( 1, Math.max( 0, t ) );
	return t * t * ( 3 - 2 * t );

}

// Crags: a wall or a drop of CRAG_MIN m and more is no longer one smooth
// face (on the 2 m grid: long grey slivers, a rim parallel to the road like
// a canal) but a crag in steps, whose foot steps back and whose height varies
// from place to place (world noise, cragNoise). Its face is widened to
// CRAG_STEEP, then the final height above the road (after the blend of the
// nearby stretches, which would smear them) is cut in ledges: each band of
// `ledge` m climbed in a riser over RISER of its width, flat before
const CRAG_MIN = 5; // m: smaller banks keep their shape (fully a crag from twice that)
const CRAG_STEEP = 1.3; // rise per metre of a crag's face on average, ledges included
const LEDGE = [ 7, 11 ]; // m between two ledges, by place
const RISER = 0.35; // share of each band crossed by its riser (the rest: the ledge)
const RECESS = 4; // m a crag's foot steps back at most
const RIM = 0.3; // ± share of a crag's height, by place

// Noise of the crags at (x, z): into `out` { recess, scale, ledge, phase }
function cragNoise( x, z, out ) {

	out.recess = RECESS * snowValue( x / 23, z / 23 );
	out.scale = 1 + RIM * ( 2 * snowValue( x / 41 + 17, z / 41 + 17 ) - 1 );
	out.ledge = LEDGE[ 0 ] + ( LEDGE[ 1 ] - LEDGE[ 0 ] ) * snowValue( x / 60 + 5, z / 60 + 5 );
	out.phase = snowValue( x / 35 + 71, z / 35 + 71 );
	return out;

}

// Ledges: a height above (or below) the road, each band of `ledge` m flat
// then climbed over its last RISER share; 0 stays 0
function terrace( h, n ) {

	const band = ( v ) => {

		const b = v / n.ledge + n.phase, k = Math.floor( b );
		return k + smooth( ( b - k - ( 1 - RISER ) ) / RISER );

	};

	return ( band( h ) - band( 0 ) ) * n.ledge;

}

// How much a side shape is a crag, 0..1
const cragOf = ( t, k ) => smooth( ( Math.abs( t[ k ] ) - CRAG_MIN ) / CRAG_MIN );

// One side of the road, `e` m past the shoulder: a drop (height < 0) eased
// over its width, or a wall eased over its width then a slope, capped; a
// big one is a crag (n: cragNoise)
function shape( t, k, e, n ) {

	let height = t[ k ];
	const width = Math.max( 0.5, t[ k + 1 ] );
	const crag = cragOf( t, k );
	let run = width;

	if ( crag > 0 ) {

		height *= 1 + ( n.scale - 1 ) * crag;
		e = Math.max( 0, e - n.recess * crag );
		run = width + crag * Math.max( 0, Math.abs( height ) / CRAG_STEEP - width );

	}

	const eased = height * smooth( e / run );
	if ( height <= 0 ) return eased;
	const cap = Math.max( t[ k + 3 ] > 0 ? t[ k + 3 ] : height, height );
	return Math.min( cap, eased + t[ k + 2 ] * Math.max( 0, e - run ) );

}

const _crag = { recess: 0, scale: 1, ledge: LEDGE[ 0 ], phase: 0 };

export class RallyTerrain {

	// roadHalf: centerline → barrier outer edge (at width factor 1)
	constructor( route, roadHalf ) {

		this.route = route;
		this.roadHalf = roadHalf;
		this.crag = 0; // how much the last profile() is a crag (heightAt)

	}

	// Height relative to the road for a lateral offset `lat` (signed, + = right
	// of the tangent) where the right side faces DOWNHILL by `c` (-1..1), with
	// the biome settings of row `o` of `t` (RallyBiomes.js table); n = the
	// crags' noise at the point (cragNoise)
	profile( lat, c, t, o, n = _crag ) {

		const dist = Math.abs( lat );
		const shoulder = ( this.roadHalf + SHOULDER ) * t[ o + F.width ];
		this.crag = 0;
		if ( dist <= shoulder ) return 0;

		const e = dist - shoulder;
		const f = lat > 0 ? c : - c; // > 0: this side faces the valley
		this.crag = Math.max( 0, f ) * cragOf( t, o + F.void ) + Math.max( 0, - f ) * cragOf( t, o + F.mountain ) + ( 1 - Math.abs( f ) ) * cragOf( t, o + F.across );
		return Math.max( 0, f ) * shape( t, o + F.void, e, n ) + Math.max( 0, - f ) * shape( t, o + F.mountain, e, n ) + ( 1 - Math.abs( f ) ) * shape( t, o + F.across, e, n );

	}

	// Snow field at ( x, y, z ) (y = its height), -1..1, > 0 = snow before the
	// edge noise: the biome's snow up high (RallyBiomes.js SNOW_LINE), in
	// patches that grow with altitude. Smooth, so it can be interpolated over
	// the terrain facets; the shader cuts it sharp (Seasons.js seasonMaterial)
	snowField( x, y, z ) {

		if ( y < SNOW_LINE - 25 ) return - 1;
		const route = this.route;
		let s = route.nearestS( x, z, SNOW_SEARCH[ 0 ] );
		if ( s === null ) s = route.nearestS( x, z, SNOW_SEARCH[ 1 ] );
		if ( s === null ) return - 1;

		const amount = route.biomes.snowAt( y, s );
		if ( amount === 0 ) return - 1;
		// Patches, not a sheet: a smooth pseudo-noise, more snow the higher
		const n = 0.5 + 0.25 * ( Math.sin( x * 0.071 + z * 0.023 ) + Math.sin( z * 0.067 - x * 0.031 + 1.7 ) );
		const share = Math.min( 1, Math.max( 0, ( y - SNOW_LINE ) / 60 ) );
		const patch = ( ( n - 0.6 + 0.5 * share ) / 0.15 - 0.5 ) * 0.4;
		return Math.max( - 1, Math.min( 1, 2 * amount - 1, patch ) );

	}

	// 1 where the ground at ( x, y, z ) is drawn white, else 0: the field
	// plus the edge noise, as the shader draws it (trees, bushes: winter looks)
	snowAt( x, y, z ) {

		if ( y < SNOW_LINE - 25 ) return 0;
		return this.snowField( x, y, z ) + ( snowNoise( x, z ) - 0.5 ) * SNOW_EDGE > 0 ? 1 : 0;

	}

	// Ground height at (x, z), road level = 0 at the start line. Hot (terrain
	// tiles, trees, roadside, the car's ground): reads the route's spatial hash
	// directly, without closures; same samples in the same order as
	// route.forEachNear, so the same heights to the bit.
	heightAt( x, z ) {

		const route = this.route;
		const biomes = route.biomes;
		const hash = route.hash;
		const cx = Math.floor( x / HASH_SIZE ), cz = Math.floor( z / HASH_SIZE );
		let dMin = Infinity, sMin = 0;

		for ( const radius of SEARCH ) {

			const r = Math.ceil( radius / HASH_SIZE );

			for ( let iz = cz - r; iz <= cz + r; iz ++ ) {

				for ( let ix = cx - r; ix <= cx + r; ix ++ ) {

					const list = hash.get( cellKey( ix, iz ) );
					if ( ! list ) continue;

					for ( let i = 0; i < list.length; i += STRIDE ) {

						const dx = list[ i ] - x, dz = list[ i + 1 ] - z;
						const d = dx * dx + dz * dz;

						if ( d < dMin ) {

							dMin = d;
							sMin = list[ i + 2 ];

						}

					}

				}

			}

			if ( dMin <= radius * radius ) break;

		}

		if ( dMin === Infinity ) return 0;

		dMin = Math.sqrt( dMin );
		const cut = dMin + 5 * BLEND;
		const crag = cragNoise( x, z, _crag );
		const r = Math.ceil( cut / HASH_SIZE );
		let sum = 0, weight = 0, crags = 0;
		let cap = Infinity; // camera plane over every nearby stretch

		for ( let iz = cz - r; iz <= cz + r; iz ++ ) {

			for ( let ix = cx - r; ix <= cx + r; ix ++ ) {

				const list = hash.get( cellKey( ix, iz ) );
				if ( ! list ) continue;

				for ( let i = 0; i < list.length; i += STRIDE ) {

					const vx = x - list[ i ], vz = z - list[ i + 1 ];
					const d = Math.sqrt( vx * vx + vz * vz );
					if ( d > cut ) continue;

					// Right normal = tangent rotated -90° (same lateral axis as the road tiles)
					const nx = list[ i + 4 ], nz = - list[ i + 3 ];
					const lat = vx * nx + vz * nz;
					// How much the right side faces DOWNHILL, faded out on legs across the slope
					const facing = nx * DOWNHILL_X + nz * DOWNHILL_Z;
					const c = Math.sign( facing ) * smooth( ( Math.abs( facing ) - 0.5 ) / 0.35 );

					const w = Math.exp( - ( d - dMin ) / BLEND );
					const o = biomes.row( list[ i + 2 ] );
					const y = route.heightAt( list[ i + 2 ] );
					sum += w * ( y + this.profile( lat, c, biomes.table, o, crag ) );
					crags += w * this.crag;

					// Toward the camera from this stretch: never above its plane
					const a = vx * CAM_X + vz * CAM_Z;
					const b = vx * CAM_Z - vz * CAM_X; // across the line of sight
					if ( a > 0 && Math.abs( b ) < CAM_BAND ) cap = Math.min( cap, y + CAM_SLOPE * Math.max( 0, a - CAM_FREE ) );
					weight += w;

				}

			}

		}

		// Crags cut in ledges, above or below the nearest road
		const road = route.heightAt( sMin );
		let blended = sum / weight;
		const k = crags / weight;
		if ( k > 0 ) blended += ( terrace( blended - road, crag ) - ( blended - road ) ) * k;
		blended = Math.min( blended, cap );

		const pin = smooth( ( dMin - this.roadHalf * route.widthAt( sMin ) ) / PIN_FADE );
		if ( pin >= 1 ) return blended;
		return road + ( blended - road ) * pin;

	}

}
