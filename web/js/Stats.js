// Anonymous audience measurement (server/lib/stats.mjs): a page seen, a race
// started or finished, a lap, a minute played. No cookie: the server tells
// visitors of the same day apart by a salted hash it forgets at midnight.
// For the day+1/+7/+30 return rate only, a 'view' also carries a random id
// kept in localStorage (never a cookie, nothing else is in it): the server
// hashes it with its own secret before ever storing it, and forgets it 30
// days after it first saw it. Off entirely when the browser asks not to be
// tracked (Do Not Track, Global Privacy Control) and for the trailer's captures.

import { lang } from './i18n.js';
import { loadSettings } from './Settings.js';

const ENDPOINT = '/api/stats';
const BEAT = 60000; // ms: one minute played, counted while the page is in front
const VID_KEY = 'dirtbound.vid';

// Outside a browser (the server's lap checks import LapTimer) it does nothing
const off = typeof window === 'undefined' || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true
	|| /[?&]capture\b/.test( location.search );

function send( event ) {

	if ( off ) return;
	const body = new Blob( [ JSON.stringify( event ) ], { type: 'application/json' } );
	if ( ! navigator.sendBeacon?.( ENDPOINT, body ) ) fetch( ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } } ).catch( () => {} );

}

// null in private browsing / storage blocked: that visit just isn't counted
// for the return rate, everything else about it is tracked as normal
function visitorId() {

	try {

		let id = localStorage.getItem( VID_KEY );
		if ( ! id ) {

			id = crypto.randomUUID ? crypto.randomUUID() : Array.from( crypto.getRandomValues( new Uint8Array( 16 ) ), ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			localStorage.setItem( VID_KEY, id );

		}
		return id;

	} catch {

		return null;

	}

}

let beating = false;

// Once per page: page = 'menu' | 'play' | 'editor' | 'privacy'
export function trackView( page ) {

	if ( off ) return;
	let ref = '';
	try {

		const from = document.referrer ? new URL( document.referrer ).hostname : '';
		if ( from && from !== location.hostname ) ref = from.toLowerCase().slice( 0, 80 );

	} catch { /* no referrer */ }

	send( { e: 'view', page, lang, ref, screen: `${ screen.width }x${ screen.height }`, vid: visitorId() } );

	if ( beating ) return;
	beating = true;
	setInterval( () => {

		if ( document.visibilityState === 'visible' && document.hasFocus() ) send( { e: 'beat' } );

	}, BEAT );

}

// mode: 'official' | 'community' | 'drawn' | 'rally' | 'multi' | 'bonus' | 'daily' | 'test'
export function trackRace( mode ) {

	send( { e: 'race', mode, graphics: loadSettings().graphics } );

}

export function trackFinish( mode ) {

	send( { e: 'finish', mode } );

}

export function trackLap() {

	send( { e: 'lap' } );

}
