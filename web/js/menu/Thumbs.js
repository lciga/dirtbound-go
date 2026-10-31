import { decodeTrack, TrackPath } from '../SplineTrack.js';
import { TRACK_CELLS, decodeCells } from '../Track.js';
import { RallyRoute } from '../RallyRoute.js';
import { BIOMES } from '../RallyBiomes.js';

// Top-down drawings of circuits for the menu, as SVG strings: the road as a
// thick dark ribbon with a dashed centre line and the start marked. Screen
// up is world -Z, like the editor's top view.

const VIEW = 100;
const cache = new Map();

// points: [ [ x, z ], ... ] in world units; runs: [ { color, from, to } ]
// (indices into points) to colour the road by stretch (rally biomes)
function ribbon( points, { closed = true, start = true, finish = false, runs = null } = {} ) {

	let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

	for ( const [ x, z ] of points ) {

		minX = Math.min( minX, x ); maxX = Math.max( maxX, x );
		minZ = Math.min( minZ, z ); maxZ = Math.max( maxZ, z );

	}

	const size = Math.max( maxX - minX, maxZ - minZ, 1 );
	const pad = 14;
	const k = ( VIEW - 2 * pad ) / size;
	const ox = pad + ( VIEW - 2 * pad - ( maxX - minX ) * k ) / 2;
	const oz = pad + ( VIEW - 2 * pad - ( maxZ - minZ ) * k ) / 2;
	const p = ( [ x, z ] ) => `${ ( ox + ( x - minX ) * k ).toFixed( 1 ) } ${ ( oz + ( z - minZ ) * k ).toFixed( 1 ) }`;

	const d = 'M' + points.map( p ).join( 'L' ) + ( closed ? 'Z' : '' );
	const [ sx, sy ] = p( points[ 0 ] ).split( ' ' );
	const [ ex, ey ] = p( points[ points.length - 1 ] ).split( ' ' );

	return `<svg class="thumb" viewBox="0 0 ${ VIEW } ${ VIEW }" aria-hidden="true">` +
		`<path d="${ d }" class="road-edge"/>` +
		( runs ? runs.map( ( r ) => `<path d="M${ points.slice( r.from, r.to + 1 ).map( p ).join( 'L' ) }" class="road" style="stroke:${ r.color }"/>` ).join( '' ) : `<path d="${ d }" class="road"/>` ) +
		`<path d="${ d }" class="road-line"/>` +
		( start ? `<circle cx="${ sx }" cy="${ sy }" r="4.2" class="start"/>` : '' ) +
		( finish ? `<rect x="${ ex - 3.5 }" y="${ ey - 3.5 }" width="7" height="7" class="finish"/>` : '' ) +
		'</svg>';

}

const empty = '<svg class="thumb" viewBox="0 0 100 100" aria-hidden="true"><text x="50" y="56" class="thumb-empty">?</text></svg>';

// A circuit from the editor (full encoded track or its terrain-less shape)
export async function splineThumb( data ) {

	if ( ! data ) return empty;
	if ( cache.has( data ) ) return cache.get( data );

	let svg = empty;

	try {

		const track = await decodeTrack( data );
		const path = new TrackPath( track.nodes, track.closed );
		const points = [];
		const step = Math.max( 1, Math.floor( path.sampleCount / 160 ) );
		for ( let i = 0; i < path.sampleCount; i += step ) points.push( [ path.px[ i ], path.pz[ i ] ] );
		if ( points.length > 1 ) svg = ribbon( points, { closed: track.closed } );

	} catch {}

	cache.set( data, svg );
	return svg;

}

