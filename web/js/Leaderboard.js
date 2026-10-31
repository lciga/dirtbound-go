// Online circuit leaderboard (server/ in this repo, served under /api/).
// The player is the Google account of the session cookie (Account.js): the
// server knows who posts without anything kept in localStorage. Network
// failures never break the game: every call resolves to { ok: false, error }
// instead of throwing.

import { t, serverText } from './i18n.js';
import { dailySeed } from './DailyChallenge.js';

const API = 'api';
const TIMEOUT = 8000; // ms

// Same rule as the server (server/lib/submission.mjs), for instant feedback
export function isValidName( name ) {

	return /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,19}$/u.test( name );

}

export async function sha256( text ) {

	const digest = await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( text ) );
	return Array.from( new Uint8Array( digest ), ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}

// The leaderboard id of today's daily challenge (server/lib/lapcheck.mjs computes the same hash)
export function dailyBoardId( date ) {

	return sha256( dailySeed( date ) );

}

// Leaderboard id of a circuit: the Kenney circuit, or a hash of the editor
// track the URL carries (#track= spline, #map= old grid editor)
export function circuitId( { track = null, map = null } = {} ) {

	if ( track ) return sha256( 'spline.' + track );
	if ( map ) return sha256( 'map.' + map );
	return Promise.resolve( 'default' );

}

export async function request( path, options = {} ) {

	const controller = new AbortController();
	const timer = setTimeout( () => controller.abort(), TIMEOUT );

	try {

		const res = await fetch( `${ API }/${ path }`, { ...options, signal: controller.signal } );
		const body = await res.json().catch( () => null );
		if ( ! body ) return { ok: false, status: res.status, error: t( 'errors.boardUnreachable' ) };
		return body.success ? { ok: true, data: body.data } : { ok: false, status: res.status, error: serverText( body.error ) }; // the server writes French

	} catch {

		return { ok: false, status: 0, error: t( 'errors.boardUnreachable' ) };

	} finally {

		clearTimeout( timer );

	}

}

export function fetchLeaderboard( id ) {

	return request( `tracks/${ id }/leaderboard` );

}

// Resolves to { ok, data: { players } }: players active on the site right now
export function fetchOnline() {

	return request( 'online' );

}

// Resolves to { ok, data: { name, time, car, color, ghost } }, status 404 when there is no record yet
export function fetchRecordGhost( id ) {

	return request( `tracks/${ id }/ghost` );

}

// Circuits with a computed best lap in ghosts/tas-<id>.json: add the id here
// when a new one is generated (others are not even requested, no 404)
export const TAS_CIRCUITS = new Set( [
	'default',
	'8c9a9daf0a18b1c3f2be1901689b35d1955ad365fc2114d7cb5025fba457a363', // Tarte à rivière (17,642 s)
	'576bc747bd5bbd9cbed073245d3edff219eb11e2bfe0398fbc9507acda9d4e8b', // Olufsen (17,617 s)
	'920a9bf5f0b4814b2b6157bc757e9bc897800e33a232bffa426cb7f842907d1c', // Chantier publique (35,217 s)
] );

// Best lap computed offline for a circuit (ghosts/tas-<id>.json, the Kenney
// circuit, Tarte à rivière and Olufsen for now); resolves to { ok: false } when there is none
export async function fetchTasGhost( id ) {

	if ( ! TAS_CIRCUITS.has( id ) ) return { ok: false, status: 404 };

	try {

		const res = await fetch( `ghosts/tas-${ id }.json` );
		return res.ok ? { ok: true, data: await res.json() } : { ok: false, status: res.status };

	} catch {

		return { ok: false, status: 0 };

	}

}

// A finished lap that is not a personal best: kept in the server's private archive (with its keys), never on the board
export function archiveLap( id, { time, car, color, ghost, track = null, map = null } ) {

	return request( `tracks/${ id }/archive`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { time, car, color, ghost, ...( track ? { track } : {} ), ...( map ? { map } : {} ) } ),
	} );

}

// track / map: the circuit as in the URL (the server replays the ghost on it;
// it already knows the Kenney circuit and the published ones)
// seed / landscape / length: the daily challenge on a rally stage, so the
// server can check it is really today's exact one (lapcheck.mjs isDailyRally)
export function submitLap( id, { time, car, color, ghost, track = null, map = null, seed = null, landscape = null, length = null } ) {

	return request( `tracks/${ id }/laps`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { time, car, color, ghost, ...( track ? { track } : {} ), ...( map ? { map } : {} ),
			...( seed !== null ? { seed, landscape, length } : {} ) } ),
	} );

}
