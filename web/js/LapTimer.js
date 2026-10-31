import * as THREE from 'three';
import { CELL_RAW, GRID_SCALE, TRACK_CELLS, TYPE_NAMES, computeSpawnPosition } from './Track.js';
import { createLapCounter } from './LapCheck.js';
import { t } from './i18n.js';
import { useHudTheme, HUD_GOOD, HUD_BAD, HUD_TEXT } from './HudTheme.js';
import { trackLap } from './Stats.js';

const FINISH = TYPE_NAMES[ 3 ];
// v2: times since the fixed physics step (older ones depended on the frame rate)
const STORAGE_PREFIX = 'racing.bestLap2.';

function loadBest( key ) {

	try {

		const v = localStorage.getItem( key );
		const n = v !== null ? Number( v ) : NaN;
		return Number.isFinite( n ) ? n : null;

	} catch {

		return null;

	}

}

function saveBest( key, value ) {

	try {

		localStorage.setItem( key, String( value ) );

	} catch {}

}

function formatTime( t ) {

	if ( t === null || t === undefined ) return '0:00.000';

	// Whole milliseconds first, so 59.9996 s shows 1:00.000, not 0:60.000
	const ms = Math.round( t * 1000 );
	const m = Math.floor( ms / 60000 );
	return `${ m }:${ ( ( ms - m * 60000 ) / 1000 ).toFixed( 3 ).padStart( 6, '0' ) }`;

}

// Lap config for grid tracks: every non-finish cell is a checkpoint
export function gridLapConfig( cells ) {

	const list = cells || TRACK_CELLS;
	if ( ! list.some( ( c ) => c[ 2 ] === FINISH ) ) return null;

	const spawn = computeSpawnPosition( list );
	const cellSize = CELL_RAW * GRID_SCALE;
	const required = new Set();

	for ( const c of list ) {

		if ( c[ 2 ] !== FINISH ) required.add( c[ 0 ] + ',' + c[ 1 ] );

	}

	return {
		center: [ spawn.position[ 0 ], spawn.position[ 2 ] ],
		angle: spawn.angle,
		halfWidth: cellSize * 0.5,
		checkpointCount: required.size,
		checkpointAt( p ) {

			const key = Math.floor( p.x / cellSize ) + ',' + Math.floor( p.z / cellSize );
			return required.has( key ) ? key : null;

		},
	};

}

export class LapTimer {

	constructor( config, trackId ) {

		this.storageKey = STORAGE_PREFIX + ( trackId || 'default' );
		this.lap = 1;
		this.bestLap = loadBest( this.storageKey );
		this.lastLap = null;
		this.currentLapTime = 0;
		this.running = false;
		this.waitLine = false; // flying restart: the clock starts at the line

		// onLap( time, ranked ) fires when a valid lap ends, before the clock restarts
		this.onLap = null;
		// excludeLap() → true: this lap is not kept (best time, leaderboard)
		this.excludeLap = null;

		this.config = config;
		this.enabled = config !== null;
		// Start line and checkpoints: the same rule as the server's lap checks
		this.counter = this.enabled ? createLapCounter( config ) : null;

		if ( this.enabled ) {

			this.buildUI();

		}

	}

	buildUI() {

		useHudTheme();

		const placeholder = formatTime( null );
		const el = document.createElement( 'div' );
		el.id = 'lap-timer';
		el.className = 'hud-timer hud-float';
		el.innerHTML =
			`<div class="head">${ t( 'hud.lap' ) } <span class="lap">1</span></div>` +
			`<div class="time hud-num">${ placeholder }</div>` +
			'<div class="rows">' +
			`<div class="row"><span class="hud-label">${ t( 'hud.best' ) }</span><b class="best">${ formatTime( this.bestLap ) }</b><small></small></div>` +
			`<div class="row"><span class="hud-label">${ t( 'hud.last' ) }</span><b class="last">${ placeholder }</b><small></small></div>` +
			`<div class="row record" hidden><span class="hud-label">${ t( 'hud.record' ) }</span><b class="record-time"></b><small class="record-name"></small></div>` +
			'<div class="row tas" hidden><span class="hud-label">TAS</span><b class="tas-time"></b><small></small></div>' +
			'</div>' +
			'<div class="note"></div>';
		document.body.appendChild( el );

		this.lapEl = el.querySelector( '.lap' );
		this.currentEl = el.querySelector( '.time' );
		this.lastEl = el.querySelector( '.last' );
		this.bestEl = el.querySelector( '.best' );
		this.recordRow = el.querySelector( '.record' );
		this.recordTimeEl = el.querySelector( '.record-time' );
		this.recordNameEl = el.querySelector( '.record-name' );
		this.noteEl = el.querySelector( '.note' );
		this.tasRow = el.querySelector( '.tas' );
		this.tasTimeEl = el.querySelector( '.tas-time' );

	}

