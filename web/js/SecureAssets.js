// Loads assets packed by tools/packing.mjs (pack_rally_cars.mjs: models/cars/<id>.car,
// pack_fonts.mjs: fonts/packed/<id>.bin) = 12-byte iv + AES-256-GCM(gzip(file)) + tag.
// Decrypted and inflated in memory; the raw files are never served. Needs a
// secure context (https or localhost) for WebCrypto.

import { DefaultLoadingManager } from 'three';
import * as CAR_KEY from './assetKey.js';

const IV_BYTES = 12;

// A packed folder: dir + ext, keys = its generated key module ({ ASSET_SALT, ASSET_KEY, ASSET_MASK }).
// load( name ) resolves to the original bytes, counted by three's
// DefaultLoadingManager like any other file (the loading bar)
export function createVault( dir, ext, keys ) {

	let keyPromise = null;
	const getKey = () => keyPromise ??= crypto.subtle.importKey( 'raw',
		new Uint8Array( keys.ASSET_KEY.map( ( b, i ) => b ^ keys.ASSET_MASK[ i ] ) ), 'AES-GCM', false, [ 'decrypt' ] );

	return {

		async load( name ) {

			DefaultLoadingManager.itemStart( name );

			try {

				return await unpack( dir + await assetId( keys.ASSET_SALT, name ) + ext, name, getKey );

			} finally {

				DefaultLoadingManager.itemEnd( name );

			}

		},

	};

}

const cars = createVault( 'models/cars/', '.car', CAR_KEY );

// name: 'car/<Model>' or 'tex/<file>.png'. Resolves to the original bytes
export const loadSecureAsset = ( name ) => cars.load( name );

async function assetId( salt, name ) {

	const digest = await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( salt + name ) );
	return [ ...new Uint8Array( digest ) ].map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' ).slice( 0, 24 );

}

async function gunzip( data ) {

	const stream = new Blob( [ data ] ).stream().pipeThrough( new DecompressionStream( 'gzip' ) );
	return new Response( stream ).arrayBuffer();

}

async function unpack( url, name, getKey ) {

	const response = await fetch( url );
	if ( ! response.ok ) throw new Error( `Asset "${ name }" not found (HTTP ${ response.status })` );

	const packed = new Uint8Array( await response.arrayBuffer() );
	if ( packed.length <= IV_BYTES ) throw new Error( `Asset "${ name }" is truncated` );

	let compressed;

	try {

		compressed = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: packed.subarray( 0, IV_BYTES ) },
			await getKey(),
			packed.subarray( IV_BYTES )
		);

	} catch {

		throw new Error( `Asset "${ name }" could not be decrypted (pack and key out of sync?)` );

	}

	return gunzip( compressed );

}
