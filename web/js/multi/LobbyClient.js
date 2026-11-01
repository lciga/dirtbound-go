// The game's side of the lobby WebSocket (internal/server/lobby.go).
// Keeps one connection, says hello (the account and its pseudo come from the
// session cookie, checked by the server once the socket is open), queues
// messages until the socket is open, reconnects on its own after a network
// drop (the server keeps the place 20 s) and remembers in sessionStorage that
// this tab is in a lobby, so the next page reconnects.

import { LOBBY_PATH, normalizeCode } from './Protocol.js';
import { t, serverText } from '../i18n.js';
import { debugLog } from '../DebugLog.js';

const log = debugLog( 'net' );

// Close codes (lobby.go): the server accepts every handshake and refuses
// afterwards, since Firefox slows down handshakes after HTTP errors
const CLOSE_OTHER_TAB = 4000;
const CLOSE_SIGN_IN = 4001;
const CLOSE_TRY_LATER = 1013;
const CLOSE_MEANING = {
	1000: 'normal close', 1001: 'page leaving or server shutting down', 1005: 'closed without a code',
	1006: 'connection dropped (network, proxy or server down)', 1008: 'policy violation (slow consumer)',
	[ CLOSE_TRY_LATER ]: 'server storage unavailable, retrying', [ CLOSE_OTHER_TAB ]: 'this account connected from another tab or page',
	[ CLOSE_SIGN_IN ]: 'not signed in, or no profile name',
};
const QUIET = new Set( [ 'ping', 'pong', 'state', 'states' ] ); // too frequent to log one by one

const IN_LOBBY_KEY = 'dirtbound.lobby';
const PINGS_AT_OPEN = 5; // quick pings to learn the server clock
const PING_GAP = 150; // ms between them
const PING_EVERY = 10000; // ms, afterwards
const OFFSETS_KEPT = 8;