// A grid circuit: every road cell as a rounded tile
export function gridThumb( cells = TRACK_CELLS ) {

	let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

	for ( const [ gx, gz ] of cells ) {

		minX = Math.min( minX, gx ); maxX = Math.max( maxX, gx );
		minZ = Math.min( minZ, gz ); maxZ = Math.max( maxZ, gz );

	}

	const n = Math.max( maxX - minX, maxZ - minZ ) + 1;
	const cell = ( VIEW - 24 ) / n;
	const ox = 12 + ( VIEW - 24 - ( maxX - minX + 1 ) * cell ) / 2;
	const oz = 12 + ( VIEW - 24 - ( maxZ - minZ + 1 ) * cell ) / 2;

	return `<svg class="thumb" viewBox="0 0 ${ VIEW } ${ VIEW }" aria-hidden="true">` + cells.map( ( [ gx, gz, key ] ) =>
		`<rect x="${ ( ox + ( gx - minX ) * cell + 0.8 ).toFixed( 1 ) }" y="${ ( oz + ( gz - minZ ) * cell + 0.8 ).toFixed( 1 ) }" width="${ ( cell - 1.6 ).toFixed( 1 ) }" height="${ ( cell - 1.6 ).toFixed( 1 ) }" rx="${ ( cell * 0.22 ).toFixed( 1 ) }" class="${ key === 'track-finish' ? 'cell start' : 'cell' }"/>` ).join( '' ) + '</svg>';

}

export function mapThumb( encoded ) {

	try {

		return gridThumb( decodeCells( encoded ) );

	} catch {

		return empty;

	}

}

const routes = new Map(); // `${ seed }.${ landscape }.${ length }` → { route, points }

function rallyRoute( seed, landscape, length ) {

	const key = `${ seed }.${ landscape }.${ length }`;
	if ( routes.has( key ) ) return routes.get( key );

	const route = new RallyRoute( seed, 3.75, landscape, length || Infinity );
	route.growTo( length || 3000 );
	const points = [];
	for ( const list of route.hash.values() ) for ( let i = 0; i < list.length; i += 5 ) if ( list[ i + 2 ] >= 0 && list[ i + 2 ] <= route.length ) points.push( [ list[ i + 2 ], list[ i ], list[ i + 1 ] ] );
	points.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );
	const entry = { route, points: points.filter( ( _, i ) => i % 4 === 0 ) };
	routes.set( key, entry );
	return entry;

}

// The road of a rally stage, as generated for this seed / landscape / length, coloured by biome
export function rallyThumb( seed, landscape, length ) {

	const key = `rally.${ seed }.${ landscape }.${ length }`;
	if ( cache.has( key ) ) return cache.get( key );

	const { route, points } = rallyRoute( seed, landscape, length );
	const runs = [];

	points.forEach( ( [ s ], i ) => {

		const color = BIOMES[ route.biomes.biomeAt( s ) ].color;
		const last = runs[ runs.length - 1 ];
		if ( last && last.color === color ) last.to = i;
		else runs.push( { color, from: Math.max( 0, i - 1 ), to: i } );

	} );

	// Stage heads up-right in the game: turn it so it climbs the card
	const c = Math.cos( Math.PI / 4 ), sn = Math.sin( Math.PI / 4 );
	const svg = ribbon( points.map( ( [ , x, z ] ) => [ x * c - z * sn, x * sn + z * c ] ), { closed: false, finish: !! length, runs } );
	cache.set( key, svg );
	return svg;

}

// Biomes met along the stage, in order of first appearance (menu legend)
export function rallyBiomeList( seed, landscape, length ) {

	const { route } = rallyRoute( seed, landscape, length );
	return [ ...new Set( route.biomes.runs( 0, length || 3000 ).map( ( r ) => r.biome ) ) ];

}

// A thumbnail as an image URL (drawn into a canvas: the 3D menu's tiles): the
// page's CSS for it inlined (index.html, Track thumbnails)
const THUMB_STYLE = '.thumb path{fill:none;stroke-linecap:round;stroke-linejoin:round}.thumb .road-edge{stroke:#f4f5f8;stroke-width:11}.thumb .road{stroke:#2f3440;stroke-width:8}.thumb .road-line{stroke:#f4f5f8;stroke-width:0.9;stroke-dasharray:2.5 2.5}.thumb .start{fill:#ff6a1a;stroke:#fff;stroke-width:1.6}.thumb .finish{fill:#fff;stroke:#1f2430;stroke-width:1.4}.thumb .cell{fill:#2f3440}.thumb .cell.start{fill:#ff6a1a}.thumb .thumb-empty{font:900 30px sans-serif;fill:#9aa3b5;text-anchor:middle}';

export function thumbURL( svg ) {

	const full = svg.replace( '<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" ` ).replace( /(<svg[^>]*>)/, `$1<style>${ THUMB_STYLE }</style>` );
	return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent( full );

}
