import { request } from './Leaderboard.js';
import { t } from './i18n.js';

// Circuits made in the editor: a library on this device ("Mes circuits") and
// the public catalogue on the server (server/lib/circuits.mjs), where anyone
// can star them. A circuit is its encoded track (SplineTrack encodeTrack);
// once published its id is the same as its leaderboard id.

const LIBRARY_KEY = 'dirtbound.circuits';
const OLD_DRAFT_KEY = 'racing-editor-track'; // the editor's single autosave before the library

// ─── Library (localStorage) ───────────────────────────────
// [ { id, name, data, updated, published } ] — id is local, `published` the
// server id once published (null before)

function read() {

	try {

		const list = JSON.parse( localStorage.getItem( LIBRARY_KEY ) );
		if ( Array.isArray( list ) ) return list;

	} catch {}

	return null;

}

function write( list ) {

	try {

		localStorage.setItem( LIBRARY_KEY, JSON.stringify( list ) );
		return true;

	} catch {

		return false; // full or blocked storage

	}

}

export function newLocalId() {

	return 'c' + Date.now().toString( 36 ) + Math.random().toString( 36 ).slice( 2, 6 );

}

// Newest first. The first call adopts the old editor autosave as "Mon circuit".
export function listLocal() {

	let list = read();

	if ( list === null ) {

		list = [];
		let draft = null;

		try {

			draft = localStorage.getItem( OLD_DRAFT_KEY );

		} catch {}

		if ( draft ) list.push( { id: newLocalId(), name: t( 'circuits.myCircuit' ), data: draft, updated: Date.now(), published: null } );
		write( list );

	}

	return [ ...list ].sort( ( a, b ) => b.updated - a.updated );

}

export function getLocal( id ) {

	return listLocal().find( ( c ) => c.id === id ) || null;

}

// Inserts or replaces by id; returns false if the browser refused to store it
export function saveLocal( entry ) {

	const list = listLocal().filter( ( c ) => c.id !== entry.id );
	return write( [ { ...entry, updated: Date.now() }, ...list ] );

}

export function deleteLocal( id ) {

	write( listLocal().filter( ( c ) => c.id !== id ) );

}

// ─── Public catalogue (server) ────────────────────────────
// Every call resolves to { ok, data } or { ok: false, status, error }.

// The account is the session cookie (Account.js): no player argument

export function listPublished() {

	return request( 'circuits' );

}

export function fetchPublished( id ) {

	return request( `circuits/${ id }` );

}

// replaces: the id of my published circuit this new version takes over
// (same entry in the list, stars kept), or null for a new circuit
export function publishCircuit( name, data, replaces = null ) {

	return request( 'circuits', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( replaces ? { name, data, replaces } : { name, data } ),
	} );

}

export function toggleStar( id ) {

	return request( `circuits/${ id }/star`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: '{}',
	} );

}

export function unpublishCircuit( id ) {

	return request( `circuits/${ id }`, { method: 'DELETE' } );

}
