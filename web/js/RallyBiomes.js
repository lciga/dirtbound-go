// Biomes of the rally stages: what the land does along the road. Pure (no
// three.js): the game, the menu thumbnails and the server's finish check
// build the same stage from ( seed, landscape ).
//
// A stage is a sequence of parts along the arc length s. A seeded altitude
// walk picks a move per segment (stay, up, down, pass) and the move picks the
// biome: low and flat → plain or gorge, up / down → cliff or high mountain,
// high and flat → pasture or ridge, a pass climbs and comes back down. Cliffs
// and passes are three parts each (foot, climb, top / climb, saddle,
// descent). Every numeric setting is blended over BLEND m between biomes
// (PART_BLEND inside a cliff or a pass) and kept per metre in a Float32Array
// (`table`, FIELDS floats a row), read by the hot terrain code.
//
// The road's altitude is the integral of the grade the parts ask for (+ small
// waves), never over MAX_GRADE.

export const LANDSCAPE_IDS = [ 'varied', 'low', 'high' ]; // their names: landscape.<id> in js/locales

export function landscapeOf( value ) {

	return typeof value === 'string' && LANDSCAPE_IDS.includes( value ) ? value : 'varied';

}

export const BIOME_IDS = [ 'plain', 'gorge', 'mountain', 'cliff', 'ridge', 'pass', 'pasture' ];
export const BIOMES = {
	plain: { label: 'Plaine', color: '#4f8a2e' },
	gorge: { label: 'Gorge', color: '#7a4f2a' },
	mountain: { label: 'Haute montagne', color: '#5d6470' },
	cliff: { label: 'Flanc de falaise', color: '#c07a1c' },
	ridge: { label: 'Crête', color: '#a0927a' },
	pass: { label: 'Col', color: '#3f6fb5' },
	pasture: { label: 'Alpage', color: '#9fbf3b' },
};

export const MAX_GRADE = 0.18;
export const MIN_WIDTH = 0.8;
export const MAX_WIDTH = 1.25;
export const SNOW_LINE = 110; // m above the start: snow patches from here (biomes with snow)
const SNOW_FADE = 25; // m over which they appear

const BLEND = 150; // m between two biomes
const PART_BLEND = 40; // m between the parts of a cliff or a pass
const FLAT_START = 60; // m of flat road at the start
const LEVELS = [ 35, 95 ]; // m: below = low, below = mid, else high
const LOW_CEILING = 90; // m: the 'low' landscape never climbs past this

// Row layout of the table: three sides of 4 floats, then the rest
export const F = { void: 0, mountain: 4, across: 8, width: 12, trees: 13, crowd: 14, snow: 15 };
export const FIELDS = 16;

const side = ( height, width, slope = 0, maxRise = 0 ) => ( { height, width, slope, maxRise } );

// Corner styles (overrides of RallyRoute's DEFAULT_STYLE), the old presets
const FAST = {
	grades: [ 0, 0, 0, 1, 3, 4, 3 ],
	straight: { weight: 3, length: [ 15, 40 ] },
	sequence: { weight: 3, count: [ 2, 3 ], gap: [ 3, 10 ], exit: [ 5, 15 ] },
	kink: { weight: 3 },
	traverse: { weight: 0.5, radius: [ 12, 25 ], exit: [ 10, 30 ] },
	hairpin: { weight: 0.5, radius: [ 7, 8 ], entry: [ 4, 10 ], exit: [ 8, 16 ] },
};
const TECHNICAL = {
	grades: [ 0, 4, 5, 3, 1, 0, 0 ],
	straight: { weight: 0.3, length: [ 3, 8 ] },
	sequence: { weight: 6, count: [ 3, 5 ], gap: [ 0, 2 ], exit: [ 1, 4 ] },
	tightening: { weight: 2 },
	kink: { weight: 0.5 },
};
const MEDIUM = {
	grades: [ 0, 0, 1, 3, 4, 3, 1 ],
	straight: { weight: 1.5, length: [ 8, 20 ] },
	kink: { weight: 2.5 },
};
// Switchbacks only: sideways traverses, then hairpins back through forward
const LACETS = {
	straight: { weight: 0 }, corner: { weight: 0 }, sequence: { weight: 0 }, tightening: { weight: 0 }, kink: { weight: 0 },
	traverse: { weight: 4, exit: [ 6, 14 ] },
	hairpin: { weight: 10, exit: [ 5, 10 ] },
};

