import { Showroom, SLIDE } from './Showroom.js';
import { setThemeSeason } from '../Theme.js';
import { GARAGE_CARS, findCar, TRUCK_COLORS } from '../Cars.js';
import { loadSettings, saveSettings, loadBest, formatTime, DEFAULT_KEYS, hasPlayedRally, markRallyPlayed } from '../Settings.js';
import { isValidName, circuitId, fetchLeaderboard, fetchOnline, dailyBoardId } from '../Leaderboard.js';
import { dailyChallenge } from '../DailyChallenge.js';
import { getAccount, signIn, signOut, setPseudo, authErrorText, forgetOldPlayer } from '../Account.js';
import { listLocal, listPublished, toggleStar } from '../Circuits.js';
import { splineThumb, gridThumb, mapThumb, rallyThumb } from './Thumbs.js';
import { LANDSCAPE_IDS, landscapeOf } from '../RallyBiomes.js';
import { ghostMode } from '../CircuitOnline.js';
import { MenuMusic } from './MenuMusic.js';
import { UiSounds } from './UiSounds.js';
import { Fx } from './Fx.js';
import { createMulti } from './MultiScreen.js';
import { OFFICIAL_PUBLISHED, isOfficialPublished } from '../multi/Protocol.js';
import { PageLoading, leavePage } from '../PageTransition.js';
import { GamepadUI } from '../Gamepad.js';
import { carSwatches } from './Swatches.js';
import { CarWheel } from './CarWheel.js';
import { fontsReady } from './Fonts.js';
import { t, list, translatePage } from '../i18n.js';
import { trackView } from '../Stats.js';

// Main menu (index.html). Each screen renders into #screen with its own
// layout — the home's choices written in the 3D scene (Walls.js), big mode
// cards (solo), a browser + detail card (circuits, rally), two scrolling
// lists (garage) — while the showroom keeps the selected car on display in
// the place that goes with the screen (PLACES): going to another place folds
// the scene away around the car and unfolds the next one. Every choice is
// saved in Settings; playing = navigating to play.html with URL parameters,
// the same ones shared links use.

trackView( 'menu' );

const RALLY_LENGTHS = [ [ 1000, '1 km' ], [ 2000, '2 km' ], [ 5000, '5 km' ], [ 10000, '10 km' ], [ 0, t( 'rally.endless' ) ] ];
const RALLY_LANDSCAPES = LANDSCAPE_IDS.map( ( id ) => [ id, t( 'landscape.' + id ) ] );
const PAINT = { yellow: '#f2c230', green: '#58b368', purple: '#8a63d2', red: '#e0523f' };

const ICONS = {
	solo: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6M12 2v3"/></svg>',
	multi: '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3.2"/><circle cx="17" cy="9" r="2.6"/><path d="M2.5 20c.8-3.6 3-5.5 5.5-5.5s4.7 1.9 5.5 5.5M14.5 14.8c2.8-.6 5.4.9 6.5 4.7"/></svg>',
	experimental: '<svg viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="17" height="13" rx="3"/><path d="M12 3v3.5M9.5 13l2.5-3 2.5 3M12 10v6"/></svg>',
	garage: '<svg viewBox="0 0 24 24"><path d="M3 16v-3.2l2.2-4.6A2 2 0 0 1 7 7h10a2 2 0 0 1 1.8 1.2L21 12.8V16"/><rect x="2.5" y="12.5" width="19" height="4.5" rx="1.5"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
	editor: '<svg viewBox="0 0 24 24"><path d="M4 19c1.5-5 4-6 7-6s5-2 6-7"/><path d="M15 4l5 5-9 9H6v-5z"/></svg>',
	settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
};

// Where each screen stands (Showroom.goTo): home at the start of a stage, the
// white garage, racing down the stage (solo), with two more cars (multiplayer)
const PLACES = { home: 'home', settings: 'home', legal: 'home', garage: 'garage', solo: 'home', circuit: 'home', rally: 'home', multi: 'home', experimental: 'home', daily: 'home', lobby: 'multi' }; // solo, circuit, rally: the home stays, only its walls change (and the camera slides for the last two)
const placeOf = ( name ) => PLACES[ name ] || 'home';
const WALL_SCREENS = [ 'home', 'solo', 'circuit', 'rally', 'multi', 'experimental', 'daily' ]; // their choices are on the home's walls
const PANEL_SCREENS = [ 'settings', 'legal' ]; // a panel of their own on the home: reached by a slide like Solo's, not the wipe
const CIRCUIT_COLS = 3; // tiles across on a row of the circuit menu
const PAGE = CIRCUIT_COLS * 2; // circuits on a page of the circuit menu (2 rows)
let lastWallScreen = null; // the walls' screen last shown: the same one again = an update, no slide
let circuitPage = 0;
const boards = new Map(); // circuit key → its online leaderboard: a promise, then { entries, total, mine } | { error }
let boardKey = null; // the circuit whose leaderboard the right wall shows (the last one hovered)
let wallDir = 1; // the walls' items slide up going forward, down going back

const settings = loadSettings();
// The truck (or an unknown car) is no longer in the garage: a rally car instead
if ( ! GARAGE_CARS.includes( findCar( settings.car ) ) ) {

	settings.car = GARAGE_CARS[ 0 ].id;
	settings.color = 1;
	saveSettings( settings );

}

forgetOldPlayer();
// The Google account as the screens read it: name = pseudo ('' until chosen),
// filled in once /api/me answers (the menu never waits for the network)
const player = { name: '', signedIn: false, offline: null }; // offline: server error text
translatePage(); // index.html's own words (data-i18n)
const authError = authErrorText( location.search );
const screenEl = document.getElementById( 'screen' );
const crumbsEl = document.getElementById( 'crumbs' );
const onlineEl = document.getElementById( 'online' );
const searchEl = document.getElementById( 'circuit-search' );
const searchInputEl = document.getElementById( 'circuit-search-input' );
const profileEl = document.getElementById( 'profile' );
const popEl = document.getElementById( 'pseudo-pop' );
const wallsEl = document.getElementById( 'walls' );

// The loading bar of the page transition: the backdrop stage, the car, the
// fonts (Fonts.js), then their shaders; the window opens on the showroom once they are ready
const loading = new PageLoading( { files: 50, set: 15, car: 10, shaders: 25 }, {
	ui: () => document.querySelectorAll( '#music, #profile' ), // the logo and the cards have their own entrance
} );
const showroom = new Showroom( document.getElementById( 'showroom' ) );
const setReady = loading.track( 'set', showroom.buildSet( { props: ! settings.performance, ultra: settings.graphics === 'ultra', seasonId: settings.rally.season, homeSeason: settings.homeSeason, walls: wallsEl } ) );
if ( new URLSearchParams( location.search ).has( 'debug' ) ) window.showroom = showroom;
const carReady = loading.track( 'car', showroom.setCar( settings.car, settings.color ) );
Promise.allSettled( [ setReady, carReady, fontsReady ] )
	.then( () => {

		const name = stack[ stack.length - 1 ];
		showroom.show( placeOf( name ), { walls: name === 'home', hidden: true } );
		return loading.compile( 'shaders', showroom.renderer, showroom.scene, showroom.camera );

	} )
	.finally( () => loading.reveal().then( () => {

		showroom.unfold(); // the place unfolds around the car
		render( true ); // the cards' entrance cascade once the window is open

	} ) );

// A gamepad works the menu: d-pad / stick between the buttons, A, B back
new GamepadUI( { hint: t( 'pad.menuHint' ) } );

// Music, beat clock and effects: the camera cuts on the bars, every cut plays
// a mask, the UI pulses on the kick
const music = new MenuMusic( { enabled: settings.music !== false, volume: settings.volume.music } );
const ui = new UiSounds(); // a pop on clicks, another when a popup opens
showroom.onSeasonFlow = ( passAt ) => ui.woosh( passAt, { overlap: true } ); // the home's season: a woosh as its front sweeps under the camera (clicked in a row: they overlap, mixed)
if ( window.showroom ) window.music = music; // ?debug
const fx = new Fx();
let beatInfo = music.info();
showroom.setClock( { info: () => beatInfo, calm: () => music.calm( beatInfo.time ) } );
showroom.onCut = () => fx.cut();
showroom.onFrame = ( canvas, p ) => fx.frame( canvas, p );

let stack = [ 'home' ]; // navigation history, last = current screen
let current = null;
let rallySeed = randomSeed(); // rolled up front so the preview is the stage you get
// First-ever stage on this browser: shorter and gentler (low landscape, no
// mountain/cliff), so a brand-new visitor's first impression isn't a 5 km
// technical stage. Any deliberate choice on the wall, or launching once, ends it.
let introRally = ! hasPlayedRally();
const INTRO_RALLY = { length: 1000, landscape: 'low' };
function endIntroRally() {

	if ( ! introRally ) return;
	introRally = false;
	markRallyPlayed();

}
let circuitTab = 'official';
let circuitSearch = ''; // community tab only (topbar #circuit-search)
let selectedKey = 'kenney';
let community = null; // { circuits } from the server, or { error }
const challenge = dailyChallenge(); // today's daily challenge: fixed for this page load
let dailyBoard = null; // its leaderboard, fetched once per visit: { entries, mine } from the server, or { error }

