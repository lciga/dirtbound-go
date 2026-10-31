// Multiplayer constants shared by the game (js/multi, js/menu) and the lobby
// server (server/lib/lobby), like GhostCodec.js is for the leaderboard.

import { t } from '../i18n.js'; // choiceLabel (French on the server)

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export const CODE_LENGTH = 5;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_LOBBIES = 2000; // 2026-10-15: was 20 (the public launch must not stop at 160 players); a lobby is a few kB
export const LAPS = Object.freeze( { min: 1, max: 10 } );
export const STAGE_M = Object.freeze( { min: 1000, max: 10000, step: 1000 } );
export const DEFAULT_SETTINGS = Object.freeze( { laps: 3, length: 3000, collisions: false, landscape: 'varied', camera: 'iso' } ); // landscape: RallyBiomes.js LANDSCAPE_IDS; camera: CAMERAS
// The view of a race: from above only, third person only, or each racer's choice (key C)
export const CAMERAS = Object.freeze( [ 'iso', 'chase', 'both' ] );
export const VOTE_KINDS = Object.freeze( [ 'official', 'circuit', 'rally', 'loop' ] );
export const OFFICIAL_CIRCUITS = Object.freeze( { default: 'Circuit Kenney' } );
// Published circuits promoted to official (menu tab Officiel, lobby vote's
// Officiel section): still played, voted and ranked as the published circuit
export const OFFICIAL_PUBLISHED = Object.freeze( [
	Object.freeze( { id: '8c9a9daf0a18b1c3f2be1901689b35d1955ad365fc2114d7cb5025fba457a363', name: 'Tarte à rivière' } ),
	Object.freeze( { id: '576bc747bd5bbd9cbed073245d3edff219eb11e2bfe0398fbc9507acda9d4e8b', name: 'Olufsen' } ),
	Object.freeze( { id: '920a9bf5f0b4814b2b6157bc757e9bc897800e33a232bffa426cb7f842907d1c', name: 'Chantier publique' } ),
	Object.freeze( { id: 'b409aaff015e8d4f85f167765fbf2ab121c319ddc5f3addb103147de1b941ae4', name: "Circuit de Spa-Francorchamps" } ),
	Object.freeze( { id: '60503d1345e366fd7cb17d0daab6e2cd4667f1544c31b852df267efcbf58f8ba', name: "Monaco" } ),
	Object.freeze( { id: '0e117b17e58c3915fe7dcb1ba05034e9348c13b4d0899b1c40ff3918b51b2348', name: "Nürburgring - Nordschleife" } ),
	Object.freeze( { id: '889e4be0059c2b5b884a72cc35f43cd1727eb541fbf0ca24143770dc0a50361c', name: "Mountain Circuit" } ),
	Object.freeze( { id: '5c4b6f5ceecd8e1b468864e7b03596e43480df2ed451e20bb684dcd66ad031e8', name: "Drift Rally Track" } ),
	Object.freeze( { id: '1e3ed8c43a8e2af3c70bfe15073f6895fb4ed296370dd57fe72efa4367235264', name: "Bridges Meadow" } ),
] );
// Promoted circuits show in Officiel only, never again in Communauté (menu, lobby vote)
export const isOfficialPublished = ( id ) => OFFICIAL_PUBLISHED.some( ( o ) => o.id === id );
export const LOBBY_PATH = '/api/lobby';
// A car's state, 20 times a second: race time (s), position (m), orientation
// (quaternion), steering (rad), speed (m/s), progress (0 at the start, 1 at the finish)
export const STATE_FIELDS = Object.freeze( [ 'rt', 'x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'st', 'sp', 'p' ] );
export const STATES_PER_SECOND = 20;
export const LOOP_AVAILABLE = true; // vote kind 'loop' = « Circuit aléatoire »: the server draws one of the existing circuits when the vote closes (lobbies.mjs closeVote)
// Lobby modes: 'classic' (the races above) or 'bonus' (menu Expérimental:
// circuits only, item boxes and rockets, js/bonus/)
export const LOBBY_MODES = Object.freeze( [ 'classic', 'bonus' ] );
// Public lobbies are listed in the menu's grid (with their name); private ones join by code only
export const VISIBILITIES = Object.freeze( [ 'public', 'private' ] );
export const LOBBY_NAME = /^[\p{L}\p{N} .,'!?&#()+-]{1,24}$/u;
// "  Salon   de   Max " → "Salon de Max"
export const cleanLobbyName = ( raw ) => typeof raw === 'string' ? raw.trim().replace( /\s+/g, ' ' ) : '';
export const BONUS_VOTE_KINDS = Object.freeze( [ 'official', 'circuit' ] );
export const WARP_MAX = 80; // m: the longest jump a rift (turbo level 3) may declare
export const WARP_ROAD = 60; // m of road a rift carries the car along (the jump in a straight line is shorter in bends)
export const BONUS_LEVELS = 3; // a bonus picked again climbs a level, up to 3
export const BONUS_KINDS = Object.freeze( [ 'rocket', 'lightning', 'boost' ] ); // what a box can give (a shot's `kind`)
export const FIRE_COOLDOWN = 0.5; // s between two shots of one racer (server)
// A rocket's id: shooter id . shot number . rocket of that shot
export const ROCKET_ID = /^[a-z0-9]{6,24}\.\d{1,6}\.\d$/;
export const rocketId = ( from, shot, i ) => `${ from }.${ shot }.${ i }`;

const CODE = new RegExp( `^[${ CODE_ALPHABET }]{${ CODE_LENGTH }}$` );

export function isCode( s ) {

	return typeof s === 'string' && CODE.test( s );

}

// What people type: "k7q-wx", " K7 QWX " → "K7QWX"
export function normalizeCode( raw ) {

	return typeof raw === 'string' ? raw.toUpperCase().replace( /[\s-]/g, '' ) : '';

}

// One key per distinct choice, used to count votes
export function choiceKey( choice ) {

	return choice.kind === 'official' || choice.kind === 'circuit' ? `${ choice.kind }:${ choice.id }` : choice.kind;

}

export function choiceLabel( choice ) {

	if ( choice.kind === 'official' ) return choice.id === 'default' ? t( 'circuits.kenney' ) : OFFICIAL_CIRCUITS[ choice.id ] || t( 'circuits.official' );
	if ( choice.kind === 'circuit' ) return choice.name || t( 'circuits.community' );
	if ( choice.kind === 'rally' ) return t( 'vote.rally' );
	return t( 'vote.loop' );

}
