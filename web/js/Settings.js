// Player preferences shared by the menu and the game, kept in localStorage.
// Reads never throw (private mode, blocked storage): defaults are returned.

import { purgeBoostedBests } from './BoostPurge.js';
import { landscapeOf } from './RallyBiomes.js';

// Before any best time is read, by the menu or the game (once per browser)
purgeBoostedBests();

const KEY = 'racing.settings';

// Key bindings: action → [ primary, secondary ] KeyboardEvent.code (null = none).
// Escape always pauses, whatever `pause` holds.
export const DEFAULT_KEYS = {
	accelerate: [ 'KeyW', 'ArrowUp' ],
	brake: [ 'KeyS', 'ArrowDown' ],
	left: [ 'KeyA', 'ArrowLeft' ],
	right: [ 'KeyD', 'ArrowRight' ],
	handbrake: [ 'Space', null ],
	pause: [ 'KeyP', null ],
	reset: [ 'KeyR', null ], // rally: back on the road (time penalty)
	restart: [ 'KeyR', null ], // circuits: back 5 s before the line (FlyingStart.js); R is the reset on stages only
	fire: [ 'KeyE', 'Enter' ], // bonus races (menu Expérimental): use the bonus held
	camera: [ 'KeyC', null ], // the view: from above (iso) / behind the car (chase); pad Y
};

export const GRAPHICS = [ 'low', 'normal', 'ultra' ];

export const DEFAULT_SETTINGS = {
	car: 'Audi Quattro S1', // 'truck' or a RALLY_CARS name
	color: 1, // livery 1-5 (trucks: 1-4)
	graphics: 'normal', // preset: 'low' (the old performance mode), 'normal', 'ultra'
	performance: false, // = graphics 'low' (kept in sync by loadSettings): no trees/props, shadows, bloom, antialiasing, smoke; low-latency canvas
	view: 'iso', // Camera.js VIEWS: 'iso' (from above) or 'chase' (third person, Trackmania style)
	ghost: 'off', // circuits: see-through car of 'record' (online best lap) or 'tas' (computed best, Kenney circuit), or 'off'
	music: true, // menu music (starts with the first click or key)
	raceMusic: false, // the same track during races
	volume: { engine: 1, tyres: 1, music: 1 }, // 0..1, on top of the mix
	dof: { on: true, strength: 50 }, // Ultra depth of field on the car, strength 0..100
	keys: DEFAULT_KEYS,
	rally: {
		length: 5000, // m, 0 = endless
		landscape: 'varied', // RallyBiomes.js LANDSCAPE_IDS
		season: 'summer', // Seasons.js: summer, spring, autumn, winter
	},
};

// The rally part of stored settings, older saves included (their `style` is dropped)
export function rallySettings( stored = {} ) {

	const { style: _style, ...rest } = stored || {};
	return { ...DEFAULT_SETTINGS.rally, ...rest, landscape: landscapeOf( rest.landscape ) };

}

export function loadSettings() {

	let stored = {};

	try {

		stored = JSON.parse( localStorage.getItem( KEY ) ) || {};

	} catch {}

	// The graphics preset wins; older saves only had the performance flag
	const graphics = GRAPHICS.includes( stored.graphics ) ? stored.graphics : stored.performance ? 'low' : 'normal';
	const keys = {};
	for ( const action in DEFAULT_KEYS ) keys[ action ] = Array.isArray( stored.keys?.[ action ] ) ? stored.keys[ action ].slice( 0, 2 ) : [ ...DEFAULT_KEYS[ action ] ];
	// The restart key was Retour arrière for a morning (2026-10-14): saved as such, it becomes R
	if ( keys.restart[ 0 ] === 'Backspace' && keys.restart[ 1 ] === null ) keys.restart = [ ...DEFAULT_KEYS.restart ];

	return {
		...DEFAULT_SETTINGS,
		...stored,
		view: stored.view === 'chase' ? 'chase' : 'iso',
		graphics,
		performance: graphics === 'low',
		volume: { ...DEFAULT_SETTINGS.volume, ...stored.volume },
		dof: { ...DEFAULT_SETTINGS.dof, ...stored.dof },
		keys,
		rally: rallySettings( stored.rally ),
	};

}

export function saveSettings( settings ) {

	try {

		localStorage.setItem( KEY, JSON.stringify( settings ) );

	} catch {}

}

// First rally stage ever on this browser: softer defaults (Menu.js), so a
// brand-new visitor's first impression isn't a 5 km technical stage
const RALLY_PLAYED_KEY = 'racing.rallyPlayed';

export function hasPlayedRally() {

	try {

		return localStorage.getItem( RALLY_PLAYED_KEY ) === '1';

	} catch {

		return true; // unknown: don't soften (private mode, storage blocked)

	}

}

export function markRallyPlayed() {

	try {

		localStorage.setItem( RALLY_PLAYED_KEY, '1' );

	} catch {}

}

// Best times kept on this device until the public leaderboard exists
export function loadBest( key ) {

	try {

		const v = Number( localStorage.getItem( key ) );
		return v > 0 ? v : null;

	} catch {

		return null;

	}

}

export function saveBest( key, time ) {

	const best = loadBest( key );
	if ( best !== null && best <= time ) return false;

	try {

		localStorage.setItem( key, String( time ) );

	} catch {}

	return true;

}

export function formatTime( t ) {

	if ( t === null || t === undefined ) return '–:––.–––';
	// Whole milliseconds first, so 59.9996 s shows 1:00.000, not 0:60.000
	const ms = Math.round( t * 1000 );
	const m = Math.floor( ms / 60000 );
	return `${ m }:${ ( ( ms - m * 60000 ) / 1000 ).toFixed( 3 ).padStart( 6, '0' ) }`;

}
