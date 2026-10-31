import { TrackPath, wrapAngle } from './SplineTrack.js';
import { t } from './i18n.js';

// SVG → track. Sampling uses the browser's SVG engine (all path commands,
// arcs, transforms); the polyline → spline-node conversion is pure.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPES = 'path, polygon, polyline, rect, circle, ellipse, line';
const SAMPLES = 2000;

// Returns [ { label, points: [ [ x, y ], ... ], closed, length } ], longest first.
// Subpaths (several M commands) become separate candidates.
export function sampleSvg( text ) {

	const doc = new DOMParser().parseFromString( text, 'image/svg+xml' );
	const root = doc.documentElement;
	if ( ! root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector( 'parsererror' ) ) throw new Error( t( 'editor.svgInvalid' ) );

	// Must be in the document for getCTM() / getTotalLength() to work
	const host = document.createElement( 'div' );
	host.style.cssText = 'position:absolute;left:-10000px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden';
	const svg = document.importNode( root, true );
	host.appendChild( svg );
	document.body.appendChild( host );

	const candidates = [];

	try {

		const elements = svg.querySelectorAll( SHAPES );
		let index = 0;

		for ( const el of elements ) {

			index ++;
			if ( typeof el.getTotalLength !== 'function' ) continue;

			const total = el.getTotalLength();
			if ( ! ( total > 0 ) ) continue;

			const ctm = el.getCTM();
			const n = Math.min( SAMPLES, Math.max( 64, Math.ceil( total ) ) );
			const step = total / n;
			let current = [];
			const parts = [ current ];

			for ( let i = 0; i <= n; i ++ ) {

				let p = el.getPointAtLength( Math.min( total, i * step ) );
				if ( ctm ) p = p.matrixTransform( ctm );
				const prev = current[ current.length - 1 ];

				// A jump much longer than the step means a new subpath (M command)
				if ( prev && Math.hypot( p.x - prev[ 0 ], p.y - prev[ 1 ] ) > step * 4 ) {

					current = [];
					parts.push( current );

				}

				current.push( [ p.x, p.y ] );

			}

			const tag = el.nodeName.toLowerCase();
			const explicitClose = tag === 'polygon' || tag === 'rect' || tag === 'circle' || tag === 'ellipse' ||
				( tag === 'path' && /z/i.test( el.getAttribute( 'd' ) || '' ) );

			parts.forEach( ( points, k ) => {

				if ( points.length < 3 ) return;

				const length = polylineLength( points );
				const first = points[ 0 ], last = points[ points.length - 1 ];
				const gap = Math.hypot( last[ 0 ] - first[ 0 ], last[ 1 ] - first[ 1 ] );
				const name = el.id ? `#${ el.id }` : `${ tag } ${ index }`;

				candidates.push( {
					label: parts.length > 1 ? t( 'editor.svgPart', { name, n: k + 1 } ) : name,
					points,
					closed: explicitClose || gap < length * 0.02,
					length,
				} );

			} );

		}

	} finally {

		host.remove();

	}

	candidates.sort( ( a, b ) => b.length - a.length );
	return candidates;

}

function polylineLength( points ) {

	let L = 0;
	for ( let i = 1; i < points.length; i ++ ) L += Math.hypot( points[ i ][ 0 ] - points[ i - 1 ][ 0 ], points[ i ][ 1 ] - points[ i - 1 ][ 1 ] );
	return L;

}

// Resample a polyline at a fixed spacing (closed: the loop wraps, no duplicate end point)
function resample( points, step, closed ) {

	const pts = closed ? [ ...points, points[ 0 ] ] : points;
	const out = [ pts[ 0 ].slice() ];
	let carry = 0;

	for ( let i = 1; i < pts.length; i ++ ) {

		const [ ax, ay ] = pts[ i - 1 ], [ bx, by ] = pts[ i ];
		const seg = Math.hypot( bx - ax, by - ay );
		let d = step - carry;

		while ( d <= seg ) {

			const t = d / seg;
			out.push( [ ax + ( bx - ax ) * t, ay + ( by - ay ) * t ] );
			d += step;

		}

		carry = seg - ( d - step );

	}

	if ( closed ) {

		// Drop the last point if it landed on top of the first
		const f = out[ 0 ], l = out[ out.length - 1 ];
		if ( Math.hypot( l[ 0 ] - f[ 0 ], l[ 1 ] - f[ 1 ] ) < step * 0.5 ) out.pop();

	} else {

		const end = pts[ pts.length - 1 ], l = out[ out.length - 1 ];
		if ( Math.hypot( end[ 0 ] - l[ 0 ], end[ 1 ] - l[ 1 ] ) > step * 0.25 ) out.push( end.slice() );

	}

	return out;

}

