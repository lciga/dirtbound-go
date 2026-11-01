// play.html?lobby=<code>: the race of a multiplayer lobby. Joins the lobby
// again (the Google account of the session cookie), turns the chosen race into the
// URL parameters the game already understands, and gives the road behind the
// start line for the starting grid.

import { LobbyClient, lobbyUrl } from './LobbyClient.js';
import { RALLY_GRID_S } from './StartGrid.js';
import { computeSpawnPosition, TRACK_CELLS } from '../Track.js';
import { roadPieces } from '../SplineTrack.js';
import { t } from '../i18n.js';
import { YARIS_CAR } from '../YarisMode.js';
import { debugLog } from '../DebugLog.js';

const log = debugLog( 'lobby' );

export function joinLobbyRace( { timeoutMs = 15000 } = {} ) {

	const client = new LobbyClient( { url: lobbyUrl( location ) } );

	return new Promise( ( resolve, reject ) => {

		let done = false;
		// The first reason wins: close() below would otherwise report 'idle' as "gone"
		const fail = ( message, why ) => {

			if ( done ) return;
			done = true;
			log.warn( `race page: cannot join the lobby race: ${ why }` );
			clearTimeout( timer );
			client.close();
			reject( new Error( message ) );

		};

		const timer = setTimeout( () => fail( t( 'lobby.unreachable' ), `no lobby received within ${ timeoutMs / 1000 } s (socket status: ${ client.status })` ), timeoutMs );
		const onLeft = ( e ) => fail( e.detail.reason, `the server says we left the lobby (${ e.detail.reason || 'no reason' })` );
		const onStatus = () => { if ( client.status === 'idle' ) fail( t( 'lobby.gone' ), 'the server has no lobby for this account any more' ); };
		const onError = ( e ) => { if ( client.status === 'lost' ) fail( e.detail.message, `connection given up: ${ e.detail.message }` ); };
		// After joining, RaceSync takes over these events
		const detach = () => {

			client.removeEventListener( 'lobby', onLobby );
			client.removeEventListener( 'left', onLeft );
			client.removeEventListener( 'status', onStatus );
			client.removeEventListener( 'error', onError );

		};

		const onLobby = ( e ) => {

			const { lobby, you } = e.detail;
			const slot = lobby.race ? lobby.race.grid.findIndex( ( g ) => g.id === you ) : - 1;

			if ( ( lobby.state === 'loading' || lobby.state === 'racing' ) && slot >= 0 ) {

				done = true;
				log( `race page: joined lobby ${ lobby.code } (${ lobby.state }), grid slot ${ slot + 1 } of ${ lobby.race.grid.length }` );
				clearTimeout( timer );
				detach();
				resolve( { client, lobby, you, race: lobby.race, slot } );

			} else if ( lobby.state !== 'loading' && lobby.state !== 'racing' ) fail( t( 'race.noRace' ), `lobby ${ lobby.code } is ${ lobby.state }, not loading or racing` );
			else fail( t( 'race.leftWithout' ), `lobby ${ lobby.code } is ${ lobby.state } but this player is not on the grid` );

		};

		client.addEventListener( 'lobby', onLobby );
		client.addEventListener( 'left', onLeft );
		client.addEventListener( 'status', onStatus );
		client.addEventListener( 'error', onError );
		log( 'race page: reconnecting to the lobby' );
		client.resume();

	} );

}

export function raceParams( race, you ) {

	const me = race.grid.find( ( g ) => g.id === you );
	const params = new URLSearchParams();
	if ( race.kind === 'rally' ) {

		params.set( 'rally', race.seed );
		params.set( 'length', race.length );
		if ( race.landscape && race.landscape !== 'varied' ) params.set( 'landscape', race.landscape );

	} else if ( race.kind === 'circuit' ) params.set( 'circuit', race.id );

	if ( me && me.car ) params.set( 'car', me.car );
	if ( me ) params.set( 'color', me.color );
	if ( race.mode === 'yaris' ) {
		params.set( 'mode', 'yaris' );
		params.set( 'car', YARIS_CAR );
		params.set( 'color', '1' );
	}
	return params;

}

// ( d ) → the road d metres behind the start line: { x, y, z, tx, tz }
export function gridFrameFor( { path, customCells, stage } ) {

	if ( stage ) {

		// The back rows of a full grid stand before the stage start, on the
		// straight lead-in drawn behind it (RallyRoute LEAD_IN): the chunk's own
		// path stops at s = 0 (frameAt would stack them all there)
		const road = stage.chunks[ 0 ].path;

		return ( d ) => {

			const s = RALLY_GRID_S - d;
			if ( s >= 0 ) return road.frameAt( s );
			const f = road.frameAt( 0 );
			return { ...f, x: f.x + f.tx * s, z: f.z + f.tz * s };

		};

	}

	if ( path ) {

		const finishS = roadPieces( path, path.closed ).finishS;
		return ( d ) => path.frameAt( finishS - d );

	}

	const { position, angle } = computeSpawnPosition( customCells || TRACK_CELLS );
	const tx = Math.sin( angle ), tz = Math.cos( angle );
	return ( d ) => ( { x: position[ 0 ] - tx * d, y: position[ 1 ] - 0.5, z: position[ 2 ] - tz * d, tx, tz } );

}