export function lobbyUrl( location ) {

	const url = new URL( LOBBY_PATH.replace( /^\//, '' ), new URL( '.', location.href ) );
	url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.href;

}

function safe( fn, fallback = null ) {

	try {

		return fn();

	} catch {

		return fallback;

	}

}

export class LobbyClient extends EventTarget {

	static wasInLobby( storage = globalThis.sessionStorage ) {

		return safe( () => storage.getItem( IN_LOBBY_KEY ) === '1', false );

	}

	constructor( { url, storage = globalThis.sessionStorage, WebSocketImpl = globalThis.WebSocket, retryDelays = [ 500, 1000, 2000, 4000, 4000, 4000, 4000 ] } ) {

		super();
		this.url = url;
		this.storage = storage;
		this.WebSocketImpl = WebSocketImpl;
		this.retryDelays = retryDelays;
		this.socket = null;
		this.queue = [];
		this.retries = 0;
		this.retryTimer = null;
		this.closedByUser = false;
		this.resuming = false; // connected only to find a lobby again (menu load)
		this.lobby = null;
		this.you = null;
		this.status = 'idle';
		this.identified = false; // the server welcomed this socket
		this.offsets = [];
		this.offset = 0; // server clock - local clock, ms
		this.pingTimer = null;
		this.watching = null; // mode of the public lobbies listed (watch)
		this.lobbies = null; // the last list received

	}

	connect() {

		this.closedByUser = false;
		if ( this.socket ) return;

		this.setStatus( 'connecting' );
		const started = performance.now();
		log( `connecting to ${ this.url }` + ( this.queue.length ? ` (${ this.queue.length } message(s) waiting)` : '' ) );
		const socket = new this.WebSocketImpl( this.url );
		this.socket = socket;
		let opened = false;
		const slow = setTimeout( () => {

			if ( this.socket === socket && ! opened ) log.warn( 'still connecting after 5 s: the browser has not finished the handshake. Firefox delays handshakes (up to 60 s) after earlier failed ones; the request appears in DevTools only once it is sent' );

		}, 5000 );

		// A socket replaced by close() + connect() must not touch the new one
		socket.addEventListener( 'open', () => {

			clearTimeout( slow );
			if ( this.socket !== socket ) return;
			opened = true;
			log( `open after ${ Math.round( performance.now() - started ) } ms; saying hello` + ( this.queue.length ? `, then ${ this.queue.length } queued message(s)` : '' ) );
			this.setStatus( 'open' );
			this.identified = false;
			this.sendHello();
			for ( const msg of this.queue.splice( 0 ) ) socket.send( msg );
			this.startPings();

		} );

		socket.addEventListener( 'message', ( e ) => { if ( this.socket === socket ) this.receive( e.data ); } );
		socket.addEventListener( 'close', ( e ) => {

			clearTimeout( slow );
			if ( this.socket !== socket ) return;
			log( `closed ${ e.code } (${ CLOSE_MEANING[ e.code ] || 'unknown code' })${ e.reason ? ` "${ e.reason }"` : '' } after ${ Math.round( performance.now() - started ) } ms` + ( opened ? '' : ', before it opened' ) );
			this.onClose( e.code, opened );

		} );
		socket.addEventListener( 'error', () => {} ); // handled on close

	}

	// Menu load in a tab that was in a lobby: reconnect, and hang up if the lobby is gone
	resume() {

		this.resuming = true;
		this.asked = false;
		this.connect();

	}

	close() {

		if ( this.socket || this.status !== 'idle' ) log( 'closing the socket (no longer needed)' );
		this.closedByUser = true;
		clearTimeout( this.retryTimer );
		clearTimeout( this.pingTimer );
		this.socket?.close();
		this.socket = null;
		this.setStatus( 'idle' );

	}

	// After 'lost': a fresh series of attempts, asked by the player
	retry() {

		log( 'retry asked: new connection attempts' );
		this.retries = 0;
		this.connect();

	}

	// mode: 'bonus' for the menu Expérimental; visibility 'public' (with a name) or 'private'
	create( mode = 'classic', { visibility = 'private', name = '' } = {} ) { this.send( { t: 'create', mode, visibility, ...( visibility === 'public' ? { name } : {} ) } ); }

	// The menu's grid of public lobbies of a mode (null = stop); sent again after a reconnection
	watch( mode ) {

		this.watching = mode;
		this.lobbies = null;
		log( mode === null ? 'stop listing public lobbies' : `list the public ${ mode } lobbies` + ( this.identified && this.socket?.readyState === 1 ? '' : ' (sent once the server welcomes this socket)' ) );
		if ( mode === null ) return this.rawSend( { t: 'watch', mode: null } );
		this.asked = true;
		// Not welcomed yet: the welcome sends it (queued too, it would be listed twice)
		if ( this.identified && this.socket?.readyState === 1 ) this.rawSend( { t: 'watch', mode } );
		else this.connect();

	}

	join( code ) { this.send( { t: 'join', code: normalizeCode( code ) } ); }

	leave() { this.send( { t: 'leave' } ); }

	setReady( { car, color, ready } ) { this.send( { t: 'ready', car, color, ready } ); }

	setSettings( { laps, length, collisions, landscape, camera } ) { this.send( { t: 'settings', laps, length, collisions, landscape, camera } ); }

	kick( player ) { this.send( { t: 'kick', player } ); }

	startVote() { this.send( { t: 'startVote' } ); }

	vote( { kind, id } ) { this.send( id === undefined ? { t: 'vote', kind } : { t: 'vote', kind, id } ); }

	loaded() { this.send( { t: 'loaded' } ); }

	sendState( state ) { this.rawSend( { t: 'state', ...state } ); }

	// Bonus races (js/bonus/BonusRace.js)
	fire( shot ) { this.rawSend( { t: 'fire', ...shot } ); }

	hit( rocket ) { this.rawSend( { t: 'hit', rocket } ); }

	// at: { x, z } where the car crossed the finish (the server checks the course from the positions)
	finish( time, p, at ) { this.send( { t: 'finish', time, ...( p === undefined ? {} : { p } ), ...( at ? { x: at.x, z: at.z } : {} ) } ); }

	// Fresh quick pings, once the page is no longer busy (race loaded, start known)
	resync() {

		this.startPings();

	}

	// Server clock (ms), from the quickest of the last pings (NTP style: a slow
	// round trip, or a pong handled late by a busy page, biases its offset)
	serverNow() {

		return Date.now() + this.offset;

	}

	// ─── internals ───

	sendHello() {

		this.socket.send( JSON.stringify( { t: 'hello' } ) );

	}

	startPings() {

		clearTimeout( this.pingTimer );
		let sent = 0;
		const next = () => {

			this.rawSend( { t: 'ping', c: Date.now() } );
			sent += 1;
			this.pingTimer = setTimeout( next, sent < PINGS_AT_OPEN ? PING_GAP : PING_EVERY );

		};

		next();

	}

	onPong( { c, s } ) {

		if ( typeof c !== 'number' || typeof s !== 'number' ) return;
		const rtt = Date.now() - c;
		this.offsets = [ ...this.offsets.slice( - ( OFFSETS_KEPT - 1 ) ), { rtt, offset: s - ( c + rtt / 2 ) } ];
		this.offset = this.offsets.reduce( ( best, o ) => o.rtt < best.rtt ? o : best ).offset;
		if ( this.offsets.length === PINGS_AT_OPEN ) log( `clock synced: best round trip ${ Math.min( ...this.offsets.map( ( o ) => o.rtt ) ) } ms, server clock ${ Math.round( this.offset ) } ms from ours` );

	}

	// Protocol traffic that is not a player action (pings, states): dropped when
	// the socket is not open, and it does not count as "asked" for resume()
	rawSend( msg ) {

		if ( this.socket && this.socket.readyState === 1 ) this.socket.send( JSON.stringify( msg ) );

	}

	send( msg ) {

		this.asked = true; // the player did something: a resume must not hang up on it
		const text = JSON.stringify( msg );
		if ( ! QUIET.has( msg.t ) ) log( `send ${ msg.t }` + ( this.socket?.readyState === 1 ? '' : ' (queued until the socket opens)' ), msg );

		if ( this.socket && this.socket.readyState === 1 ) {

			// Not welcomed yet on this socket: say hello again first
			if ( ! this.identified ) this.sendHello();
			this.socket.send( text );

		}
		else {

			this.queue.push( text );
			this.connect();

		}

	}

	receive( data ) {

		const msg = safe( () => JSON.parse( data ) );
		if ( ! msg || typeof msg.t !== 'string' ) return;
		if ( ! QUIET.has( msg.t ) ) log( `received ${ msg.t }`, msg.t === 'lobby' ? { code: msg.lobby?.code, state: msg.lobby?.state, players: msg.lobby?.players?.length } : msg );

		if ( msg.t === 'lobby' ) {

			this.lobby = msg.lobby;
			this.you = msg.you;
			this.remember( true );
			this.emit( 'lobby', { lobby: msg.lobby, you: msg.you } );

		} else if ( msg.t === 'left' ) {

			this.lobby = null;
			this.you = null;
			this.remember( false );
			this.emit( 'left', { reason: serverText( msg.reason ) } ); // the server writes French

		} else if ( msg.t === 'error' ) this.emit( 'error', { message: serverText( msg.message ) } );
		else if ( msg.t === 'pong' ) this.onPong( msg );
		else if ( msg.t === 'states' && Array.isArray( msg.states ) ) this.emit( 'states', { states: msg.states } );
		else if ( msg.t === 'fire' || msg.t === 'hit' ) this.emit( msg.t, msg );
		else if ( msg.t === 'lobbies' && Array.isArray( msg.lobbies ) ) {

			if ( msg.mode !== this.watching ) return;
			this.lobbies = msg.lobbies;
			this.emit( 'lobbies', { lobbies: msg.lobbies } );

		}
		else if ( msg.t === 'welcome' ) {

			this.identified = true;
			this.retries = 0; // only a welcome proves the server took us (it may accept, then refuse)
			if ( this.watching !== null ) this.rawSend( { t: 'watch', mode: this.watching } );

			const resuming = this.resuming;
			this.resuming = false;
			if ( msg.player !== null ) return log( 'welcomed back into a lobby' );

			// The server no longer knows us (restart, timeout): the lobby is gone
			if ( this.lobby ) {

				log( 'the server has no lobby for us any more: it is gone' );
				this.lobby = null;
				this.you = null;
				this.remember( false );
				this.emit( 'left', { reason: t( 'lobby.gone' ) } );

			} else if ( resuming && ! this.asked ) {

				// Nothing to rejoin and nothing asked: don't hold one of the server's places
				log( 'nothing to rejoin: hanging up' );
				this.remember( false );
				this.close();

			}

		}

	}

	onClose( code, opened = true ) {

		this.socket = null;
		clearTimeout( this.pingTimer );
		if ( this.closedByUser ) return;

		if ( code === CLOSE_SIGN_IN ) {

			log( 'giving up: sign in (and choose a profile name) to play online' );
			this.setStatus( 'lost' );
			this.emit( 'error', { message: t( 'multi.signInToPlay' ) } );
			return;

		}

		// This account connected from another tab: don't fight over it
		if ( code === CLOSE_OTHER_TAB ) {

			log( 'giving up: another tab or page took over this account\'s connection' );
			this.setStatus( 'lost' );
			this.emit( 'error', { message: t( 'lobby.otherTab' ) } );
			return;

		}

		if ( this.retries >= this.retryDelays.length ) {

			log.warn( `giving up after ${ this.retries } attempts in a row` + ( opened ? '' : ' that never opened (server or proxy unreachable)' ) );
			this.setStatus( 'lost' );
			this.emit( 'error', { message: t( 'lobby.unreachable' ) } );
			return;

		}

		const delay = this.retryDelays[ this.retries ++ ];
		log( `reconnecting in ${ delay } ms (attempt ${ this.retries } of ${ this.retryDelays.length })` );
		this.setStatus( 'connecting' );
		this.retryTimer = setTimeout( () => this.connect(), delay );

	}

	remember( inLobby ) {

		safe( () => inLobby ? this.storage.setItem( IN_LOBBY_KEY, '1' ) : this.storage.removeItem( IN_LOBBY_KEY ) );

	}

	setStatus( status ) {

		if ( this.status === status ) return;
		log( `status ${ this.status } → ${ status }` );
		this.status = status;
		this.emit( 'status', { status } );

	}

	emit( type, detail ) {

		this.dispatchEvent( new CustomEvent( type, { detail } ) );

	}

}
