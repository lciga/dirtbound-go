// Procedural rally stage: an endless road that always heads the same overall
// way (FORWARD, up-right on screen) but wanders like a real special stage.
//
// Corners are graded like rally pace notes, 1 (slowest) to 6 (near flat out),
// each grade a radius and angle range (GRADES). The rhythm comes from how they
// are strung together: linked sequences whose grade drifts from one corner to
// the next, corners that tighten or open, quick kinks, short straights, and
// switchbacks (a traverse sideways, then hairpins).
//
// Pure (no three.js): nodes are { x, z, a, y } like SplineTrack, heading a →
// direction ( sin a, cos a ). Features are chains of straights and circular
// arcs; arcs are split into ≤ 45° nodes so SplineTrack's arc-matching Béziers
// stay near-exact.
//
// Every candidate feature is sampled and checked against the road already
// laid (spatial hash): anything closer than CLEARANCE to a stretch more than
// EXCLUDE_S behind it along the road is rejected and another one is drawn.
// Heading θ relative to FORWARD stays within ±MAX_THETA, so the stage always
// makes progress; hairpins flip θ from one side to the other through forward.
//
// Elevation, corner style and road width come from the stage's biomes
// (RallyBiomes.js, `this.biomes`): a seeded altitude walk along the arc length.

import { createBiomes, MAX_WIDTH } from './RallyBiomes.js';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

// Camera sits at +X +Z looking down -X -Z: screen up-right is world -Z.
export const FORWARD = Math.PI;

const MAX_THETA = 100 * DEG; // heading off FORWARD allowed at the end of a feature
const MAX_THETA_INSIDE = 115 * DEG; // ...and anywhere inside one (hairpins excepted)
const ARC_PIECE = 45 * DEG;
const SAMPLE = 1; // m between collision samples
const EXCLUDE_S = 24; // road this close behind (along the path) is never tested
const HASH_CELL = 10;
const MAX_TRIES = 30;
export const STRIDE = 5; // hash sample: x, z, s, tx, tz
export const HASH_SIZE = HASH_CELL;

// Spatial hash key of cell (ix, iz): a number, much faster than "ix,iz"
// strings (the terrain height reads hundreds of cells per point)
export function cellKey( ix, iz ) {

	return ( ix + 0x8000 ) * 0x10000 + ( iz + 0x8000 );

}

// ─── Corner style ─────────────────────────────────────
// Pace-note grades: [ radius min, max (m), angle min, max (°) ]. Tight grades
// turn more, fast ones less. Radii below ~5.5 m put the legs of a hairpin
// closer than the clearance check allows.

export const GRADES = [
	null,
	[ 5.5, 6.5, 60, 110 ], // 1: slowest, nearly a hairpin
	[ 6.5, 8.5, 50, 100 ],
	[ 8.5, 12, 40, 90 ],
	[ 12, 17, 30, 70 ],
	[ 17, 25, 20, 50 ],
	[ 25, 40, 10, 30 ], // 6: near flat out
];

// What the stage is made of. `weight` = how often a feature is drawn relative
// to the others (0 disables it); ranges are [ min, max ] drawn uniformly
// (metres, degrees). `grades` weighs pace-note grades 1..6 for every corner.
// Each biome overrides it (RallyBiomes.js PARTS[ … ].style, merged per
// feature, arrays replaced) for the road laid inside it.

