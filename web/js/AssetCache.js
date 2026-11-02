// Registers the asset cache (sw.js) and, with the "cache" debug topic on
// (DebugLog.js), reports what it served. localStorage "dirtbound.nocache" = 1
// removes it (worker and stored files) for troubleshooting.

import { debugLog } from './DebugLog.js';

const log = debugLog( 'cache' );
const workers = navigator.serviceWorker;
const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

function disabled() {

	try {

		return localStorage.getItem( 'dirtbound.nocache' ) === '1';

	} catch {

		return false;

	}

}

async function remove() {

	for ( const registration of await workers.getRegistrations() ) await registration.unregister();
	for ( const name of await caches.keys() ) if ( name.startsWith( 'dirtbound-assets-' ) ) await caches.delete( name );
	log( 'asset cache removed (localStorage "dirtbound.nocache" is 1): every file comes from the network' );

}

function stats() {

	return new Promise( ( resolve ) => {

		const timer = setTimeout( () => resolve( null ), 2000 );
		workers.addEventListener( 'message', function answer( e ) {

			if ( e.data?.t !== 'stats' ) return;
			workers.removeEventListener( 'message', answer );
			clearTimeout( timer );
			resolve( e.data );

		} );
		workers.controller.postMessage( { t: 'stats' } );

	} );

}

async function report() {

	if ( ! workers.controller ) return log( 'this page was loaded without the asset cache (first visit, or a hard reload that bypasses it): the next pages will use it' );
	const s = await stats();
	if ( ! s ) return log.warn( 'the asset cache did not answer' );
	if ( s.foreign ) return log( `this page belongs to a newer build than the asset cache (${ s.build }): files come from the network until the new cache takes over` );
	log( `asset cache build ${ s.build }: ${ s.hits } file(s) served without asking the server, ${ s.stored } downloaded and kept, ${ s.network } from the network` );

}

if ( workers && secure ) {

	if ( disabled() ) remove();
	else {

		const controlled = !! workers.controller;
		workers.register( '/sw.js', { scope: '/', updateViaCache: 'none' } ).then(
			( registration ) => log( registration.active ? 'asset cache active' : 'asset cache installing: files are kept from the next requests on' ),
			( error ) => log.warn( `asset cache unavailable: ${ error.message }` ),
		);

		// Not served by the worker from the start (first visit): it keeps what this page loaded meanwhile
		if ( ! controlled ) addEventListener( 'load', () => setTimeout( async () => {

			const worker = ( await workers.ready ).active;
			const urls = performance.getEntriesByType( 'resource' ).map( ( e ) => e.name );
			workers.addEventListener( 'message', ( e ) => { if ( e.data?.t === 'warmed' ) log( `asset cache: ${ e.data.kept } file(s) this page loaded before the cache took over are now kept too` ); } );
			worker?.postMessage( { t: 'warm', urls } );

		}, 3000 ) );
		if ( log.enabled ) addEventListener( 'load', () => setTimeout( report, 4000 ) );

	}

} else log( `no asset cache: ${ workers ? 'needs HTTPS' : 'service workers unavailable in this browser' }` );
