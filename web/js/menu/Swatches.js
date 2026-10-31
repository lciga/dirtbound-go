import * as THREE from 'three';
import { loadSecureAsset } from '../SecureAssets.js';

// The garage's livery swatches for a rally car: every livery of the pack is
// a pair of textures shared by all the cars (color-N.png under vinyls-N.png),
// but each car lays them out its own way. So the colour a car wears in
// livery N = the textures read where that car's triangles land (area
// weighted samples of its UVs), its most common colour, greys counting less
// than a real paint.

const SAMPLES = 1200;
const images = new Map(); // file → Promise<ImageData>

function image( file ) {

	if ( ! images.has( file ) ) {

		images.set( file, loadSecureAsset( 'tex/' + file )
			.then( ( data ) => createImageBitmap( new Blob( [ data ], { type: 'image/png' } ), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } ) )
			.then( ( bitmap ) => {

				const canvas = document.createElement( 'canvas' );
				canvas.width = bitmap.width;
				canvas.height = bitmap.height;
				const ctx = canvas.getContext( '2d', { willReadFrequently: true } );
				ctx.drawImage( bitmap, 0, 0 );
				return ctx.getImageData( 0, 0, bitmap.width, bitmap.height );

			} ) );

	}

	return images.get( file );

}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// UV points spread over a model's painted surface: [ { u, v, vinyl } ]
function samplePoints( model ) {

	const tris = [];
	let total = 0;

	model.updateMatrixWorld( true );
	model.traverse( ( o ) => {

		if ( ! o.isMesh || ! o.geometry.attributes.uv ) return;
		const name = o.material.name;
		if ( name === 'Lights' ) return;
		const vinyl = name === 'Vinyls';
		const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv, index = g.index;
		const count = index ? index.count : pos.count;

		for ( let i = 0; i + 2 < count; i += 3 ) {

			const ia = index ? index.getX( i ) : i, ib = index ? index.getX( i + 1 ) : i + 1, ic = index ? index.getX( i + 2 ) : i + 2;
			_a.fromBufferAttribute( pos, ia ).applyMatrix4( o.matrixWorld );
			_b.fromBufferAttribute( pos, ib ).applyMatrix4( o.matrixWorld );
			_c.fromBufferAttribute( pos, ic ).applyMatrix4( o.matrixWorld );
			const area = _b.sub( _a ).cross( _c.sub( _a ) ).length() / 2;
			if ( area <= 0 ) continue;
			total += area;
			tris.push( { area, vinyl, uv: [ uv.getX( ia ), uv.getY( ia ), uv.getX( ib ), uv.getY( ib ), uv.getX( ic ), uv.getY( ic ) ] } );

		}

	} );

	// Systematic sampling along the cumulated area (a fixed pseudo-random spread in each triangle)
	const points = [];
	let acc = 0, next = total / SAMPLES / 2, k = 0;

	for ( const t of tris ) {

		acc += t.area;

		while ( next <= acc && points.length < SAMPLES ) {

			let r1 = ( ( k * 0.618034 ) % 1 ), r2 = ( ( k * 0.754878 ) % 1 );
			if ( r1 + r2 > 1 ) {

				r1 = 1 - r1;
				r2 = 1 - r2;

			}

			const [ u0, v0, u1, v1, u2, v2 ] = t.uv;
			points.push( { u: u0 + ( u1 - u0 ) * r1 + ( u2 - u0 ) * r2, v: v0 + ( v1 - v0 ) * r1 + ( v2 - v0 ) * r2, vinyl: t.vinyl } );
			next += total / SAMPLES;
			k ++;

		}

	}

	return points;

}

function texel( img, u, v ) {

	// glTF UVs: v down, wrapped
	const x = Math.min( img.width - 1, Math.floor( ( ( u % 1 ) + 1 ) % 1 * img.width ) );
	const y = Math.min( img.height - 1, Math.floor( ( ( v % 1 ) + 1 ) % 1 * img.height ) );
	const i = ( y * img.width + x ) * 4;
	return img.data.subarray( i, i + 4 );

}

function dominant( colors ) {

	const bins = new Map();

	for ( const [ r, g, b ] of colors ) {

		const max = Math.max( r, g, b ), min = Math.min( r, g, b );
		const light = ( max + min ) / 510;
		const sat = max === min ? 0 : ( max - min ) / ( 255 - Math.abs( max + min - 255 ) );
		if ( light < 0.1 ) continue; // tyres, glass, shadows baked in: never the paint
		const gray = sat < 0.22;
		let hue = 0;
		if ( ! gray ) hue = max === r ? ( g - b ) / ( max - min ) : max === g ? 2 + ( b - r ) / ( max - min ) : 4 + ( r - g ) / ( max - min );
		const key = gray ? 'g' + Math.round( light * 4 ) : Math.round( ( ( hue + 6 ) % 6 ) * 2 ) + ':' + Math.round( light * 3 );
		const bin = bins.get( key ) || { weight: 0, n: 0, r: 0, g: 0, b: 0 };
		bin.weight += gray ? 0.3 : 1; // a coloured paint beats white and grey trims
		bin.n ++;
		bin.r += r;
		bin.g += g;
		bin.b += b;
		bins.set( key, bin );

	}

	let best = null;
	for ( const bin of bins.values() ) if ( ! best || bin.weight > best.weight ) best = bin;
	if ( ! best ) return null;
	return `rgb(${ Math.round( best.r / best.n ) }, ${ Math.round( best.g / best.n ) }, ${ Math.round( best.b / best.n ) })`;

}

const cache = new Map(); // car id → Promise<[ colour per livery ]>

// model: the car loaded in any livery (the UVs are the same in all of them)
export function carSwatches( id, model, liveries ) {

	if ( cache.has( id ) ) return cache.get( id );

	const points = samplePoints( model );
	const result = Promise.all( Array.from( { length: liveries }, async ( _, i ) => {

		const [ color, vinyls ] = await Promise.all( [ image( `color-${ i + 1 }.png` ), image( `vinyls-${ i + 1 }.png` ) ] );
		const colors = [];

		for ( const p of points ) {

			if ( p.vinyl ) {

				const t = texel( vinyls, p.u, p.v );
				if ( t[ 3 ] >= 128 ) colors.push( t ); // stickers are alpha tested

			} else colors.push( texel( color, p.u, p.v ) );

		}

		return dominant( colors );

	} ) ).catch( () => null );

	cache.set( id, result );
	return result;

}
