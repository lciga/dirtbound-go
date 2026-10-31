// play.html?lobby=<code>: the race of a multiplayer lobby. Joins the lobby
// again (the Google account of the session cookie), turns the chosen race into the
// URL parameters the game already understands, and gives the road behind the
// start line for the starting grid.

import { LobbyClient, lobbyUrl } from './LobbyClient.js';
import { RALLY_GRID_S } from './StartGrid.js';
import { computeSpawnPosition, TRACK_CELLS } from '../Track.js';
import { roadPieces } from '../SplineTrack.js';
import { t } from '../i18n.js';

export function joinLobbyRace( { timeoutMs = 10000 } = {} ) {

	const client = new LobbyClient( { url: lobbyUrl( location ) } );

	return new Promise( ( resolve, reject ) => {

		const fail = ( message ) => {

			clearTimeout( timer );
			client.close();
			reject( new Error( message ) );

		};

		const timer = setTimeout( () => fail( t( 'lobby.unreachable' ) ), timeoutMs );
		const onLeft = ( e ) => fail( e.detail.reason );
		const onStatus = () => { if ( client.status === 'idle' ) fail( t( 'lobby.gone' ) ); };
		// After joining, RaceSync takes over these events
		const detach = () => {

			client.removeEventListener( 'lobby', onLobby );
			client.removeEventListener( 'left', onLeft );
			client.removeEventListener( 'status', onStatus );

		};

		const onLobby = ( e ) => {

			const { lobby, you } = e.detail;
			const slot = lobby.race ? lobby.race.grid.findIndex( ( g ) => g.id === you ) : - 1;

			if ( ( lobby.state === 'loading' || lobby.state === 'racing' ) && slot >= 0 ) {

				clearTimeout( timer );
				detach();
				resolve( { client, lobby, you, race: lobby.race, slot } );

			} else if ( lobby.state !== 'loading' && lobby.state !== 'racing' ) fail( t( 'race.noRace' ) );
			else fail( t( 'race.leftWithout' ) );

		};

		client.addEventListener( 'lobby', onLobby );
		client.addEventListener( 'left', onLeft );
		client.addEventListener( 'status', onStatus );
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