// Repeated box blur ≈ gaussian. Open paths keep their end points.
function smooth( points, radius, closed ) {

	if ( radius < 1 ) return points;

	let cur = points;
	const n = points.length;

	for ( let pass = 0; pass < 3; pass ++ ) {

		const next = [];

		for ( let i = 0; i < n; i ++ ) {

			if ( ! closed && ( i === 0 || i === n - 1 ) ) {

				next.push( cur[ i ] );
				continue;

			}

			const r = closed ? radius : Math.min( radius, i, n - 1 - i );
			let sx = 0, sy = 0;

			for ( let k = - r; k <= r; k ++ ) {

				const j = closed ? ( ( i + k ) % n + n ) % n : i + k;
				sx += cur[ j ][ 0 ];
				sy += cur[ j ][ 1 ];

			}

			next.push( [ sx / ( 2 * r + 1 ), sy / ( 2 * r + 1 ) ] );

		}

		cur = next;

	}

	return cur;

}

/**
 * Convert an SVG polyline (SVG units, y down) into track nodes.
 * options: size (m, longest side), rotation (deg), smoothing (m), start (0..1 along a loop),
 * flip, closed, center [ x, z ], heightAt( x, z ) for node elevation.
 * SVG x → world x, SVG y → world z, so the top view matches the drawing.
 */
export function polylineToTrack( points, options = {} ) {

	const {
		size = 150, rotation = 0, smoothing = 2, start = 0, flip = false, closed = true,
		center = [ 0, 0 ], heightAt = null,
	} = options;

	const STEP = 0.5;
	const MIN_SPACING = 5;
	const MAX_SPACING = 30;
	const MAX_TURN = 25 * Math.PI / 180;

	// Rotate, then scale the longest side to `size` and center
	const rad = rotation * Math.PI / 180, c = Math.cos( rad ), s = Math.sin( rad );
	let pts = points.map( ( [ x, y ] ) => [ x * c - y * s, x * s + y * c ] );
	if ( flip ) pts.reverse();

	let minX = Infinity, maxX = - Infinity, minY = Infinity, maxY = - Infinity;

	for ( const [ x, y ] of pts ) {

		minX = Math.min( minX, x ); maxX = Math.max( maxX, x );
		minY = Math.min( minY, y ); maxY = Math.max( maxY, y );

	}

	const scale = size / Math.max( maxX - minX, maxY - minY, 1e-9 );
	const cx = ( minX + maxX ) / 2, cy = ( minY + maxY ) / 2;
	pts = pts.map( ( [ x, y ] ) => [ ( x - cx ) * scale + center[ 0 ], ( y - cy ) * scale + center[ 1 ] ] );

	// Uniform spacing, smoothing, then shift the loop start
	pts = resample( pts, STEP, closed );
	pts = smooth( pts, Math.round( smoothing / STEP ), closed );

	if ( closed && start > 0 ) {

		const k = Math.floor( start * pts.length ) % pts.length;
		pts = [ ...pts.slice( k ), ...pts.slice( 0, k ) ];

	}

	const n = pts.length;
	const heading = ( i ) => {

		const a = closed ? pts[ ( i - 1 + n ) % n ] : pts[ Math.max( 0, i - 1 ) ];
		const b = closed ? pts[ ( i + 1 ) % n ] : pts[ Math.min( n - 1, i + 1 ) ];
		return Math.atan2( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );

	};

	// Place nodes where the curve has turned enough, or after MAX_SPACING
	const node = ( i ) => {

		const [ x, z ] = pts[ i ];
		const y = heightAt ? Math.round( heightAt( x, z ) * 4 ) / 4 : 0;
		return { x, z, a: heading( i ), y };

	};

	const nodes = [ node( 0 ) ];
	let last = 0, turn = 0, dist = 0;

	for ( let i = 1; i < n; i ++ ) {

		turn += Math.abs( wrapAngle( heading( i ) - heading( i - 1 ) ) );
		dist += STEP;

		if ( ( turn >= MAX_TURN && dist >= MIN_SPACING ) || dist >= MAX_SPACING ) {

			// Keep the closing gap back to the start reasonable on loops
			if ( closed && ( n - i ) * STEP < MIN_SPACING ) break;

			nodes.push( node( i ) );
			last = i;
			turn = 0;
			dist = 0;

		}

	}

	if ( ! closed && last !== n - 1 ) nodes.push( node( n - 1 ) );

	const path = new TrackPath( nodes, closed && nodes.length >= 3 );
	return { nodes, closed: path.closed, path };

}