	update( dt, position, hasInput ) {

		if ( ! this.enabled ) return;

		if ( this.waitLine ) {

			this.counter.feed( position.x, position.z );
			if ( this.counter.crossed() ) {

				this.waitLine = false;
				this.running = true;

			}
			return;

		}

		if ( ! this.running && ! hasInput ) return;
		this.running = true;

		this.currentLapTime += dt;

		if ( this.counter.feed( position.x, position.z ) ) this.completeLap();

	}

	// Once per drawn frame: the clock text, written only when it changes
	// (update runs at the physics rate, several times per frame)
	render() {

		if ( ! this.enabled ) return;
		const text = formatTime( this.currentLapTime );
		if ( text !== this.shownTime ) {

			this.currentEl.textContent = text;
			this.shownTime = text;

		}

	}

	// Quick restart (main.js): the lap under way is dropped; flying = the car
	// comes from before the line and the clock starts there, else it starts
	// at the first input as at the start of the race
	restart( flying ) {

		if ( ! this.enabled ) return;
		this.counter.reset();
		this.currentLapTime = 0;
		this.running = false;
		this.waitLine = flying;

	}

	// Lap clock of the current lap, null before the first input
	lapTime() {

		return this.running ? this.currentLapTime : null;

	}

	// World record of this circuit (online leaderboard), null to hide
	setRecord( record ) {

		if ( ! this.enabled ) return;
		this.recordRow.hidden = ! record;
		this.recordTimeEl.textContent = record ? formatTime( record.time ) : '';
		this.recordNameEl.textContent = record ? record.name : '';

	}

	// Computed best lap of this circuit (target), null to hide
	setTas( time ) {

		if ( ! this.enabled ) return;
		this.tasRow.hidden = time === null;
		this.tasTimeEl.textContent = time === null ? '' : formatTime( time );

	}

	// Short message under the timer (leaderboard result), cleared after a while
	setNote( text, duration = 6000 ) {

		if ( ! this.enabled ) return;
		this.noteEl.textContent = text;
		clearTimeout( this.noteTimer );
		if ( duration ) this.noteTimer = setTimeout( () => { this.noteEl.textContent = ''; }, duration );

	}

	completeLap() {

		trackLap();

		// A lap driven with the secret accelerator is shown but never kept
		const ranked = ! ( this.excludeLap && this.excludeLap() );
		if ( this.onLap ) this.onLap( this.currentLapTime, ranked );
		if ( ! ranked ) this.setNote( t( 'circuit.boostedLap' ) );

		const isBest = ranked && ( this.bestLap === null || this.currentLapTime < this.bestLap );

		this.lastLap = this.currentLapTime;
		if ( isBest ) {

			this.bestLap = this.currentLapTime;
			saveBest( this.storageKey, this.bestLap );

		}
		this.lap += 1;
		this.currentLapTime = 0;

		this.lapEl.textContent = this.lap;
		this.lastEl.textContent = formatTime( this.lastLap );
		this.bestEl.textContent = formatTime( this.bestLap );

		const color = isBest ? HUD_GOOD : HUD_BAD;
		this.currentEl.animate(
			[ { color }, { color }, { color: HUD_TEXT } ],
			{ duration: 1200, easing: 'ease-out' }
		);

	}

}