const escapeHtml = ( s ) => String( s ).replace( /[&<>"']/g, ( c ) => `&#${ c.charCodeAt( 0 ) };` );

function randomSeed() {

	return String( Math.floor( Math.random() * 1e6 ) );

}

function readStorage( key ) {

	try {

		return localStorage.getItem( key );

	} catch {

		return null;

	}

}

function save() {

	saveSettings( settings );

}

function leave( url ) {

	music.fadeOut( 0.45 );
	leavePage( url );

}

function play( query ) {

	// A drawn circuit (track=, map=) goes after the #, never sent to the server: no size limit
	const sep = /^(track|map)=/.test( query ) ? '#' : '?';
	const target = 'play.html' + ( query ? sep + query : '' );
	leave( player.signedIn ? target : 'login.html?next=' + encodeURIComponent( '/' + target ) );

}

const segmented = ( name, options, value ) =>
	`<div class="seg">${ options.map( ( [ v, label ] ) =>
		`<button data-set="${ name }" data-value="${ v }" class="${ String( v ) === String( value ) ? 'on' : '' }">${ label }</button>` ).join( '' ) }</div>`;

// ─── Circuits ─────────────────────────────────────────────
// One model for every circuit shown: official, on this device, published.

function circuitItems( tab ) {

	if ( tab === 'official' ) {

		const kenney = { key: 'kenney', name: t( 'circuits.kenney' ), sub: t( 'circuits.official' ), query: '', board: 'default', best: loadBest( 'racing.bestLap2.default' ), thumb: () => gridThumb() };
		// Published circuits promoted to official: their drawing and stars once the list is in, gone if unpublished
		const promoted = OFFICIAL_PUBLISHED.map( ( o ) => {

			const c = community?.circuits?.find( ( e ) => e.id === o.id ) || null;
			if ( community?.circuits && ! c ) return null;
			return { key: 'off:' + o.id, name: o.name, sub: c ? t( 'circuits.officialBy', { author: c.mine ? t( 'circuits.you' ) : c.author } ) : t( 'circuits.official' ), query: 'circuit=' + o.id, board: o.id, best: null, published: c, thumb: () => c?.shape ? splineThumb( c.shape ) : '' };

		} ).filter( Boolean );
		return [ kenney, ...promoted ];

	}

	if ( tab === 'mine' ) {

		const items = listLocal().map( ( c ) => ( {
			key: 'local:' + c.id,
			name: c.name,
			sub: c.published ? t( 'circuits.localPublished' ) : t( 'circuits.local' ),
			query: 'track=' + c.data,
			board: { track: c.data },
			best: loadBest( 'racing.bestLap2.spline.' + c.data ),
			edit: c.id,
			thumb: () => splineThumb( c.data ),
		} ) );

		const grid = readStorage( 'racing-editor-cells' );
		if ( grid ) items.push( { key: 'map', name: t( 'circuits.oldEditor' ), sub: t( 'circuits.grid' ), query: 'map=' + grid, board: { map: grid }, best: loadBest( 'racing.bestLap2.' + grid ), thumb: () => mapThumb( grid ) } );
		return items;

	}

	if ( ! community || ! community.circuits ) return [];

	return community.circuits.filter( ( c ) => ! isOfficialPublished( c.id ) ).map( ( c ) => ( {
		key: 'pub:' + c.id,
		name: c.name,
		sub: t( 'circuits.by', { author: c.mine ? t( 'circuits.you' ) : c.author } ),
		query: 'circuit=' + c.id,
		board: c.id,
		best: null,
		published: c,
		thumb: () => splineThumb( c.shape ),
	} ) );

}

// circuitItems(tab), narrowed by the community search box (topbar #circuit-search)
function searchedItems( tab ) {

	const all = circuitItems( tab );
	const q = tab === 'community' ? circuitSearch.trim().toLocaleLowerCase() : '';
	return q ? all.filter( ( item ) => item.name.toLocaleLowerCase().includes( q ) ) : all;

}

function findItem( key ) {

	for ( const tab of [ 'official', 'mine', 'community' ] ) {

		const item = circuitItems( tab ).find( ( i ) => i.key === key );
		if ( item ) return item;

	}

	return null;

}

async function loadCommunity( screen ) {

	const res = await listPublished();
	community = res.ok ? res.data : { error: res.error };
	if ( current === screen && ( circuitTab === 'community' || circuitTab === 'official' ) ) render();

}

// Stars count at once; the server's answer then corrects it
async function star( id ) {

	const c = community && community.circuits && community.circuits.find( ( e ) => e.id === id );
	if ( ! c ) return;

	c.starred = ! c.starred;
	c.stars += c.starred ? 1 : - 1;
	render();

	const res = await toggleStar( id );

	if ( res.ok ) Object.assign( c, res.data );
	else {

		c.starred = ! c.starred;
		c.stars += c.starred ? 1 : - 1;
		if ( res.status === 401 ) profileEl.click(); // not signed in: open the sign-in / pseudo popup

	}

	community.circuits.sort( ( a, b ) => b.stars - a.stars || b.date.localeCompare( a.date ) );
	render();

}

// ─── Screens ──────────────────────────────────────────────
// Each returns { view, title, html, after } — view is the showroom framing.

const screens = {

	// The choices are titles in the scene (homeTitles → Walls.js); nothing in #screen
	home: () => ( { view: 'center', html:
		'<div class="corner-links">' +
			`<a class="legal-link" href="https://ko-fi.com/dirtbound" target="_blank" rel="noopener">${ t( 'home.coffee' ) }</a>` +
			`<a class="legal-link" href="mailto:${ PEOPLE.victor.mail }?subject=${ encodeURIComponent( 'DirtBound - avis' ) }">${ t( 'home.feedback' ) }</a>` +
			`<button class="legal-link" data-go="legal">${ t( 'legal.link' ) }</button>` +
		'</div>' } ),

	// The two modes are clips on the home's walls (soloCards → Walls.js); nothing in #screen
	solo: () => ( { view: 'center', title: t( 'home.solo' ), html: '' } ),

	// Circuit and Spéciale: a column on the home's left wall (circuitWall,
	// rallyWall → Walls.js), the view shifted so the car stands on the right
	circuit: () => ( {
		view: 'menu',
		title: t( 'solo.circuit' ),
		html: '',
		after: ( screen ) => {

			if ( ( circuitTab === 'community' || circuitTab === 'official' ) && ! community ) loadCommunity( screen );
			fetchRecords( screen );

		},
	} ),

	rally: () => ( { view: 'menu', title: t( 'rally.title' ), html: '' } ),

	// The daily challenge: a column on the home's left wall (dailyWall →
	// Walls.js), its leaderboard on the right wall like Circuit's
	daily: () => ( { view: 'menu', title: t( 'home.daily' ), html: '', after: ( screen ) => loadDailyBoard( screen ) } ),

	settings: () => {

		const fresh = settingsTabChanged ? ' fresh' : '';
		settingsTabChanged = false;

		return {
			view: 'menu', // the car on the right, the settings in a column on the left like Circuit / Spéciale
			title: t( 'home.settings' ),
			html:
				'<section class="panel settings-panel">' +
				`<div class="tabs">${ SETTINGS_TABS.map( ( [ k, label ] ) => `<button data-stab="${ k }" class="${ k === settingsTab ? 'on' : '' }">${ label }</button>` ).join( '' ) }</div>` +
				`<div class="tab-body${ fresh }">${ SETTINGS_BODIES[ settingsTab ]() }</div>` +
				'</section>',
		};

	},

	// Mentions légales and credits: a column of tiles on the left like Paramètres
	legal: () => {

		const fresh = legalTabChanged ? ' fresh' : '';
		legalTabChanged = false;

		return {
			view: 'menu',
			title: t( 'legal.title' ),
			html:
				'<section class="panel settings-panel legal-panel">' +
				`<div class="tabs">${ [ 'legal', 'credits' ].map( ( k ) => `<button data-ltab="${ k }" class="${ k === legalTab ? 'on' : '' }">${ t( 'legal.tabs.' + k ) }</button>` ).join( '' ) }</div>` +
				`<div class="tab-body${ fresh }">${ legalTab === 'credits' ? creditsBody() : legalBody() }</div>` +
				'</section>',
		};

	},

	// The car on its plinth in the middle; scroll the names (left): the one in
	// the middle of the screen is the car. The liveries on the right
	garage: () => {

		const car = findCar( settings.car ) || GARAGE_CARS[ 0 ];

		return {
			view: 'center',
			title: t( 'home.garage' ),
			html:
				`<nav class="wheel cars" aria-label="${ t( 'garage.cars' ) }"></nav>` +
				`<nav class="liveries-wheel" aria-label="${ t( 'garage.liveries' ) }">${ liveryButtons( car ) }</nav>` +
				`<div class="car-name"><b>${ escapeHtml( car.label ) }</b><small>${ t( 'garage.livery', { n: settings.color } ) }</small></div>`,
			after: () => garageAfter(),
		};

	},

};

// ─── Home titles (Walls.js) ───────────────────────────────

// Total players active on the site right now, badge at the top left of the
// menu (social proof: a quiet-looking game is why nobody tries it). Never
// shown at 0, that would discourage rather than invite.
async function pollOnline() {

	const r = await fetchOnline();
	const n = r.ok ? r.data.players : 0;
	onlineEl.hidden = ! n;
	if ( n ) onlineEl.querySelector( 'b' ).textContent = t( 'home.onlineNow', { n } );

}

function homeTitles() {

	const car = findCar( settings.car ) || GARAGE_CARS[ 0 ];
	const graphics = t( 'home.graphics.' + settings.graphics );

	return [
		{ side: 'left', title: t( 'home.solo' ), sub: t( 'home.soloSub' ), size: 0.21, accent: true, data: { go: 'solo' } },
		{ side: 'left', title: t( 'home.multi' ), sub: t( 'home.multiSub' ), size: 0.12, data: { go: 'multi' } },
		{ side: 'left', title: t( 'home.daily' ), sub: t( 'home.dailySub' ), size: 0.1, data: { go: 'daily' } },
		{ side: 'left', title: t( 'home.experimental' ), sub: t( 'home.experimentalSub' ), size: 0.15, accent: true, data: { go: 'experimental' } },
		{ side: 'right', title: t( 'home.garage' ), sub: t( 'home.garageSub', { car: car.label, n: settings.color } ), size: 0.13, above: true, grow: 1.2, data: { go: 'garage' } }, // its line above it: the tiles right under; the whole right wall ×1.2
		{ side: 'right', kind: 'account', ...accountText(), data: { act: 'profile' } },
		{ side: 'right', kind: 'icon', icon: 'editor', row: 'tools', title: t( 'home.editor' ), data: { act: 'editor' } },
		{ side: 'right', kind: 'icon', icon: 'settings', row: 'tools', title: t( 'home.settings' ), sub: t( 'home.settingsSub', { graphics } ), data: { go: 'settings' } },
		{ side: 'right', kind: 'icon', icon: 'music', row: 'tools', title: t( 'home.sound' ), data: { act: 'music' } },
		{ side: 'right', kind: 'icon', icon: 'season', row: 'tools', title: t( 'home.season' ), data: { act: 'season' } },
	];

}

// ─── Circuit and Spéciale: the left wall's column ─────────
// Bento tiles laid in rows (Walls `row`), BENTO.gap apart: rows share a width

const COLUMN = 0.92; // m: the column's width
const GAP = 0.008; // m: Walls BENTO.gap
const across = ( n ) => ( COLUMN - GAP * ( n - 1 ) ) / n;

function circuitWall() {

	const tabs = [ [ 'official', t( 'circuits.tabOfficial' ) ], [ 'mine', t( 'circuits.tabMine', { n: circuitItems( 'mine' ).length } ) ], [ 'community', t( 'circuits.tabCommunity' ) ] ];
	const out = tabs.map( ( [ k, label ] ) => ( { side: 'left', kind: 'tab', row: 'tabs', w: across( 3 ), h: 0.1, title: label, on: k === circuitTab, data: { tab: k } } ) );

	const note = ( text ) => out.push( { side: 'left', kind: 'caption', w: COLUMN, h: 0.06, title: text, data: {} } );
	if ( circuitTab === 'community' && ! community ) return note( t( 'circuits.loading' ) ), out;
	if ( circuitTab === 'community' && community.error ) return note( community.error ), out;

	const items = searchedItems( circuitTab ).map( ( item ) => ( {
		kind: 'thumb', thumb: item.key, title: item.name,
		sub: item.sub,
		stars: item.published ? item.published.stars : null,
		starred: item.published ? item.published.starred : false,
		starId: item.published ? item.published.id : null,
		hoverSub: recordLine( item ),
		data: { act: 'drive:' + item.key },
	} ) );
	if ( circuitTab === 'mine' ) items.push( { kind: 'thumb', plus: true, title: t( 'circuits.new' ), sub: t( 'circuits.newSub' ), data: { act: 'new-circuit' } } );
	if ( items.length === 0 ) {

		if ( circuitSearch.trim() ) return note( t( 'circuits.searchNone', { q: circuitSearch.trim() } ) ), out;
		return note( circuitTab === 'community' ? t( 'circuits.nonePublishedYet' ) : t( 'circuits.none' ) ), out;

	}

	const pages = Math.ceil( items.length / PAGE );
	circuitPage = Math.min( Math.max( 0, circuitPage ), pages - 1 );
	items.slice( circuitPage * PAGE, circuitPage * PAGE + PAGE ).forEach( ( it, i ) => out.push( { side: 'left', row: 'r' + Math.floor( i / CIRCUIT_COLS ), w: across( CIRCUIT_COLS ), h: 0.31, ...it } ) );

	if ( pages > 1 ) {

		const page = { side: 'left', kind: 'tab', row: 'pages', h: 0.08 };
		out.push( { ...page, w: across( 3 ), title: t( 'pager.prev' ), off: circuitPage === 0, data: { act: 'page-prev' } } );
		out.push( { ...page, w: across( 3 ), title: `${ circuitPage + 1 } / ${ pages }`, off: true, data: {} } );
		out.push( { ...page, w: across( 3 ), title: t( 'pager.next' ), off: circuitPage === pages - 1, data: { act: 'page-next' } } );

	}

	// The right wall: the leaderboard of the circuit last hovered, the page's first until then
	const shown = searchedItems( circuitTab ).slice( circuitPage * PAGE, circuitPage * PAGE + PAGE );
	if ( ! shown.some( ( item ) => item.key === boardKey ) ) boardKey = shown[ 0 ]?.key ?? null;
	const board = boardSlots( boardKey );
	out.push( { side: 'right', kind: 'caption', w: BOARD_COLUMN, h: 0.05, angle: BOARD_ANGLE, ...board[ 0 ], data: { board: 'title' } } );
	for ( let i = 0; i < BOARD_ROWS; i ++ ) out.push( { side: 'right', kind: 'row', w: BOARD_COLUMN, h: 0.1, still: true, ...board[ i + 1 ], data: { board: i } } );

	return out;

}

// ─── Circuit: the leaderboard on the right wall ──────────
// Fixed slots (a caption + BOARD_ROWS rows) filled in place (`walls.patch`)
// when another circuit is hovered: rebuilding the walls would drop the hover

const BOARD_ROWS = 6;
const BOARD_COLUMN = 0.84; // m: as wide as Spéciale's themes
const BOARD_ANGLE = 55; // ° from the screen (Walls ANGLE is 70): turned towards the camera, easier to read

// A circuit's leaderboard, fetched once (and its id worked out for a local circuit)
function loadBoard( item ) {

	if ( ! boards.has( item.key ) ) boards.set( item.key, ( async () => {

		const id = typeof item.board === 'string' ? item.board : await circuitId( item.board );
		const res = await fetchLeaderboard( id );
		const board = res.ok ? res.data : { error: res.error };
		boards.set( item.key, board );
		return board;

	} )() );

	return Promise.resolve( boards.get( item.key ) );

}

// What the caption and each row show for a circuit's leaderboard (fields for `patch`)
function boardSlots( key ) {

	const item = key && findItem( key );
	const board = key ? boards.get( key ) : null;
	const blank = { badge: '', title: '', sub: '', aside: '', accent: false, blank: true };
	const rows = Array.from( { length: BOARD_ROWS }, () => ( { ...blank } ) );
	const line = ( text ) => ( { ...blank, badge: '–', title: text, blank: false } );

	if ( ! item ) rows[ 0 ] = line( t( 'circuits.boardNone' ) );
	else if ( ! board || board instanceof Promise ) rows[ 0 ] = line( '…' );
	else if ( board.error ) rows[ 0 ] = line( board.error );
	else if ( board.entries.length === 0 ) rows[ 0 ] = line( t( 'circuits.boardEmpty' ) );
	else {

		const entry = ( e ) => ( { badge: String( e.rank ), title: e.name, sub: e.car || '', aside: formatTime( e.time ), accent: e.rank === board.mine?.rank, blank: false } );
		board.entries.slice( 0, BOARD_ROWS ).forEach( ( e, i ) => { rows[ i ] = entry( e ); } );
		// Mine further down takes the last row
		if ( board.mine && board.mine.rank > BOARD_ROWS ) rows[ BOARD_ROWS - 1 ] = entry( board.mine );

	}

	return [ { title: item ? t( 'circuits.board', { name: item.name } ) : t( 'circuits.boardTitle' ) }, ...rows ];

}

// The daily challenge's leaderboard: its own small board (not a circuitItems
// entry, so not boardSlots above), fetched once, re-rendered once it is in
async function loadDailyBoard( screen ) {

	const res = await fetchLeaderboard( await dailyBoardId() );
	dailyBoard = res.ok ? res.data : { error: res.error };
	if ( current === screen ) render();

}

function dailyBoardSlots() {

	const blank = { badge: '', title: '', sub: '', aside: '', accent: false, blank: true };
	const rows = Array.from( { length: BOARD_ROWS }, () => ( { ...blank } ) );
	const line = ( text ) => ( { ...blank, badge: '–', title: text, blank: false } );

	if ( ! dailyBoard ) rows[ 0 ] = line( '…' );
	else if ( dailyBoard.error ) rows[ 0 ] = line( dailyBoard.error );
	else if ( dailyBoard.entries.length === 0 ) rows[ 0 ] = line( t( 'circuits.boardEmpty' ) );
	else {

		const entry = ( e ) => ( { badge: String( e.rank ), title: e.name, sub: e.car || '', aside: formatTime( e.time ), accent: e.rank === dailyBoard.mine?.rank, blank: false } );
		dailyBoard.entries.slice( 0, BOARD_ROWS ).forEach( ( e, i ) => { rows[ i ] = entry( e ); } );
		if ( dailyBoard.mine && dailyBoard.mine.rank > BOARD_ROWS ) rows[ BOARD_ROWS - 1 ] = entry( dailyBoard.mine );

	}

	return [ { title: t( 'daily.board' ) }, ...rows ];

}

// The daily challenge: a caption + a big "play" tab (left wall, same bento
// style as Spéciale's), its leaderboard on the right (same as Circuit's)
function dailyWall() {

	const note = ( text ) => ( { side: 'left', kind: 'caption', w: COLUMN, h: 0.06, title: text, data: {} } );
	const desc = challenge.kind === 'circuit'
		? t( 'daily.onCircuit', { name: challenge.name } )
		: t( 'daily.onRally', { km: ( challenge.length / 1000 ).toFixed( 1 ), landscape: t( 'landscape.' + challenge.landscape ) } );

	const out = [
		note( t( 'daily.title' ) ),
		note( desc ),
		{ side: 'left', kind: 'tab', row: 'go', w: COLUMN, h: 0.11, title: t( 'daily.go' ), accent: true, big: true, data: { act: 'daily-go' } },
	];

	const board = dailyBoardSlots();
	out.push( { side: 'right', kind: 'caption', w: BOARD_COLUMN, h: 0.05, angle: BOARD_ANGLE, ...board[ 0 ], data: { board: 'title' } } );
	for ( let i = 0; i < BOARD_ROWS; i ++ ) out.push( { side: 'right', kind: 'row', w: BOARD_COLUMN, h: 0.1, still: true, ...board[ i + 1 ], data: { board: i } } );

	return out;

}

// Shows a circuit's leaderboard on the right wall (fetched if needed)
function showBoard( key ) {

	boardKey = key;
	const paint = () => {

		if ( boardKey !== key ) return;
		const slots = boardSlots( key );
		showroom.walls?.patch( ( spec ) => spec.data?.board === 'title', slots[ 0 ] );
		for ( let i = 0; i < BOARD_ROWS; i ++ ) showroom.walls?.patch( ( spec ) => spec.data?.board === i, slots[ i + 1 ] );

	};

	paint();
	const item = findItem( key );
	if ( item?.board && ! boards.has( key ) ) loadBoard( item ).then( paint );

}

// A circuit's records, for its tile's hover line
function recordLine( item ) {

	const board = boards.get( item.key );
	const online = ! board || board instanceof Promise ? '…' : board.entries?.[ 0 ] ? formatTime( board.entries[ 0 ].time ) : '–';
	return t( 'circuits.records', { mine: formatTime( item.best ), online } );

}

// The leaderboards of the circuits on the page, as they come (each once):
// their record in the tile's hover line, the one on the right wall
async function fetchRecords( screen ) {

	const page = searchedItems( circuitTab ).slice( circuitPage * PAGE, circuitPage * PAGE + PAGE );
	for ( const item of page ) {

		if ( boards.has( item.key ) || ! item.board ) continue;
		await loadBoard( item );
		if ( current !== screen ) return;
		showroom.walls?.patch( ( spec ) => spec.data?.act === 'drive:' + item.key, { hoverSub: recordLine( item ) } );
		if ( item.key === boardKey ) showBoard( boardKey );

	}

}

// A stage's theme (internally its season: Seasons.js), as the menu shows it:
// a picture of the stage dressed that way, named like a place on a rally map
// (French: Val-Guimauve = camping, the fire, marshmallows; Prébouton = the meadow
// and its buttercups; Bois-Roussi = the russet woods; Givreval = the frosted valley)
const THEMES = {
	summer: { name: t( 'themes.summer' ) },
	spring: { name: t( 'themes.spring' ) },
	autumn: { name: t( 'themes.autumn' ) },
	winter: { name: t( 'themes.winter' ) },
};
const THEME_IDS = [ 'summer', 'spring', 'autumn', 'winter' ];
const themeImage = ( id ) => `images/themes/${ id }.webp`;

function rallyWall() {

	const { length, landscape } = introRally ? INTRO_RALLY : settings.rally;
	const season = THEMES[ settings.rally.season ] ? settings.rally.season : 'summer';
	const L = { side: 'left' };
	const choices = ( name, options, value ) => options.map( ( [ v, label ] ) => ( { ...L, kind: 'tab', row: name, w: across( options.length ), h: 0.085, title: label, on: String( v ) === String( value ), data: { set: name, value: v } } ) );

	const out = [
		// The theme's picture, its name over it (chosen on the right wall)
		{ ...L, kind: 'photo', cover: themeImage( season ), w: COLUMN, h: 0.46, title: THEMES[ season ].name, titleSize: 0.17, off: true, data: {} },
		{ ...L, kind: 'caption', w: COLUMN, h: 0.05, title: t( 'rally.length' ), data: {} },
		...choices( 'length', RALLY_LENGTHS, length ),
		{ ...L, kind: 'caption', w: COLUMN, h: 0.05, title: t( 'rally.landscape' ), data: {} },
		...choices( 'landscape', RALLY_LANDSCAPES, landscape ),
		{ ...L, kind: 'tab', row: 'go', w: across( 3 ), h: 0.11, title: t( 'rally.dice' ), data: { act: 'dice' } },
		{ ...L, kind: 'tab', row: 'go', w: COLUMN - across( 3 ) - GAP, h: 0.11, title: t( 'rally.go' ), accent: true, big: true, data: { act: 'rally' } },
	];

	// The themes, always there on the right wall: the chosen one outlined
	const R = { side: 'right' };
	const w = ( THEME_COLUMN - GAP ) / 2;
	out.push( { ...R, kind: 'caption', w: THEME_COLUMN, h: 0.05, title: t( 'rally.theme' ), data: {} } );
	THEME_IDS.forEach( ( id, i ) => out.push( { ...R, kind: 'photo', cover: themeImage( id ), row: 'theme' + ( i >> 1 ), w, h: 0.24,
		title: THEMES[ id ].name, titleSize: 0.2, on: id === season, data: { act: 'theme:' + id } } ) );
	return out;

}

const THEME_COLUMN = 0.84; // m: the themes' column on the right wall

// The pictures of the column's tiles (Walls `thumb`): a circuit's, or a stage's road
async function wallThumb( key ) {

	if ( key.startsWith( 'rally:' ) ) {

		const [ , seed, landscape, length ] = key.split( ':' );
		return rallyThumb( Number( seed ), landscape, Number( length ) );

	}

	return findItem( key )?.thumb() || '';

}

// Solo's two modes: a clip each, on the home's walls (the scene stays still)
function soloCards() {

	const card = { kind: 'video', w: 1.05, h: 0.66 };
	return [
		{ ...card, side: 'left', cover: 'images/modes/circuit.svg', title: t( 'solo.circuit' ), sub: t( 'solo.circuitSub' ), data: { go: 'circuit' } },
		{ ...card, side: 'right', cover: 'images/themes/summer.webp', title: t( 'solo.rally' ), sub: t( 'solo.rallySub' ), data: { go: 'rally' } },
	];

}

// ─── Garage: the car wheel and the liveries ───────────────

// Swatch colours per car (Swatches.js: read off the car's own textures), once known
const swatches = new Map();

// The swatches of the car on display, once its model is in
async function refreshSwatches() {

	const car = findCar( settings.car );
	// That car's own model (not the one on screen: during a change of car the
	// old one is still there while the new one waits to grow in)
	const model = car && showroom.modelOf( car.id );
	if ( ! car || car.id === 'truck' || swatches.has( car.id ) || ! model ) return;
	const colors = await carSwatches( car.id, model, car.liveries );
	if ( ! colors ) return;
	swatches.set( car.id, colors );
	if ( settings.car === car.id ) updateLiveries( car );

}

function liveryButtons( car ) {

	return Array.from( { length: car.liveries }, ( _, i ) => {

		const color = car.id === 'truck' ? PAINT[ TRUCK_COLORS[ i ] ] : swatches.get( car.id )?.[ i ];
		return `<button data-livery="${ i + 1 }" class="${ settings.color === i + 1 ? 'on' : '' }" style="--swatch:${ color || '#c9ceda' }" aria-label="${ t( 'garage.livery', { n: i + 1 } ) }"><i></i></button>`;

	} ).join( '' );

}

// The swatches of a car, in place: no entrance animation again, only a
// swatch that did not exist yet (another number of liveries) is added
function updateLiveries( car ) {

	const el = screenEl.querySelector( '.liveries-wheel' );
	if ( ! el ) return;
	const buttons = [ ...el.children ];

	for ( let i = 0; i < Math.max( buttons.length, car.liveries ); i ++ ) {

		let b = buttons[ i ];
		if ( i >= car.liveries ) {

			b.remove();
			continue;

		}

		if ( ! b ) {

			el.insertAdjacentHTML( 'beforeend', liveryButtons( car ).match( /<button[\s\S]*?<\/button>/g )[ i ] );
			b = el.lastElementChild;
			b.style.animation = 'none';

		}

		const color = car.id === 'truck' ? PAINT[ TRUCK_COLORS[ i ] ] : swatches.get( car.id )?.[ i ];
		b.style.setProperty( '--swatch', color || '#c9ceda' );
		b.classList.toggle( 'on', settings.color === i + 1 );

	}

}

// The car drum (CarWheel.js): the name it rests on is the car
function garageAfter() {

	const el = screenEl.querySelector( '.wheel.cars' );
	if ( ! el ) return;
	refreshSwatches();
	new CarWheel( el, GARAGE_CARS.map( ( c ) => ( { id: c.id, label: c.label } ) ), settings.car, ( id ) => chooseCar( id ) );

}

// A car or a livery chosen in the garage: the lists stay where they are
function chooseCar( id, livery = null ) {

	const car = findCar( id );
	if ( ! car ) return;
	settings.car = car.id;
	if ( livery ) settings.color = livery;
	if ( settings.color > car.liveries ) settings.color = 1;
	save();
	showroom.setCar( settings.car, settings.color ).then( refreshSwatches );

	updateLiveries( car );
	const name = screenEl.querySelector( '.car-name' );
	if ( name ) name.innerHTML = `<b>${ escapeHtml( car.label ) }</b><small>${ t( 'garage.livery', { n: settings.color } ) }</small>`;

}

// ─── Settings: graphics, sound, controls ──────────────────

// ─── Mentions légales ─────────────────────────────────────
// Names and contacts are not translated; everything around them is (legal.* in the locales)

const PEOPLE = {
	victor: { name: 'Victor Boutros', mail: 'boutros.victor.005@gmail.com' },
	luke: { name: 'Luke Baffait', mail: 'luke.baffait@yahoo.com', site: 'www.lukebaffait.fr' },
};

const link = ( href, text ) => `<a href="${ href }" target="_blank" rel="noopener">${ escapeHtml( text ) }</a>`;
const block = ( title, body ) => `<div class="preset legal-block"><span class="preset-head"><b>${ title }</b></span>${ body }</div>`;

function contact( id ) {

	const p = PEOPLE[ id ];
	const lines = [ `<a href="mailto:${ p.mail }">${ p.mail }</a>` ];
	if ( p.phone ) lines.push( `<a href="tel:${ p.tel }">${ p.phone }</a>` );
	if ( p.site ) lines.push( link( 'https://' + p.site, p.site ) );
	return `<p><strong>${ p.name }</strong><br>${ lines.join( '<br>' ) }</p>`;

}

function legalBody() {

	return '<div class="presets">' +
		block( t( 'legal.publisher' ), `<p>${ t( 'legal.publisherText' ) }</p>${ contact( 'victor' ) }${ contact( 'luke' ) }` ) +
		block( t( 'legal.director' ), `<p>${ PEOPLE.victor.name }</p>` ) +
		block( t( 'legal.host' ), `<p>${ t( 'legal.hostText', { name: PEOPLE.victor.name } ) }</p>${ contact( 'victor' ) }<p>${ t( 'legal.cdn' ) }</p>` ) +
		block( t( 'legal.ip' ), `<p>${ t( 'legal.ipText' ) }</p>` ) +
		block( t( 'legal.privacy' ), `<p>${ t( 'legal.privacyText' ) } <a href="confidentialite.html">${ t( 'legal.privacyLink' ) }</a></p>` ) +
		'</div>';

}

function creditsBody() {

	const kenney = link( 'https://kenney.nl/', 'Kenney' );
	const credit = ( title, text, licence ) => block( title, `<p>${ text }</p>${ licence ? `<small>${ t( 'legal.licence', { name: licence } ) }</small>` : '' }` );

	return '<div class="presets">' +
		block( t( 'legal.team' ), [ 'luke', 'victor' ].map( ( id ) => `<p><strong>${ PEOPLE[ id ].name }</strong><br>${ t( 'legal.roles.' + id ) }</p>` ).join( '' ) ) +
		credit( t( 'legal.basedOn' ), t( 'legal.basedOnText', { kit: link( 'https://github.com/mrdoob/Starter-Kit-Racing', 'Starter Kit Racing' ), mrdoob: link( 'https://github.com/mrdoob', 'mrdoob' ), kenney } ), 'MIT' ) +
		credit( t( 'legal.models' ), t( 'legal.modelsText', { kenney } ), 'CC0' ) +
		credit( t( 'legal.physics' ), t( 'legal.physicsText', { crashcat: link( 'https://github.com/isaac-mason/crashcat', 'crashcat' ) } ), 'MIT' ) +
		credit( t( 'legal.music' ), t( 'legal.musicText', { andriig: 'andriig', pixabay: link( 'https://pixabay.com/music/', 'Pixabay' ) } ) ) +
		credit( t( 'legal.sounds' ), t( 'legal.soundsText', { zapsplat: link( 'https://www.zapsplat.com', 'zapsplat.com' ), soundsnap: link( 'https://www.soundsnap.com', 'soundsnap.com' ) } ) ) +
		credit( t( 'legal.backfires' ), `${ link( 'https://freesound.org/people/Jonas_Jocys/sounds/457733/', 'Audi R8 — Jonas Jocys' ) } · ${ link( 'https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0' ) } · ${ link( 'audio/backfire/NOTICE.txt', t( 'legal.backfireEdits' ) ) }` ) +
		credit( t( 'legal.libraries' ), `${ link( 'https://threejs.org/', 'three.js' ) } · ${ link( 'https://gsap.com/', 'GSAP' ) } · ${ link( 'https://fonts.google.com/specimen/Figtree', 'Figtree' ) }` ) +
		'</div>';

}

let legalTab = 'legal';
let legalTabChanged = false;

const SETTINGS_TABS = [ 'graphics', 'sound', 'controls' ].map( ( k ) => [ k, t( 'settings.tabs.' + k ) ] );
let settingsTab = 'graphics';
let settingsTabChanged = false;

// Each preset's name, line and list of what it does: settings.presets.<id> in the locales
const GRAPHICS_PRESETS = [ 'low', 'normal', 'ultra' ].map( ( id ) => ( {
	id, label: t( `settings.presets.${ id }.label` ), tag: t( `settings.presets.${ id }.tag` ), items: list( `settings.presets.${ id }.items` ),
} ) );

const VOLUMES = [ 'engine', 'tyres', 'music' ].map( ( k ) => [ k, t( 'settings.volumes.' + k ) ] );

const ACTIONS = [ 'accelerate', 'brake', 'left', 'right', 'handbrake', 'pause', 'reset', 'restart', 'fire', 'camera' ].map( ( k ) => [ k, t( 'settings.actions.' + k ) ] );
let binding = null; // { action, slot } while waiting for a key

// Key names as printed on this keyboard when the browser knows the layout
// (Chromium), else the US position name
let layout = null;
navigator.keyboard?.getLayoutMap?.().then( ( map ) => {

	layout = map;
	if ( stack[ stack.length - 1 ] === 'settings' ) render();

} ).catch( () => {} );

const KEY_NAMES = {
	ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'Tab', AltLeft: 'Alt', AltRight: 'Alt Gr',
	...Object.fromEntries( [ 'Space', 'Escape', 'Enter', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'Backspace', 'CapsLock' ].map( ( k ) => [ k, t( 'keys.' + k ) ] ) ),
};

function keyLabel( code ) {

	if ( ! code ) return '—';
	if ( KEY_NAMES[ code ] ) return KEY_NAMES[ code ];
	const printed = layout?.get( code );
	if ( printed ) return printed.toUpperCase();
	return code.replace( /^Key|^Digit/, '' ).replace( /^Numpad/, t( 'keys.numpad' ) + ' ' );

}

const toggle = ( key, label, on, note = '' ) =>
	`<button class="switch${ on ? ' on' : '' }" data-toggle="${ key }" role="switch" aria-checked="${ on }"><span><b>${ label }</b>${ note ? `<small>${ note }</small>` : '' }</span><i></i></button>`;

const SETTINGS_BODIES = {

	graphics: () =>
		'<div class="presets">' + GRAPHICS_PRESETS.map( ( p ) =>
			`<button class="preset${ settings.graphics === p.id ? ' on' : '' }" data-set="graphics" data-value="${ p.id }"${ p.soon ? ' disabled' : '' }>` +
			`<span class="preset-head"><b>${ p.label }</b>${ p.soon ? `<span class="pbadge">${ t( 'settings.soon' ) }</span>` : settings.graphics === p.id ? `<span class="pbadge on">${ t( 'settings.active' ) }</span>` : '' }</span>` +
			`<small>${ p.tag }</small><ul>${ p.items.map( ( i ) => `<li>${ i }</li>` ).join( '' ) }</ul></button>` ).join( '' ) + '</div>' +
		`<p class="note">${ t( 'settings.graphicsNote' ) }</p>` +
		`<label class="field">${ t( 'settings.dof' ) }</label>` +
		`<div class="${ settings.graphics === 'ultra' ? '' : 'disabled-block' }">` +
		toggle( 'dof', t( 'settings.dofToggle' ), settings.dof.on, t( 'settings.dofNote' ) ) +
		`<label class="slider"><span>${ t( 'settings.dofStrength' ) }</span><input type="range" min="0" max="100" step="5" value="${ settings.dof.strength }" data-range="dof" style="--v:${ settings.dof.strength }%"><output>${ t( 'settings.percent', { v: settings.dof.strength } ) }</output></label>` +
		'</div>' +
		( settings.graphics === 'ultra' ? '' : `<p class="note">${ t( 'settings.ultraOnly' ) }</p>` ),

	sound: () =>
		`<label class="field">${ t( 'settings.volumesTitle' ) }</label>` +
		VOLUMES.map( ( [ k, label ] ) => {

			const v = Math.round( settings.volume[ k ] * 100 );
			return `<label class="slider"><span>${ label }</span><input type="range" min="0" max="100" step="5" value="${ v }" data-volume="${ k }" style="--v:${ v }%"><output>${ t( 'settings.percent', { v } ) }</output></label>`;

		} ).join( '' ) +
		`<label class="field">${ t( 'settings.musicTitle' ) }</label>` +
		toggle( 'music', t( 'settings.musicMenu' ), settings.music !== false ) +
		toggle( 'raceMusic', t( 'settings.musicRace' ), !! settings.raceMusic, t( 'settings.musicRaceNote' ) ) +
		`<p class="note">${ t( 'settings.soundNote' ) }</p>`,

	controls: () =>
		`<label class="field">${ t( 'lobby.camera' ) }</label>` +
		`<div role="group" aria-label="${ t( 'lobby.camera' ) }">` +
		segmented( 'view', [ [ 'iso', t( 'lobby.cameras.iso' ) ], [ 'chase', t( 'lobby.cameras.chase' ) ] ], settings.view ) + '</div>' +
		`<label class="field">${ t( 'settings.keyboard' ) }</label>` +
		'<div class="binds">' + ACTIONS.map( ( [ action, label ] ) => {

			const slots = action === 'pause' ? [ 0 ] : [ 0, 1 ];
			const keys = slots.map( ( slot ) => {

				const waiting = binding && binding.action === action && binding.slot === slot;
				return `<button class="key${ waiting ? ' waiting' : '' }" data-bind="${ action }:${ slot }">${ waiting ? t( 'settings.pressKey' ) : keyLabel( settings.keys[ action ][ slot ] ) }</button>`;

			} );

			if ( action === 'pause' ) keys.unshift( `<span class="key fixed">${ t( 'keys.Escape' ) }</span>` );
			return `<div class="bind"><span>${ label }</span>${ keys.join( '' ) }</div>`;

		} ).join( '' ) + '</div>' +
		`<div class="row"><button class="chip" data-act="reset-keys">${ t( 'settings.defaultKeys' ) }</button></div>` +
		`<p class="note">${ t( 'settings.keysNote' ) }</p>` +
		`<label class="field">${ t( 'settings.gamepad' ) }</label>` +
		'<div class="binds pad">' +
		list( 'settings.padRows' ).map( ( [ a, b ] ) => `<div class="bind"><span>${ a }</span><span class="key fixed">${ b }</span></div>` ).join( '' ) +
		'</div>',

};

// Short sample of a game sound at the chosen volume (engine and tyres can't
// be heard in the menu otherwise)
let previewEl = null;

function preview( kind ) {

	if ( kind === 'music' ) return;
	if ( previewEl ) previewEl.pause();
	previewEl = new Audio( kind === 'engine' ? 'audio/nsx/4700.wav' : 'audio/skid.ogg' );
	const el = previewEl;
	el.volume = Math.min( 1, settings.volume[ kind ] * ( kind === 'engine' ? 0.5 : 0.6 ) );
	el.play().catch( () => {} );
	const start = el.volume;

	setTimeout( () => {

		let k = 1;
		const fade = setInterval( () => {

			k -= 0.1;
			el.volume = Math.max( 0, start * k );

			if ( k <= 0 ) {

				clearInterval( fade );
				el.pause();

			}

		}, 20 );

	}, 700 );

}

// A key pressed while a binding waits: it moves to this action (off any other)
window.addEventListener( 'keydown', ( e ) => {

	if ( ! binding ) return;
	e.preventDefault();
	e.stopImmediatePropagation();

	const { action, slot } = binding;
	binding = null;

	if ( e.code === 'Escape' ) return render();

	if ( e.code === 'Backspace' || e.code === 'Delete' ) settings.keys[ action ][ slot ] = null;
	else {

		for ( const a in settings.keys ) settings.keys[ a ] = settings.keys[ a ].map( ( c ) => ( c === e.code ? null : c ) );
		settings.keys[ action ][ slot ] = e.code;

	}

	save();
	render();

}, true );

function setGraphics( id ) {

	settings.graphics = id;
	settings.performance = id === 'low';
	showroom.setGraphics( id );
	document.body.classList.toggle( 'low', settings.performance );

}

// ─── Multiplayer ──────────────────────────────────────────

// The screen a lobby sits on: Multijoueur, or Expérimental for a bonus lobby
let lobbyParent = 'multi';

const multi = createMulti( {
	player, settings, escapeHtml, segmented, listPublished, findCar,
	onChange: () => { if ( [ 'lobby', 'multi', 'experimental' ].includes( stack[ stack.length - 1 ] ) ) render(); },
	// The lobbies list changed: only the wall (a form being typed in keeps its focus)
	onWalls: () => {

		const name = stack[ stack.length - 1 ];
		if ( name === 'multi' || name === 'experimental' ) showroom.swapWalls( multi.wall( name === 'experimental' ? 'bonus' : 'classic' ), 1, true );

	},
	onEnterLobby: () => fx.transition( () => {

		lobbyParent = multi.client.lobby?.mode === 'bonus' ? 'experimental' : 'multi';
		stack.splice( 0, stack.length, 'home', lobbyParent, 'lobby' );
		render( true );

	} ),
	onRace: ( code ) => leave( 'play.html?lobby=' + encodeURIComponent( code ) ),
	onTest: () => leave( 'play.html?test' ),
	onLeaveLobby: () => fx.transition( () => {

		stack.splice( 0, stack.length, 'home', lobbyParent );
		render( true );

	}, - 1 ),
} );

Object.assign( screens, multi.screens );

// ─── Rendering & navigation ───────────────────────────────

// entering: play the entrance cascade (navigation), not on in-screen updates
function render( entering = false ) {

	const name = stack[ stack.length - 1 ];
	if ( name !== 'multi' && name !== 'experimental' ) multi.stopBrowsing();
	searchEl.hidden = ! ( name === 'circuit' && circuitTab === 'community' );
	if ( searchInputEl.value !== circuitSearch ) searchInputEl.value = circuitSearch;
	current = screens[ name ]();
	showroom.setView( current.view );
	showroom.goTo( placeOf( name ), { walls: WALL_SCREENS.includes( name ) } );
	const wall = { home: homeTitles, solo: soloCards, circuit: circuitWall, rally: rallyWall, daily: dailyWall, multi: () => multi.wall( 'classic' ), experimental: () => multi.wall( 'bonus' ) }[ name ];
	if ( wall ) {

		if ( showroom.walls ) {

			showroom.walls.thumbs = wallThumb;
			// Circuit: a circuit hovered shows its leaderboard on the right wall (and keeps it)
			showroom.walls.onHover = ( spec, hot ) => {

				const act = spec.data?.act || '';
				if ( hot && stack[ stack.length - 1 ] === 'circuit' && act.startsWith( 'drive:' ) ) showBoard( act.slice( 6 ) );

			};

		}
		showroom.swapWalls( wall(), wallDir, name === lastWallScreen );
		lastWallScreen = name;

	}

	wallDir = 1;

	const keepScroll = [ ...screenEl.querySelectorAll( '.cards, .car-grid' ) ].map( ( el ) => el.scrollTop );
	screenEl.innerHTML = current.html;
	// A popup of the screen (the lobby forms) that was not there: its sound
	const float = screenEl.querySelector( '.lobby-float h3' )?.textContent || null;
	if ( float && float !== shownFloat ) ui.popup();
	shownFloat = float;
	screenEl.dataset.screen = name;
	document.body.dataset.screen = name; // the home has the account and the music in its titles
	screenEl.querySelectorAll( '.cards, .car-grid' ).forEach( ( el, i ) => { el.scrollTop = keepScroll[ i ] || 0; } );

	crumbsEl.innerHTML = stack.length > 1 ? `<button class="crumb" data-act="back"><span class="back">←</span><span>${ current.title }</span></button>` : '';

	// In-screen updates (a car picked in the garage…) don't replay the cascade
	if ( ! entering ) for ( const el of [ screenEl, crumbsEl ] ) el.classList.remove( 'enter' );

	if ( entering ) {

		// Each block gets its rank in the cascade (grid cards capped so long lists don't drag)
		screenEl.querySelectorAll( '.mode, .mini, .panel, .car-title' ).forEach( ( el, i ) => el.style.setProperty( '--i', i ) );
		screenEl.querySelectorAll( '.card, .car-grid button' ).forEach( ( el, i ) => el.style.setProperty( '--i', Math.min( i, 12 ) ) );

		for ( const el of [ screenEl, crumbsEl ] ) {

			el.classList.remove( 'enter' );
			void el.offsetWidth;
			el.classList.add( 'enter' );

		}

	}

	if ( current.after ) current.after( current );

}

let shownFloat = null; // the screen's popup last drawn (its title)

// To another screen: in the same place, the screen wipe; to another place,
// the screen's panels go, the scene folds away and the next screen comes in
// as the new place unfolds
let moving = false;

function navigate( target, change, dir = 1 ) {

	if ( moving ) return;

	if ( placeOf( target ) === placeOf( stack[ stack.length - 1 ] ) ) {

		// Between screens shown on the home's walls (home ↔ Solo): the walls' items
		// slide (Showroom.swapWalls), no wipe over the screen
		if ( WALL_SCREENS.includes( target ) && WALL_SCREENS.includes( stack[ stack.length - 1 ] ) ) {

			wallDir = dir;
			change();
			render( true );
			return;

		}

		// Walls ↔ a panel screen: the walls' items slide off and the panel comes up
		// from below (back: the panel goes down, the walls come from above)
		if ( [ target, stack[ stack.length - 1 ] ].some( ( n ) => PANEL_SCREENS.includes( n ) ) && ! fx.reduced ) {

			slideTo( change, dir );
			return;

		}

		fx.transition( () => {

			change();
			render( true );

		}, dir );
		return;

	}

	moving = true;
	for ( const el of [ screenEl, crumbsEl ] ) el.classList.add( 'leaving' );
	showroom.walls?.show( false );
	if ( [ target, stack[ stack.length - 1 ] ].some( ( n ) => placeOf( n ) === 'garage' ) ) ui.woosh(); // to and from the garage: calibrated on the travelling (the same both ways), which starts in goTo
	showroom.goTo( placeOf( target ), { walls: target === 'home' } ).then( () => {

		moving = false;
		change();
		for ( const el of [ screenEl, crumbsEl ] ) el.classList.remove( 'leaving' );
		render( true );

	} );

}

// SLIDE's curve for the Web Animations API (CSS linear() through samples of it);
// skip = the share left out at its start (its wind-up)
const slideEasing = ( skip = 0 ) => 'linear(' + Array.from( { length: 41 }, ( _, i ) => SLIDE.ease( skip + i / 40 * ( 1 - skip ) ).toFixed( 4 ) ).join( ', ' ) + ')';
const panelsOf = () => [ ...screenEl.querySelectorAll( '.panel' ), crumbsEl ];

async function slideTo( change, dir ) {

	moving = true;
	const off = ( d ) => `0 ${ d * 110 }vh`; // CSS translate: off the screen, above (-1) or below (1)

	// What goes: the walls' items (Showroom) or this screen's panels, up going forward, down going back
	const out = panelsOf().filter( ( el ) => el.getClientRects().length ); // shown (the panels are fixed: no offsetParent)
	const gone = out.length && PANEL_SCREENS.includes( stack[ stack.length - 1 ] )
		? new Promise( ( resolve ) => {

			for ( const el of out ) el.animate( [ { translate: '0 0' }, { translate: off( - dir ) } ], { duration: SLIDE.out * 1000, easing: slideEasing(), fill: 'forwards' } );
			setTimeout( resolve, SLIDE.out * 1000 * 0.62 ); // ≈ SLIDE.gone of the way: off the screen, the rush past it

		} )
		: showroom.slideWallsOff( dir );
	await gone;

	moving = false;
	change();
	render( false );
	crumbsEl.getAnimations().forEach( ( a ) => a.cancel() ); // the top bar stays: its slide out held it off the screen
	// What comes: a panel screen's panels from the other side (the walls come back by themselves: setWalls)
	if ( PANEL_SCREENS.includes( stack[ stack.length - 1 ] ) ) {

		for ( const el of panelsOf() ) el.animate( [ { translate: off( dir ) }, { translate: '0 0' } ], { duration: SLIDE.in * 1000, easing: slideEasing( SLIDE.skip ) } );

	}

}

function go( name ) {

	navigate( name, () => stack.push( name ) );

}

function back() {

	if ( ! popEl.hidden ) return closePseudo();
	if ( stack.length < 2 ) return;
	if ( stack[ stack.length - 1 ] === 'lobby' ) return multi.leave();

	navigate( stack[ stack.length - 2 ], () => stack.pop(), - 1 );

}

function act( a ) {

	if ( multi.act( a ) ) return;
	if ( a === 'back' ) back();
	else if ( a === 'editor' ) leave( 'editor.html' );
	else if ( a.startsWith( 'theme:' ) ) {

		setThemeSeason( settings, a.slice( 6 ) );
		save();
		showroom.setSeason( settings.rally.season ); // the stages are dressed that way too
		render(); // the outline moves, the photo on the left fades to it

	}
	else if ( a.startsWith( 'drive:' ) ) {

		const item = findItem( a.slice( 6 ) );
		if ( item ) play( item.query );

	} else if ( a === 'page-next' || a === 'page-prev' ) {

		circuitPage += a === 'page-next' ? 1 : - 1;
		render();

	}
	else if ( a === 'profile' ) profileEl.click(); // the home's account card and music icon:
	else if ( a === 'music' ) musicEl.click(); // the top bar's buttons, hidden there
	else if ( a === 'season' ) {

		showroom.nextHomeSeason();
		setThemeSeason( settings, showroom.seasonId );
		save();

	}
	else if ( a === 'new-circuit' ) leave( 'editor.html?new' );
	else if ( a === 'play' ) {

		const item = findItem( selectedKey );
		if ( item ) play( item.query );

	} else if ( a === 'dice' ) {

		rallySeed = randomSeed();
		render();

	} else if ( a === 'rally' ) {

		const rally = introRally ? INTRO_RALLY : settings.rally;
		const q = new URLSearchParams( { rally: rallySeed } );
		if ( rally.length ) q.set( 'length', rally.length );
		if ( rally.landscape !== 'varied' ) q.set( 'landscape', rally.landscape );
		if ( settings.rally.season && settings.rally.season !== 'summer' ) q.set( 'season', settings.rally.season );
		endIntroRally();
		play( q.toString() );

	} else if ( a === 'daily-go' ) {

		if ( challenge.kind === 'circuit' ) play( ( challenge.id === 'default' ? '' : 'circuit=' + challenge.id + '&' ) + 'daily=1' );
		else play( new URLSearchParams( { rally: challenge.seed, length: challenge.length, landscape: challenge.landscape, daily: 1 } ).toString() );

	} else if ( a === 'reset-keys' ) {

		settings.keys = JSON.parse( JSON.stringify( DEFAULT_KEYS ) );
		binding = null;
		save();
		render();

	} else if ( a.startsWith( 'edit:' ) ) leave( 'editor.html?local=' + encodeURIComponent( a.slice( 5 ) ) );
	else if ( a.startsWith( 'copy:' ) ) leave( 'editor.html?circuit=' + a.slice( 5 ) );
	else if ( a.startsWith( 'star:' ) ) star( a.slice( 5 ) );

}

document.addEventListener( 'click', ( e ) => {

	const el = e.target.closest( 'button' );
	if ( ! el || el.disabled ) return;
	ui.clicked();

	if ( el.dataset.go ) return go( el.dataset.go );

	// Garage: a swatch picks its livery (the car names are CarWheel's)
	if ( el.dataset.livery ) return chooseCar( settings.car, Number( el.dataset.livery ) );

	if ( el.dataset.tab ) {

		circuitTab = el.dataset.tab;
		selectedKey = null;
		circuitPage = 0;
		return render();

	}

	if ( el.dataset.ltab ) {

		legalTab = el.dataset.ltab;
		legalTabChanged = true;
		return render();

	}

	if ( el.dataset.stab ) {

		settingsTab = el.dataset.stab;
		settingsTabChanged = true;
		binding = null;
		return render();

	}

	if ( el.dataset.bind ) {

		const [ action, slot ] = el.dataset.bind.split( ':' );
		binding = { action, slot: Number( slot ) };
		return render();

	}

	if ( el.dataset.toggle ) {

		const key = el.dataset.toggle;

		if ( key === 'dof' ) {

			settings.dof.on = ! settings.dof.on;
			showroom.setDofSettings( settings.dof );

		} else if ( key === 'music' ) {

			settings.music = settings.music === false;
			music.setEnabled( settings.music );
			renderMusic();

		} else settings[ key ] = ! settings[ key ];

		save();
		return render();

	}

	if ( el.dataset.pick ) {

		selectedKey = el.dataset.pick;
		return render();

	}

	if ( el.dataset.set ) {

		const { set, value } = el.dataset;

		if ( set === 'car' ) {

			settings.car = value;
			const car = findCar( value );
			if ( settings.color > car.liveries ) settings.color = 1;

		} else if ( set === 'color' ) settings.color = Number( value );
		else if ( set === 'ghost' ) settings.ghost = ghostMode( value );
		else if ( set === 'graphics' ) setGraphics( value );
		else if ( set === 'view' ) settings.view = value === 'chase' ? 'chase' : 'iso';
		else if ( set === 'length' ) { endIntroRally(); settings.rally.length = Number( value ); }
		else if ( set === 'landscape' ) { endIntroRally(); settings.rally.landscape = landscapeOf( value ); }
		else if ( set === 'season' ) {

			setThemeSeason( settings, value );
			showroom.setSeason( value ); // the backdrop turns to that season

		}

		save();
		if ( set === 'car' || set === 'color' ) showroom.setCar( settings.car, settings.color );
		return render();

	}

	if ( el.dataset.act ) act( el.dataset.act );

} );

screenEl.addEventListener( 'input', ( e ) => {

	if ( e.target.id === 'seed' ) e.target.value = e.target.value.replace( /[^0-9]/g, '' ).slice( 0, 7 );

	// Depth of field strength: live on the menu backdrop
	if ( e.target.dataset.range === 'dof' ) {

		const v = Number( e.target.value );
		settings.dof.strength = v;
		e.target.style.setProperty( '--v', v + '%' );
		e.target.nextElementSibling.textContent = t( 'settings.percent', { v } );
		showroom.setDofSettings( settings.dof );

	}

	// Volume sliders: live, without re-rendering (the drag goes on)
	const kind = e.target.dataset.volume;

	if ( kind ) {

		const v = Number( e.target.value );
		settings.volume[ kind ] = v / 100;
		e.target.style.setProperty( '--v', v + '%' );
		e.target.nextElementSibling.textContent = t( 'settings.percent', { v } );
		if ( kind === 'music' ) music.setVolume( v / 100 );

	}

} );

// The community search box (topbar, outside screenEl): filters live, no
// full render (that would rebuild #screen and drop the input's focus)
searchInputEl.addEventListener( 'input', () => {

	circuitSearch = searchInputEl.value;
	circuitPage = 0;
	if ( showroom.walls ) showroom.swapWalls( circuitWall(), 1, true );

} );

// Re-render only when leaving the field, so typing keeps the focus
screenEl.addEventListener( 'change', ( e ) => {

	if ( e.target.dataset.range ) save();

	if ( e.target.dataset.volume ) {

		save();
		preview( e.target.dataset.volume );
		return;

	}

	if ( e.target.id === 'seed' ) {

		rallySeed = e.target.value || randomSeed();
		render();

	}

} );

window.addEventListener( 'keydown', ( e ) => {

	if ( e.key === 'Enter' && e.target.id === 'lobby-code' ) return multi.act( 'multi-join' );
	if ( e.key === 'Enter' && e.target.id === 'lobby-name' ) return multi.act( 'multi-create-go' );
	if ( e.code === 'Escape' && ( e.target.tagName !== 'INPUT' || ! popEl.hidden ) ) back();

} );

// ─── Profile: Google account and pseudo ───────────────────

const pseudoInput = document.getElementById( 'pseudo' );
const pseudoNote = document.getElementById( 'pseudo-note' );

// The account as the profile button and the home's card say it
function accountText() {

	const initial = player.name ? player.name[ 0 ].toUpperCase() : player.signedIn ? '?' : '→';
	if ( player.offline ) return { initial, title: t( 'account.offline' ), sub: t( 'account.retry' ) };
	if ( ! player.signedIn ) return { initial, title: t( 'account.signIn' ), sub: t( 'account.withGoogle' ) };
	if ( ! player.name ) return { initial, title: t( 'account.choosePseudo' ), sub: t( 'account.googleAccount' ) };
	return { initial, title: player.name, sub: t( 'account.online' ) };

}

function renderProfile() {

	const { initial, title, sub } = accountText();
	profileEl.querySelector( '.avatar' ).textContent = initial;
	profileEl.querySelector( '.who' ).innerHTML = `${ escapeHtml( title ) }<small>${ sub }</small>`;

}

function openPseudo( note = t( 'account.pseudoNote' ), error = false ) {

	if ( popEl.hidden ) ui.popup();
	popEl.hidden = false;
	for ( const row of popEl.querySelectorAll( '.row' ) ) row.hidden = false;
	pseudoInput.value = player.name;
	pseudoNote.textContent = note;
	pseudoNote.className = error ? 'note error' : 'note';
	pseudoInput.focus();

}

function closePseudo() {

	popEl.hidden = true;

}

async function savePseudo() {

	const name = pseudoInput.value.normalize( 'NFKC' ).trim().replace( /\s+/g, ' ' );

	if ( ! isValidName( name ) ) {

		pseudoNote.textContent = name === '' ? t( 'account.pseudoEmpty' ) : t( 'account.pseudoRule' );
		pseudoNote.className = 'note error';
		return;

	}

	const r = await setPseudo( name );

	if ( ! r.ok ) {

		pseudoNote.textContent = r.status === 401 ? t( 'account.expired' ) : r.error;
		pseudoNote.className = 'note error';
		return;

	}

	player.name = r.data.pseudo;
	renderProfile();
	closePseudo();
	render();

}

function showAuthMessage( text ) {

	if ( popEl.hidden ) ui.popup();
	popEl.hidden = false;
	for ( const row of popEl.querySelectorAll( '.row' ) ) row.hidden = true; // just the message
	pseudoNote.textContent = text;
	pseudoNote.className = 'note error';

}

profileEl.addEventListener( 'click', async () => {

	if ( player.offline ) return loadAccount( true );

	if ( ! player.signedIn ) {

		const r = await signIn();
		if ( ! r.ok ) showAuthMessage( r.error || t( 'account.signInFailed' ) );
		return;

	}

	location.href = 'site.html#profile';

} );
document.getElementById( 'pseudo-save' ).addEventListener( 'click', savePseudo );
document.getElementById( 'sign-out' ).addEventListener( 'click', async () => {

	await signOut();
	location.reload();

} );
pseudoInput.addEventListener( 'keydown', ( e ) => { if ( e.key === 'Enter' ) savePseudo(); } );

async function loadAccount( refresh = false ) {

	const account = await getAccount( { refresh } );
	player.offline = account?.error ?? null;
	player.signedIn = account !== null && ! account.error;
	player.name = account?.pseudo || '';
	renderProfile();
	render();
	if ( player.offline && refresh ) showAuthMessage( t( 'account.offlineWhy', { why: player.offline } ) );
	if ( player.signedIn && ! player.name ) openPseudo( t( 'account.pseudoFirst' ) );

}

loadAccount();

// Back from Google with an error (?error=…): say it once, then clean the address
if ( authError ) {

	showAuthMessage( authError );
	history.replaceState( null, '', location.pathname );

}

// ─── Music button ─────────────────────────────────────────

const musicEl = document.getElementById( 'music' );

function renderMusic() {

	const on = settings.music !== false;
	musicEl.classList.toggle( 'off', ! on );
	musicEl.setAttribute( 'aria-pressed', on );
	musicEl.title = on ? t( 'music.mute' ) : t( 'music.unmute' );

}

musicEl.addEventListener( 'click', () => {

	// The first click anywhere already started the music: don't cut it straight away
	if ( settings.music !== false && ! music.playing ) return music.start();
	settings.music = settings.music === false;
	save();
	music.setEnabled( settings.music );
	renderMusic();
	if ( stack[ stack.length - 1 ] === 'settings' ) render(); // the Son tab shows it too

} );

// ─── Tilt: cards lean towards the pointer ─────────────────

let tilted = null;

document.addEventListener( 'pointermove', ( e ) => {

	const el = e.target.closest( '.mode:not(:disabled), .mini, .card' );

	if ( tilted && tilted !== el ) {

		tilted.style.removeProperty( '--rx' );
		tilted.style.removeProperty( '--ry' );

	}

	tilted = el;
	if ( ! el ) return;

	const r = el.getBoundingClientRect();
	const x = ( e.clientX - r.left ) / r.width - 0.5, y = ( e.clientY - r.top ) / r.height - 0.5;
	el.style.setProperty( '--rx', ( - y * 8 ).toFixed( 2 ) + 'deg' );
	el.style.setProperty( '--ry', ( x * 10 ).toFixed( 2 ) + 'deg' );
	el.style.setProperty( '--mx', ( ( x + 0.5 ) * 100 ).toFixed( 1 ) + '%' );

} );

// ─── Beat loop ────────────────────────────────────────────

function beatLoop() {

	beatInfo = music.info();
	fx.pulse( beatInfo.kick );
	showroom.walls?.setLive( { music: settings.music !== false, kick: beatInfo.kick, season: showroom.sets?.home?.seasonId } );
	requestAnimationFrame( beatLoop );

}

renderProfile();
renderMusic();
render( true );
multi.resume();
beatLoop();
pollOnline();
setInterval( pollOnline, 20000 );
document.body.classList.toggle( 'low', !! settings.performance );
showroom.setDofSettings( settings.dof );
showroom.setGraphics( settings.graphics );
