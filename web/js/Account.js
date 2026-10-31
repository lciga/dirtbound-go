// The player's account: Google through Better Auth (server/lib/auth.mjs).
// The session is an HttpOnly cookie of this site, so every same-origin fetch
// carries it; nothing about the account is kept in localStorage. Network
// failures never break the game: calls resolve to null / { ok: false }.

import { t, serverText } from './i18n.js';

const ERRORS = { access_denied: 'account.cancelled', EMAIL_NOT_VERIFIED: 'account.unverified' };

let cached;

async function api( path, options = {} ) {

	try {

		const res = await fetch( path, options );
		const body = await res.json().catch( () => null );
		if ( res.ok && body?.success !== false ) return { ok: true, status: res.status, data: body?.data ?? body };
		return { ok: false, status: res.status, error: serverText( body?.error || body?.message ) || t( 'errors.server' ) }; // the server writes French

	} catch {

		return { ok: false, status: 0, error: t( 'errors.unreachable' ) };

	}

}

// { id, pseudo } when signed in, null when signed out (401), or
// { id: null, pseudo: null, error } when the server cannot tell (asked again next time)
export async function getAccount( { refresh = false } = {} ) {

	if ( cached === undefined || refresh ) {

		const r = await api( 'api/me' );
		if ( ! r.ok && r.status !== 401 ) {

			cached = undefined;
			return { id: null, pseudo: null, error: r.error };

		}

		cached = r.ok ? { id: r.data.id, pseudo: r.data.pseudo } : null;

	}

	return cached;

}

// Off to Google, back on this page (or the menu with ?error= if it fails)
export async function signIn({location = window.location} = {}) {
 const next = location.pathname + location.search + location.hash;
 location.href = 'login.html?next=' + encodeURIComponent(next);
 return {ok: true};
}

export async function signOut() {

	await api( 'api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } );
	cached = null;

}

export async function setPseudo( pseudo ) {

	const r = await api( 'api/me/pseudo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { pseudo } ) } );
	if ( r.ok && cached ) cached = { ...cached, pseudo: r.data.pseudo };
	return r;

}

// Better Auth comes back to errorCallbackURL with ?error=<code>
export function authErrorText( search ) {

	const code = new URLSearchParams( search ).get( 'error' );
	if ( ! code ) return null;
	return t( ERRORS[ code ] || 'account.signInFailed' );

}

// The pseudo + token of the old leaderboard (racing.player) means nothing now
export function forgetOldPlayer( storage = globalThis.localStorage ) {

	try {

		storage?.removeItem( 'racing.player' );

	} catch {}

}
