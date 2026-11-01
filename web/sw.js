// Asset cache (registered by js/AssetCache.js). The server writes its asset list
// in place of the marker below: { build, assets: { path: [ ETags ] } }.
// Without it, every page load asked the server again for each of its ~200 files
// (304s, one round trip each); now a file is served from here until its ETag
// changes. Pages, the API, the lobby socket and streamed music always go to the
// network. A new build installs a new worker, which keeps the unchanged files.

const MANIFEST = /*__MANIFEST__*/null;
const PREFIX = 'dirtbound-assets-';
const CACHE = PREFIX + MANIFEST.build;
const TAG = 'x-asset-etag'; // the ETag a cached copy was checked against

// Pages of another build than this worker's (a deploy it does not know yet): network only
const foreign = new Set();
const stats = new Map(); // clientId → { hits, stored, network }

const count = ( clientId, key ) => {

	if ( ! clientId ) return;
	const s = stats.get( clientId ) || { hits: 0, stored: 0, network: 0 };
	s[ key ] ++;
	stats.set( clientId, s );

};

self.addEventListener( 'install', () => self.skipWaiting() );

self.addEventListener( 'activate', ( event ) => event.waitUntil( ( async () => {

	// Files whose ETag did not change move from the previous builds' caches
	const fresh = await caches.open( CACHE );
	for ( const name of await caches.keys() ) {

		if ( ! name.startsWith( PREFIX ) || name === CACHE ) continue;
		const old = await caches.open( name );
		for ( const request of await old.keys() ) {

			const response = await old.match( request );
			const tags = MANIFEST.assets[ new URL( request.url ).pathname.slice( 1 ) ];
			if ( response && tags?.includes( response.headers.get( TAG ) ) && ! await fresh.match( request ) ) await fresh.put( request, response );

		}

		await caches.delete( name );

	}

	await self.clients.claim();

} )() ) );

async function stamped( response, etag ) {

	// A copy with the checked ETag in a header of its own (Response headers are
	// immutable); its body is already decoded, so no gzip headers
	const headers = new Headers( response.headers );
	headers.delete( 'content-encoding' );
	headers.delete( 'content-length' );
	headers.set( TAG, etag );
	return new Response( await response.blob(), { status: response.status, statusText: response.statusText, headers } );

}

async function asset( event, key, tags ) {

	const cache = await caches.open( CACHE );
	const cached = await cache.match( key );
	if ( cached ) {

		count( event.clientId, 'hits' );
		return cached;

	}

	const response = await fetch( event.request );
	const etag = response.headers.get( 'etag' );
	if ( response.status === 200 && tags.includes( etag ) ) {

		count( event.clientId, 'stored' );
		event.waitUntil( stamped( response.clone(), etag ).then( ( copy ) => cache.put( key, copy ) ) );

	} else count( event.clientId, 'network' );

	return response;

}

self.addEventListener( 'fetch', ( event ) => {

	const request = event.request;
	if ( request.method !== 'GET' ) return;
	const url = new URL( request.url );
	if ( url.origin !== self.location.origin ) return;

	if ( request.mode === 'navigate' ) {

		// The page says which build it belongs to
		event.respondWith( fetch( request ).then( ( response ) => {

			const build = response.headers.get( 'x-build' );
			if ( build && build !== MANIFEST.build && event.resultingClientId ) foreign.add( event.resultingClientId );
			return response;

		} ) );
		return;

	}

	const tags = MANIFEST.assets[ decodeURIComponent( url.pathname.slice( 1 ) ) ];
	if ( ! tags || url.search || request.headers.has( 'range' ) || request.destination === 'audio' || request.destination === 'video' ) return;
	if ( foreign.has( event.clientId ) ) return count( event.clientId, 'network' );
	event.respondWith( asset( event, url.origin + url.pathname, tags ) );

} );

// Files a page loaded before this worker controlled it (first visit): kept in the background
async function warm( urls ) {

	const cache = await caches.open( CACHE );
	const queue = [ ...new Set( urls ) ].map( ( href ) => new URL( href ) ).filter( ( url ) => url.origin === self.location.origin && ! url.search );
	let kept = 0;
	const next = async () => {

		for ( let url = queue.shift(); url; url = queue.shift() ) {

			const tags = MANIFEST.assets[ decodeURIComponent( url.pathname.slice( 1 ) ) ];
			const key = url.origin + url.pathname;
			if ( ! tags || url.pathname.startsWith( '/audio/music/' ) || await cache.match( key ) ) continue;
			try {

				const response = await fetch( key );
				const etag = response.headers.get( 'etag' );
				if ( response.status === 200 && tags.includes( etag ) ) {

					await cache.put( key, await stamped( response, etag ) );
					kept ++;

				}

			} catch {}

		}

	};

	await Promise.all( [ next(), next(), next(), next() ] );
	return kept;

}

self.addEventListener( 'message', ( event ) => {

	if ( event.data?.t === 'warm' && Array.isArray( event.data.urls ) ) {

		event.waitUntil( warm( event.data.urls ).then( ( kept ) => event.source?.postMessage( { t: 'warmed', kept } ) ) );
		return;

	}

	if ( event.data?.t !== 'stats' ) return;
	const clientId = event.source?.id;
	event.source?.postMessage( { t: 'stats', build: MANIFEST.build, foreign: foreign.has( clientId ), ...( stats.get( clientId ) || { hits: 0, stored: 0, network: 0 } ) } );

} );