export const DEFAULT_STYLE = {

	grades: [ 0, 2, 4, 4, 3, 2, 1 ], // index = grade

	// When the road points sideways, corners turn back toward forward this often
	returnBias: 0.75,

	straight: { weight: 1, length: [ 4, 14 ] },

	// One corner and a short run out of it
	corner: { weight: 2, exit: [ 1, 6 ] },

	// 2-4 linked corners: each alternates direction `alternate` of the time and
	// drifts by up to `drift` grades from the previous one ("3 left into 4
	// right into 2 left...")
	sequence: { weight: 5, count: [ 2, 4 ], gap: [ 0, 4 ], exit: [ 2, 8 ], alternate: 0.7, drift: 1 },

	// One direction, two radii: tightens (50 %) or opens by 1-2 grades
	tightening: { weight: 1.5, exit: [ 1, 6 ] },

	// Small quick direction change between corners
	kink: { weight: 1.5, radius: [ 25, 45 ], angle: [ 8, 20 ], exit: [ 3, 10 ] },

	// Swing sideways (to `angle` off forward) to set up switchbacks
	traverse: { weight: 1.2, radius: [ 7, 14 ], angle: [ 70, 95 ], exit: [ 4, 12 ] },

	// Tight turn back through forward, leaving at `exitAngle` on the other side.
	// Only drawn when the road points more than `minAngle` sideways.
	hairpin: { weight: 4, radius: [ 6, 7 ], minAngle: 55, exitAngle: [ 45, 80 ], entry: [ 2, 6 ], exit: [ 4, 10 ] },

};

export const LEAD_IN = 45; // m of road drawn before the start line (not driven)
export const RUN_OUT = 45; // m drawn past the end of a limited stage

function wrapAngle( a ) {

	a = ( a + Math.PI ) % TWO_PI;
	if ( a < 0 ) a += TWO_PI;
	return a - Math.PI;

}