// Parts: sides (void = the side facing the valley, world +X; mountain = the
// other; across = legs running across the slope), width factor, tree and
// crowd multipliers, snow (0 / 1, above SNOW_LINE), corner style
const PARTS = {
	plain: { biome: 'plain', sides: [ side( - 1.5, 6 ), side( 1, 5, 0.03, 4 ), side( 0.6, 6, 0.02, 3 ) ], width: 1.25, trees: 0.5, crowd: 1.3, snow: 0, style: FAST },
	gorge: { biome: 'gorge', sides: [ side( 20, 5, 0.3, 30 ), side( 20, 5, 0.3, 30 ), side( 20, 5, 0.3, 30 ) ], width: 0.85, trees: 0.35, crowd: 0.6, snow: 0, style: TECHNICAL },
	mountain: { biome: 'mountain', sides: [ side( - 35, 8 ), side( 6, 4, 0.45, 60 ), side( 0, 1 ) ], width: 0.9, trees: 0.3, crowd: 0.4, snow: 1, style: TECHNICAL },
	'cliff-base': { biome: 'cliff', sides: [ side( - 2, 6 ), side( 30, 3, 0.15, 40 ), side( 0, 1 ) ], width: 0.85, trees: 0.8, crowd: 0.6, snow: 0, style: MEDIUM },
	'cliff-climb': { biome: 'cliff', sides: [ side( - 10, 6 ), side( 8, 4, 0.3, 30 ), side( 0, 1 ) ], width: 0.85, trees: 0.1, crowd: 1.2, snow: 0, style: LACETS },
	'cliff-top': { biome: 'cliff', sides: [ side( - 30, 6 ), side( 4.5, 4, 0.22, 40 ), side( 0, 1 ) ], width: 0.85, trees: 0.5, crowd: 0.5, snow: 0, style: MEDIUM },
	ridge: { biome: 'ridge', sides: [ side( - 25, 10 ), side( - 25, 10 ), side( - 25, 10 ) ], width: 0.8, trees: 0, crowd: 0.2, snow: 1, style: MEDIUM },
	'pass-climb': { biome: 'pass', sides: [ side( - 35, 8 ), side( 6, 4, 0.45, 60 ), side( 0, 1 ) ], width: 0.9, trees: 0.2, crowd: 0.6, snow: 1, style: LACETS },
	'pass-top': { biome: 'pass', sides: [ side( - 6, 8 ), side( 6, 6, 0.2, 20 ), side( 0, 1 ) ], width: 0.9, trees: 0.1, crowd: 1.6, snow: 1, style: MEDIUM },
	pasture: { biome: 'pasture', sides: [ side( 1.5, 8, 0.05, 4 ), side( 2, 8, 0.06, 6 ), side( 1, 8, 0.04, 4 ) ], width: 1.1, trees: 0, crowd: 0.5, snow: 0, style: MEDIUM },
};

// Moves per landscape and level (0 low, 1 mid, 2 high): relative weights
const MOVES = {
	varied: [ { stay: 1, up: 2 }, { stay: 1, up: 1.2, down: 1, pass: 1 }, { stay: 1.5, down: 1.2, pass: 0.8 } ],
	low: [ { stay: 2, up: 1 }, { stay: 1, down: 1.5, pass: 0.5 }, { down: 1 } ],
	high: [ { stay: 0.3, up: 3 }, { stay: 0.5, up: 2, pass: 1 }, { stay: 2, pass: 1, down: 0.6 } ],
};

function mulberry32( seed ) {

	let t = seed >>> 0;

	return () => {

		t = ( t + 0x6D2B79F5 ) >>> 0;
		let r = Math.imul( t ^ ( t >>> 15 ), 1 | t );
		r = ( r + Math.imul( r ^ ( r >>> 7 ), 61 | r ) ) ^ r;
		return ( ( r ^ ( r >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

function smooth( t ) {

	t = Math.min( 1, Math.max( 0, t ) );
	return t * t * ( 3 - 2 * t );

}

const levelOf = ( alt ) => alt < LEVELS[ 0 ] ? 0 : alt < LEVELS[ 1 ] ? 1 : 2;

class Biomes {

	constructor( seed, landscape ) {

		this.landscape = landscapeOf( landscape );
		this.rand = mulberry32( ( seed ^ 0x51ab1e ) >>> 0 );
		this.parts = []; // { id, biome, s0, s1, grade, wave, waveLength, phase, style, def }
		this.alt = 0; // planned altitude at the end of the last part
		this.prevBiome = null;
		this.table = new Float32Array( 1024 * FIELDS );
		this.rows = 0; // table rows filled (metres 0..rows-1)
		this.heights = new Float64Array( 1024 );
		this.heightRows = 1; // heights[ 0 ] = 0

	}

	range( lo, hi ) {

		return lo + ( hi - lo ) * this.rand();

	}

	pick( weights ) {

		let total = 0;
		for ( const k in weights ) total += weights[ k ];
		let r = this.rand() * total;
		for ( const k in weights ) if ( ( r -= weights[ k ] ) <= 0 ) return k;
		return Object.keys( weights )[ 0 ];

	}

	// ─── Plan ─────────────────────────────────────────────

	push( id, length, grade, wave = 0, waveLength = 200 ) {

		const s0 = this.parts.length ? this.parts[ this.parts.length - 1 ].s1 : 0;
		const def = PARTS[ id ];
		this.parts.push( { id, biome: def.biome, s0, s1: s0 + length, grade, wave, waveLength, phase: this.range( 0, Math.PI * 2 ), style: def.style, def } );
		this.alt += grade * length;

	}

	// A move and a biome that fit the landscape, the level and the previous biome
	choose() {

		const level = levelOf( this.alt );
		const weights = { ...MOVES[ this.landscape ][ level ] };
		if ( this.parts.length === 0 ) return { move: 'stay', biome: this.rand() < 0.5 ? 'plain' : 'gorge' };

		for ( let tries = 0; tries < 12; tries ++ ) {

			if ( Object.keys( weights ).length === 0 ) break;
			const move = this.pick( weights );
			const candidates = ( move === 'stay' ? ( level === 2 ? [ 'pasture', 'ridge' ] : [ 'plain', 'gorge' ] )
				: move === 'pass' ? [ 'pass' ] : [ 'cliff', 'mountain' ] ).filter( ( b ) => b !== this.prevBiome );
			const tooLow = move === 'down' && this.alt < 25;
			const tooHigh = ( move === 'up' || move === 'pass' ) && this.landscape === 'low' && this.alt > LOW_CEILING - 25;

			if ( candidates.length === 0 || tooLow || tooHigh ) {

				delete weights[ move ];
				continue;

			}

			return { move, biome: candidates[ Math.floor( this.rand() * candidates.length ) ] };

		}

		// Nothing fits: stay on a flat biome other than the last one
		const flat = ( levelOf( this.alt ) === 2 ? [ 'pasture', 'ridge' ] : [ 'plain', 'gorge' ] ).filter( ( b ) => b !== this.prevBiome );
		return { move: 'stay', biome: flat[ 0 ] };

	}

	// Height to climb (> 0) or drop (< 0), within the landscape's ceiling
	rise( move, lo, hi ) {

		let r = this.range( lo, hi );
		if ( ( move === 'up' || move === 'pass' ) && this.landscape === 'low' ) r = Math.min( r, LOW_CEILING - 10 - this.alt ); // margin for the waves
		if ( move === 'down' ) r = - Math.min( r, Math.max( 0, this.alt ) );
		return r;

	}

	planNext() {

		const { move, biome } = this.choose();
		const R = ( lo, hi ) => this.range( lo, hi );
		const sign = () => ( this.rand() < 0.5 ? - 1 : 1 );

		if ( biome === 'plain' ) this.push( 'plain', R( 600, 1200 ), 0, 0.045, 260 );
		else if ( biome === 'gorge' ) {

			const length = R( 500, 900 );
			let g = R( 0.02, 0.05 ) * ( this.alt < 10 ? 1 : sign() );
			// The 'low' landscape: a climbing gorge stops short of the ceiling (margin for the waves)
			if ( this.landscape === 'low' ) g = Math.min( g, ( LOW_CEILING - 10 - this.alt ) / length );
			this.push( 'gorge', length, g, 0.015, 120 );

		} else if ( biome === 'pasture' ) this.push( 'pasture', R( 600, 1000 ), 0, 0.03, 90 );
		else if ( biome === 'ridge' ) this.push( 'ridge', R( 400, 800 ), R( 0, 0.04 ) * sign(), 0.03, 180 );
		else if ( biome === 'mountain' ) {

			// A short climb keeps its height: a gentler grade over the minimum length
			const r = this.rise( move, 40, 70 ), length = Math.max( 200, Math.abs( r ) / R( 0.11, 0.13 ) );
			this.push( 'mountain', length, r / length, 0.02, 200 );

		} else if ( biome === 'cliff' ) {

			const r = this.rise( move, 28, 38 );
			const climbLength = Math.max( 100, Math.abs( r ) / 0.15 );
			const climb = [ 'cliff-climb', climbLength, r / climbLength ];
			const ends = move === 'down' ? [ 'cliff-top', 'cliff-base' ] : [ 'cliff-base', 'cliff-top' ];
			this.push( ends[ 0 ], R( 150, 250 ), 0, 0.01, 120 );
			this.push( ...climb );
			this.push( ends[ 1 ], R( 150, 250 ), 0, 0.01, 120 );

		} else {

			const r = this.rise( move, 30, 50 ), length = Math.max( 100, r / 0.15 );
			this.push( 'pass-climb', length, r / length );
			this.push( 'pass-top', 100, 0 );
			this.push( 'pass-climb', length, - r / length );

		}

		this.prevBiome = biome;

	}

	ensure( s ) {

		while ( this.parts.length === 0 || this.parts[ this.parts.length - 1 ].s1 < s + BLEND ) this.planNext();

	}

	index( s ) {

		this.ensure( s );
		const parts = this.parts;
		let lo = 0, hi = parts.length - 1;

		while ( lo < hi ) {

			const mid = ( lo + hi + 1 ) >> 1;
			if ( parts[ mid ].s0 <= s ) lo = mid;
			else hi = mid - 1;

		}

		return lo;

	}

	partAt( s ) {

		return this.parts[ this.index( Math.max( 0, s ) ) ];

	}

	biomeAt( s ) {

		return this.partAt( s ).biome;

	}

	// Value of get( part ) at s, blended with the neighbouring parts
	mix( s, get ) {

		const i = this.index( s );
		const p = this.parts[ i ];
		let v = get( p );

		const blend = ( a, b ) => ( a.biome === b.biome ? PART_BLEND : BLEND );
		const prev = this.parts[ i - 1 ], next = this.parts[ i + 1 ];

		if ( prev ) {

			const t = ( s - p.s0 ) / blend( prev, p ) + 0.5;
			if ( t < 1 ) v = get( prev ) + ( v - get( prev ) ) * smooth( t );

		}

		if ( next ) {

			const t = ( p.s1 - s ) / blend( p, next ) + 0.5;
			if ( t < 1 ) v = get( next ) + ( v - get( next ) ) * smooth( t );

		}

		return v;

	}

	// ─── Altitude ─────────────────────────────────────────

	grade( s ) {

		const base = this.mix( s, ( p ) => p.grade );
		const p = this.partAt( s );
		const wave = this.mix( s, ( q ) => q.wave ) * Math.cos( 2 * Math.PI * s / p.waveLength + p.phase );
		const g = ( base + wave ) * smooth( s / FLAT_START );
		return Math.max( - MAX_GRADE, Math.min( MAX_GRADE, g ) );

	}

	heightAt( s ) {

		if ( s <= 0 ) return 0;
		const m = Math.floor( s );

		while ( this.heightRows <= m + 1 ) {

			if ( this.heightRows >= this.heights.length ) {

				const bigger = new Float64Array( this.heights.length * 2 );
				bigger.set( this.heights );
				this.heights = bigger;

			}

			const k = this.heightRows - 1;
			this.heights[ k + 1 ] = this.heights[ k ] + this.grade( k + 0.5 );
			this.heightRows ++;

		}

		return this.heights[ m ] + ( this.heights[ m + 1 ] - this.heights[ m ] ) * ( s - m );

	}

	// ─── Settings ─────────────────────────────────────────

	// Offset of the row of metre floor( s ) in this.table (re-read this.table after)
	row( s ) {

		const m = Math.max( 0, Math.floor( s ) );

		while ( this.rows <= m ) {

			if ( ( this.rows + 1 ) * FIELDS > this.table.length ) {

				const bigger = new Float32Array( this.table.length * 2 );
				bigger.set( this.table );
				this.table = bigger;

			}

			this.fill( this.rows );
			this.rows ++;

		}

		return m * FIELDS;

	}

	fill( m ) {

		const t = this.table, o = m * FIELDS;

		for ( let k = 0; k < 3; k ++ ) {

			t[ o + k * 4 ] = this.mix( m, ( p ) => p.def.sides[ k ].height );
			t[ o + k * 4 + 1 ] = this.mix( m, ( p ) => p.def.sides[ k ].width );
			t[ o + k * 4 + 2 ] = this.mix( m, ( p ) => p.def.sides[ k ].slope );
			t[ o + k * 4 + 3 ] = this.mix( m, ( p ) => p.def.sides[ k ].maxRise );

		}

		t[ o + F.width ] = this.mix( m, ( p ) => p.def.width );
		t[ o + F.trees ] = this.mix( m, ( p ) => p.def.trees );
		t[ o + F.crowd ] = this.mix( m, ( p ) => p.def.crowd );
		t[ o + F.snow ] = this.mix( m, ( p ) => p.def.snow );

	}

	widthAt( s ) {

		const o = this.row( s );
		return this.table[ o + F.width ];

	}

	at( s ) {

		const o = this.row( s );
		const t = this.table;
		const read = ( k ) => side( t[ o + k ], t[ o + k + 1 ], t[ o + k + 2 ], t[ o + k + 3 ] );
		return {
			width: t[ o + F.width ],
			trees: t[ o + F.trees ], crowd: t[ o + F.crowd ], snow: t[ o + F.snow ],
			sides: { void: read( F.void ), mountain: read( F.mountain ), across: read( F.across ) },
		};

	}

	// 0..1 snow on ground at altitude `alt` near road arc length s
	snowAt( alt, s ) {

		const o = this.row( s );
		return this.table[ o + F.snow ] * smooth( ( alt - SNOW_LINE ) / SNOW_FADE );

	}

	// Consecutive stretches of one biome between s0 and s1 (menu thumbnails)
	runs( s0, s1 ) {

		this.ensure( s1 );
		const out = [];

		for ( const p of this.parts ) {

			if ( p.s1 <= s0 || p.s0 >= s1 ) continue;
			const last = out[ out.length - 1 ];
			if ( last && last.biome === p.biome ) last.s1 = Math.min( s1, p.s1 );
			else out.push( { biome: p.biome, s0: Math.max( s0, p.s0 ), s1: Math.min( s1, p.s1 ) } );

		}

		return out;

	}

}

export function createBiomes( seed, landscape ) {

	return new Biomes( seed, landscape );

}