// Small seeded PRNG so a seed always gives the same stage
function mulberry32( seed ) {

	let t = seed >>> 0;

	return () => {

		t = ( t + 0x6D2B79F5 ) >>> 0;
		let r = Math.imul( t ^ ( t >>> 15 ), 1 | t );
		r = ( r + Math.imul( r ^ ( r >>> 7 ), 61 | r ) ) ^ r;
		return ( ( r ^ ( r >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export class RallyRoute {

	// roadHalf: centerline → barrier outer edge
	// landscape: RallyBiomes.js LANDSCAPE_IDS ('varied', 'low', 'high')
	// maxLength: the road stops once it reaches this (a limited stage)
	constructor( seed, roadHalf, landscape = 'varied', maxLength = Infinity, { featureScale = 1 } = {} ) {

		// Beta's faster cars need full-size bends and run-ups. Road width and
		// advertised distance stay unchanged; ordinary seeds retain their layout.
		this.featureScale = Math.max(1, Number(featureScale) || 1);

		this.maxLength = maxLength > 0 ? maxLength : Infinity;
		this.biomes = createBiomes( seed, landscape );
		this.styles = new Map(); // part id → DEFAULT_STYLE merged with the biome's

		this.rand = mulberry32( seed );
		// Room between two stretches: the widest road a biome draws, + margin
		this.clearance = 2 * roadHalf * MAX_WIDTH + 2.5;

		this.nodes = [ { x: 0, z: 0, a: FORWARD, y: 0, s: 0 } ];
		this.length = 0; // arc length at the last node
		this.cursor = 0; // first node of the next chunk

		this.hash = new Map(); // cellKey( ix, iz ) → [ x, z, s, tx, tz, ... ]
		this.addSample( 0, 0, 0, Math.sin( FORWARD ), Math.cos( FORWARD ) );

		// The road carries on behind the start (negative arc length): the
		// terrain stays at road level under it, trees and later road keep off
		for ( let d = SAMPLE; d <= LEAD_IN; d += SAMPLE ) this.addSample( - Math.sin( FORWARD ) * d, - Math.cos( FORWARD ) * d, - d, Math.sin( FORWARD ), Math.cos( FORWARD ) );
		this.runOut = null; // { x, z, a, s }: end of the stretch past a limited stage's end

		this.started = false;
		this.fallbacks = 0; // times every candidate was rejected (stats)

	}

	// Corner style of the biome the road is being laid in
	get style() {

		const part = this.biomes.partAt( this.length );
		let style = this.styles.get( part.id );

		if ( ! style ) {

			style = {};

			for ( const key in DEFAULT_STYLE ) {

				const base = DEFAULT_STYLE[ key ], over = part.style[ key ];
				const plain = Array.isArray( base ) || typeof base !== 'object';
				style[ key ] = over === undefined ? base : plain ? over : { ...base, ...over };

			}

			this.styles.set( part.id, style );

		}

		return style;

	}

	// Width factor of the dirt at s (RallyBiomes.js, 0.8..1.25)
	widthAt( s ) {

		return this.biomes.widthAt( s );

	}

	// Arc length of the road sample nearest ( x, z ) within radius, else null
	nearestS( x, z, radius ) {

		let best = radius * radius, found = null;

		this.forEachNear( x, z, radius, ( sx, sz, s ) => {

			const d = ( sx - x ) ** 2 + ( sz - z ) ** 2;

			if ( d <= best ) {

				best = d;
				found = s;

			}

		} );

		return found;

	}

	get last() {

		return this.nodes[ this.nodes.length - 1 ];

	}

	range( lo, hi ) {

		return lo + ( hi - lo ) * this.rand();

	}

	// ─── Elevation ────────────────────────────────────────

	// Road elevation at arc length s (0 at the start line): the biomes' plan
	heightAt( s ) {

		return this.biomes.heightAt( s );

	}

	gradeAt( s ) {

		return ( this.heightAt( s + 0.5 ) - this.heightAt( s - 0.5 ) );

	}

	// ─── Spatial hash ─────────────────────────────────────

	addSample( x, z, s, tx, tz ) {

		const key = cellKey( Math.floor( x / HASH_CELL ), Math.floor( z / HASH_CELL ) );
		let list = this.hash.get( key );
		if ( ! list ) this.hash.set( key, list = [] );
		list.push( x, z, s, tx, tz );

	}

	// Calls fn( x, z, s, tx, tz ) for road samples in the hash cells within radius
	forEachNear( x, z, radius, fn ) {

		const r = Math.ceil( radius / HASH_CELL );
		const cx = Math.floor( x / HASH_CELL ), cz = Math.floor( z / HASH_CELL );

		for ( let iz = cz - r; iz <= cz + r; iz ++ ) {

			for ( let ix = cx - r; ix <= cx + r; ix ++ ) {

				const list = this.hash.get( cellKey( ix, iz ) );
				if ( ! list ) continue;
				for ( let i = 0; i < list.length; i += STRIDE ) fn( list[ i ], list[ i + 1 ], list[ i + 2 ], list[ i + 3 ], list[ i + 4 ] );

			}

		}

	}

	// Distance to the nearest road sample within `radius` (Infinity if none).
	// Samples whose arc length is above maxS are ignored.
	distanceTo( x, z, radius, maxS = Infinity ) {

		const r = Math.ceil( radius / HASH_CELL );
		const cx = Math.floor( x / HASH_CELL ), cz = Math.floor( z / HASH_CELL );
		let best = radius * radius;
		let found = false;

		for ( let iz = cz - r; iz <= cz + r; iz ++ ) {

			for ( let ix = cx - r; ix <= cx + r; ix ++ ) {

				const list = this.hash.get( cellKey( ix, iz ) );
				if ( ! list ) continue;

				for ( let i = 0; i < list.length; i += STRIDE ) {

					if ( list[ i + 2 ] > maxS ) continue;
					const dx = list[ i ] - x, dz = list[ i + 1 ] - z;
					const d = dx * dx + dz * dz;

					if ( d <= best ) {

						best = d;
						found = true;

					}

				}

			}

		}

		return found ? Math.sqrt( best ) : Infinity;

	}

	// Distance to the nearest road sample within `radius`, ignoring the road
	// within `skip` metres of arc length `s` (the stretch a roadside object
	// belongs to): tells whether it stands on ANOTHER stretch (switchbacks)
	distanceToOther( x, z, radius, s, skip ) {

		const r = Math.ceil( radius / HASH_CELL );
		const cx = Math.floor( x / HASH_CELL ), cz = Math.floor( z / HASH_CELL );
		let best = radius * radius;
		let found = false;

		for ( let iz = cz - r; iz <= cz + r; iz ++ ) {

			for ( let ix = cx - r; ix <= cx + r; ix ++ ) {

				const list = this.hash.get( cellKey( ix, iz ) );
				if ( ! list ) continue;

				for ( let i = 0; i < list.length; i += STRIDE ) {

					if ( Math.abs( list[ i + 2 ] - s ) < skip ) continue;
					const dx = list[ i ] - x, dz = list[ i + 1 ] - z;
					const d = dx * dx + dz * dz;

					if ( d <= best ) {

						best = d;
						found = true;

					}

				}

			}

		}

		return found ? Math.sqrt( best ) : Infinity;

	}

	// ─── Moves ────────────────────────────────────────────
	// A move is { len } (straight) or { r, turn } (signed arc).
	// Expands moves from `start` into nodes + collision samples.

	expand( start, moves ) {

		const nodes = [];
		const samples = [];
		let { x, z, a } = start;
		let s = 0;
		let maxTheta = 0;

		const emit = ( px, pz, ha ) => samples.push( px, pz, s, Math.sin( ha ), Math.cos( ha ) );

		for ( const move of moves ) {

			const m = move.len !== undefined ? { ...move, len: move.len * this.featureScale } : { ...move, r: move.r * this.featureScale };
			if (this.featureScale > 1 && Number.isFinite(this.maxLength)) {
				const remaining = this.maxLength - this.length - s;
				if (remaining <= 1e-8) break;
				if (m.len !== undefined) m.len = Math.min(m.len, remaining);
				else m.turn = Math.sign(m.turn) * Math.min(Math.abs(m.turn), remaining / m.r);
			}

			if ( m.len !== undefined ) {

				const steps = Math.max( 1, Math.round( m.len / SAMPLE ) );

				for ( let k = 1; k <= steps; k ++ ) {

					const d = m.len * k / steps;
					s += m.len / steps;
					emit( x + Math.sin( a ) * d, z + Math.cos( a ) * d, a );

				}

				x += Math.sin( a ) * m.len;
				z += Math.cos( a ) * m.len;
				nodes.push( { x, z, a, y: 0, s } );

			} else {

				const pieces = Math.max( 1, Math.ceil( Math.abs( m.turn ) / ARC_PIECE ) );
				const dTurn = m.turn / pieces;

				for ( let p = 0; p < pieces; p ++ ) {

					const arcLen = m.r * Math.abs( dTurn );
					const steps = Math.max( 1, Math.round( arcLen / SAMPLE ) );

					for ( let k = 1; k <= steps; k ++ ) {

						const t = dTurn * k / steps;
						const chord = 2 * m.r * Math.sin( Math.abs( t ) / 2 );
						s += arcLen / steps;
						emit( x + Math.sin( a + t / 2 ) * chord, z + Math.cos( a + t / 2 ) * chord, a + t );

					}

					const chord = 2 * m.r * Math.sin( Math.abs( dTurn ) / 2 );
					x += Math.sin( a + dTurn / 2 ) * chord;
					z += Math.cos( a + dTurn / 2 ) * chord;
					a = wrapAngle( a + dTurn );
					nodes.push( { x, z, a, y: 0, s } );
					if ( ! m.through ) maxTheta = Math.max( maxTheta, Math.abs( wrapAngle( a - FORWARD ) ) );

				}

			}

		}

		return { nodes, samples, length: s, endA: a, maxTheta };

	}

	// Clear of the road already laid, and still heading the right way
	fits( result ) {

		if ( Math.abs( wrapAngle( result.endA - FORWARD ) ) > MAX_THETA ) return false;
		if ( result.maxTheta > MAX_THETA_INSIDE ) return false;

		const { samples } = result;

		for ( let i = 0; i < samples.length; i += STRIDE ) {

			const s = this.length + samples[ i + 2 ];
			const d = this.distanceTo( samples[ i ], samples[ i + 1 ], this.clearance, s - EXCLUDE_S );
			if ( d < this.clearance ) return false;

		}

		return true;

	}

	commit( result ) {

		const r = result.samples;

		for ( let i = 0; i < r.length; i += STRIDE ) {

			this.addSample( r[ i ], r[ i + 1 ], this.length + r[ i + 2 ], r[ i + 3 ], r[ i + 4 ] );

		}

		for ( const node of result.nodes ) {

			node.s += this.length;
			node.y = this.heightAt( node.s );
			this.nodes.push( node );

		}

		this.length += result.length;

		// A limited stage just ended: the road carries on straight past it
		if ( this.finished && ! this.runOut ) {

			const end = this.last, dx = Math.sin( end.a ), dz = Math.cos( end.a );
			for ( let d = SAMPLE; d <= RUN_OUT; d += SAMPLE ) this.addSample( end.x + dx * d, end.z + dz * d, this.length + d, dx, dz );
			this.runOut = { x: end.x + dx * RUN_OUT, z: end.z + dz * RUN_OUT, a: end.a, s: this.length + RUN_OUT };

		}

	}

	// ─── Features ─────────────────────────────────────────

	// Heading relative to FORWARD: 0 = straight up-right, ±90° = sideways
	get theta() {

		return wrapAngle( this.last.a - FORWARD );

	}

	// Weighted pick of a pace-note grade, optionally within [ lo, hi ]
	pickGrade( lo = 1, hi = 6 ) {

		const w = this.style.grades;
		let total = 0;
		for ( let g = lo; g <= hi; g ++ ) total += w[ g ] || 0;
		if ( total <= 0 ) return Math.round( ( lo + hi ) / 2 );

		let pick = this.rand() * total;

		for ( let g = lo; g <= hi; g ++ ) {

			pick -= w[ g ] || 0;
			if ( pick <= 0 ) return g;

		}

		return hi;

	}

	// A corner move of grade g turning `sign` (angle scaled by `share`)
	corner( g, sign, share = 1 ) {

		const [ r0, r1, a0, a1 ] = GRADES[ g ];
		return { r: this.range( r0, r1 ), turn: sign * this.range( a0, a1 ) * share * DEG };

	}

	// Direction for the next corner given the heading so far: back toward
	// forward when sideways (mostly), else alternate with the previous one
	cornerSign( theta, prevSign, alternate ) {

		const coin = this.rand() < 0.5 ? - 1 : 1;
		if ( Math.abs( theta ) > 30 * DEG && this.rand() < this.style.returnBias ) return - Math.sign( theta );
		if ( ! prevSign ) return coin;
		return this.rand() < alternate ? - prevSign : prevSign;

	}

	pickFeature() {

		const theta = this.theta;
		const abs = Math.abs( theta );
		const side = Math.sign( theta ) || ( this.rand() < 0.5 ? - 1 : 1 );
		const R = ( [ lo, hi ] ) => this.range( lo, hi );
		const coin = () => this.rand() < 0.5 ? - 1 : 1;
		const { straight, corner, sequence, tightening, kink, traverse, hairpin } = this.style;

		const options = [];

		options.push( [ straight.weight, () => [ { len: R( straight.length ) } ] ] );

		options.push( [ corner.weight, () => [ this.corner( this.pickGrade(), this.cornerSign( theta, 0, 0 ) ), { len: R( corner.exit ) } ] ] );

		options.push( [ sequence.weight, () => {

			const moves = [];
			const count = Math.round( R( sequence.count ) );
			let g = this.pickGrade(), sign = 0, t = theta;

			for ( let k = 0; k < count; k ++ ) {

				if ( k > 0 ) {

					g = Math.min( 6, Math.max( 1, g + Math.round( this.range( - sequence.drift, sequence.drift ) ) ) );
					moves.push( { len: R( sequence.gap ) } );

				}

				sign = this.cornerSign( t, sign, sequence.alternate );
				const move = this.corner( g, sign );
				t += move.turn;
				moves.push( move );

			}

			moves.push( { len: R( sequence.exit ) } );
			return moves;

		} ] );

		options.push( [ tightening.weight, () => {

			const sign = this.cornerSign( theta, 0, 0 );
			const g1 = this.pickGrade( 3, 6 );
			const g2 = Math.max( 1, g1 - ( this.rand() < 0.5 ? 1 : 2 ) );
			const [ first, second ] = this.rand() < 0.5 ? [ g1, g2 ] : [ g2, g1 ]; // tightens / opens
			return [ this.corner( first, sign, 0.6 ), this.corner( second, sign, 0.6 ), { len: R( tightening.exit ) } ];

		} ] );

		options.push( [ kink.weight, () => {

			const sign = abs > 20 * DEG && this.rand() < this.style.returnBias ? - side : coin();
			return [ { r: R( kink.radius ), turn: sign * R( kink.angle ) * DEG }, { len: R( kink.exit ) } ];

		} ] );

		if ( abs < hairpin.minAngle * DEG ) {

			options.push( [ traverse.weight, () => {

				const target = coin() * R( traverse.angle ) * DEG;
				return [ { r: R( traverse.radius ), turn: target - theta }, { len: R( traverse.exit ) } ];

			} ] );

		} else {

			// Turn through forward and out the other side (`through`: may pass
			// the heading limit on the way)
			options.push( [ hairpin.weight, () => {

				const out = R( hairpin.exitAngle ) * DEG;
				return [ { len: R( hairpin.entry ) }, { r: R( hairpin.radius ), turn: - side * ( abs + out ), through: true }, { len: R( hairpin.exit ) } ];

			} ] );

		}

		let total = 0;
		for ( const [ w ] of options ) total += w;

		// Everything available disabled: plain straight
		if ( total <= 0 ) return [ { len: R( straight.length ) } ];

		let pick = this.rand() * total;

		for ( const [ w, make ] of options ) {

			if ( w <= 0 ) continue;
			pick -= w;
			if ( pick <= 0 ) return make();

		}

		return [ { len: R( straight.length ) } ];

	}

	// A limited stage has laid all its road
	get finished() {

		return this.length >= this.maxLength;

	}

	// Appends one feature to the road
	grow() {

		if ( this.finished ) return;

		if ( ! this.started ) {

			// Start straight: finish tile + a run-up
			this.started = true;
			this.commit( this.expand( this.last, [ { len: 22 } ] ) );
			return;

		}

		for ( let i = 0; i < MAX_TRIES; i ++ ) {

			const result = this.expand( this.last, this.pickFeature() );

			if ( this.fits( result ) ) {

				this.commit( result );
				return;

			}

		}

		// Boxed in (rare): long gentle curve back to forward, accepted as is
		this.fallbacks ++;
		const theta = this.theta;
		this.commit( this.expand( this.last, [ { r: 30, turn: - theta }, { len: 15 } ] ) );

	}

	// Lays road until it reaches arc length s
	growTo( s ) {

		while ( this.length < s && ! this.finished ) this.grow();

	}

	// The next stretch of at least `minLength` (node aligned), including the
	// node shared with the previous chunk: { nodes, startS, length, last }.
	// On a limited stage the final chunk takes whatever is left (a short
	// remainder is merged into it); null once the road is used up.
	chunk( minLength ) {

		const start = this.nodes[ this.cursor ];
		let j = this.cursor + 1;

		for ( ;; ) {

			while ( j >= this.nodes.length && ! this.finished ) this.grow();

			if ( j >= this.nodes.length ) {

				j = this.nodes.length - 1;
				break;

			}

			if ( this.nodes[ j ].s - start.s >= minLength ) break;
			j ++;

		}

		if ( j <= this.cursor ) return null;

		const end = this.nodes.length - 1;
		if ( this.finished && this.nodes[ end ].s - this.nodes[ j ].s < minLength / 2 ) j = end;

		const nodes = this.nodes.slice( this.cursor, j + 1 );
		this.cursor = j;

		return { nodes, startS: start.s, length: this.nodes[ j ].s - start.s, last: this.finished && j === end };

	}

}
