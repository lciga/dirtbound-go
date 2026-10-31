// In-game overlays: pause menu (Escape / the pause key of the settings / the corner button) and the
// arrival screen of a limited rally stage. Buttons call back into main.js.

import { formatTime, loadSettings } from './Settings.js';
import { t } from './i18n.js';
import { useHudTheme } from './HudTheme.js';

const GHOST_LABELS = { off: t( 'pause.ghostOff' ), record: t( 'pause.ghostRecord' ), tas: 'TAS' };
const CAMERA_VIEWS = [ 'iso', 'chase' ];

const CSS = `
	.ui-corner {
		position: absolute; top: 24px; right: 24px; z-index: 20;
		width: 46px; height: 46px; border-radius: 50%; border: 0; padding: 0;
		background: var(--card); box-shadow: var(--shadow-small);
		display: grid; place-items: center; cursor: pointer; transition: background 0.12s;
	}
	.ui-corner:hover { background: #fff; }
	@media (pointer: fine) { .ui-corner { display: none; } } /* a touch screen has no Escape key */
	.ui-corner span { display: block; width: 5px; height: 16px; background: var(--ink); border-radius: 2px; box-shadow: 8px 0 0 var(--ink); margin-left: -8px; }
	.ui-camera-switch { position: absolute; top: 24px; right: 24px; z-index: 21; max-width: calc(100vw - 250px);
		border: 0; border-radius: 14px; padding: 12px 16px; background: var(--card); color: var(--ink); box-shadow: var(--shadow-small); font: 900 14px var(--text); cursor: pointer; }
	.ui-camera-switch.multiplayer { top: 130px; }
	.ui-camera-switch:disabled { cursor: default; }
	.ui-camera-switch:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
	@media (pointer: coarse) { .ui-camera-switch { right: 84px; } }
	.ui-start-countdown { position: absolute; inset: 0; z-index: 25; display: grid; place-items: center; pointer-events: none;
		color: var(--accent-light); font: clamp(64px, 14vw, 150px)/1 var(--brand); text-shadow: var(--lift); text-transform: uppercase; }
	.ui-start-countdown[hidden] { display: none; }
	.ui-camera-label { margin-top: 8px; font-size: 13px; color: var(--muted); }
	.ui-camera-options { display: flex; gap: 6px; }
	.ui-card .ui-camera-options button { flex: 1; padding: 12px 8px; font-size: 14px; text-align: center; }
	.ui-card .ui-camera-options button[aria-pressed=true] { background: var(--ink); color: #fff; }
	.ui-card .ui-camera-options button:disabled { cursor: default; opacity: 0.6; }
	.ui-overlay {
		position: absolute; inset: 0; z-index: 30; display: none;
		align-items: center; justify-content: center;
		background: rgba(20, 24, 36, 0.45);
		backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
	}
	.ui-overlay.open { display: flex; }
	.ui-card {
		width: 340px; padding: 24px; border-radius: var(--radius);
		background: var(--card); color: var(--ink); box-shadow: var(--shadow);
		display: flex; flex-direction: column; gap: 8px;
	}
	.ui-card h2 { margin: 0 0 8px; font: 46px/1 var(--brand); color: var(--accent); text-transform: uppercase; letter-spacing: 0; }
	.ui-card .big { font-size: 48px; line-height: 1.05; margin: 0; }
	.ui-card .sub { color: var(--muted); font-size: 14px; }
	.ui-card .record { align-self: flex-start; margin: 2px 0 8px; padding: 4px 12px; border-radius: 999px; background: #ffd35c; color: #6b4a00; font-weight: 900; }
	.ui-card .sub + .sub { margin-bottom: 8px; }
	.ui-card button {
		font: inherit; font-weight: 900; border: 0; border-radius: 14px; padding: 13px 16px; cursor: pointer;
		background: var(--soft); color: var(--ink); text-align: left; transition: background 0.12s;
	}
	.ui-card button:hover { background: var(--soft-hover); }
	.ui-card button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
	.ui-card button.primary { padding: 15px 18px; background: var(--accent); color: #fff; font-size: 18px; font-style: italic; text-transform: uppercase; }
	.ui-card button.primary:hover { background: var(--accent-hover); }
`;

export class GameUI {

	// actions: { onPause( paused ), onRestart?, onMenu, onNewStage?, ghost?: { mode(), next() }, performance?: { enabled(), toggle() } }
	constructor( actions ) {

		this.actions = actions;
		this.paused = false;
		this.locked = false; // result screen shown: no pausing over it

		useHudTheme();
		const style = document.createElement( 'style' );
		style.textContent = CSS;
		document.head.appendChild( style );

		const corner = document.createElement( 'button' );
		corner.className = 'ui-corner';
		corner.setAttribute( 'aria-label', t( 'pause.title' ) );
		corner.innerHTML = '<span></span>';
		corner.addEventListener( 'click', () => this.setPaused( ! this.paused ) );
		document.body.appendChild( corner );
		this.corner = corner;
		if ( actions.camera ) {
			this.cameraSwitch = document.createElement( 'button' );
			this.cameraSwitch.className = 'ui-camera-switch' + ( actions.camera.multiplayer ? ' multiplayer' : '' );
			this.cameraSwitch.addEventListener( 'click', () => {
				actions.camera.select( actions.camera.mode() === 'iso' ? 'chase' : 'iso' );
				this.updateCameraControls();
				this.cameraSwitch.blur();
			} );
			document.body.appendChild( this.cameraSwitch );
		}
		this.countdown = document.createElement( 'div' );
		this.countdown.className = 'ui-start-countdown';
		this.countdown.setAttribute( 'role', 'status' );
		this.countdown.setAttribute( 'aria-live', 'assertive' );
		this.countdown.hidden = true;
		document.body.appendChild( this.countdown );

		this.pauseEl = this.overlay(
			`<h2>${ t( 'pause.title' ) }</h2>` +
			`<button class="primary" data-a="resume">${ t( 'pause.resume' ) }</button>` +
			( actions.camera ? `<b class="ui-camera-label">${ t( 'lobby.camera' ) }</b><div class="ui-camera-options" role="group" aria-label="${ t( 'lobby.camera' ) }">` +
				CAMERA_VIEWS.map( ( view ) => `<button data-camera="${ view }">${ t( 'lobby.cameras.' + view ) }</button>` ).join( '' ) + '</div>' : '' ) +
			( actions.ghost ? '<button data-a="ghost"></button>' : '' ) +
			( actions.performance ? `<button data-a="performance">${ t( actions.performance.enabled() ? 'pause.performanceOn' : 'pause.performanceOff' ) }</button>` : '' ) +
			( actions.onRestart ? `<button data-a="restart">${ t( 'pause.restart' ) }</button>` : '' ) +
			`<button data-a="menu">${ t( 'pause.menu' ) }</button>`
		);
		this.updateGhostButton();
		this.updateCameraControls();

		this.resultEl = this.overlay( '' );

		const pauseKeys = loadSettings().keys.pause;

		window.addEventListener( 'keydown', ( e ) => {

			if ( e.code === 'Escape' || pauseKeys.includes( e.code ) ) {

				if ( ! this.locked ) this.setPaused( ! this.paused );
				e.preventDefault();

			}

		} );

	}

	overlay( html ) {

		const el = document.createElement( 'div' );
		el.className = 'ui-overlay';
		el.innerHTML = `<div class="ui-card">${ html }</div>`;
		el.addEventListener( 'click', ( e ) => {
			const cameraView = e.target.closest( 'button[data-camera]' )?.dataset.camera;
			if ( cameraView && this.actions.camera ) {
				this.actions.camera.select( cameraView );
				this.updateCameraControls();
				return;
			}

			const a = e.target.closest( 'button' )?.dataset.a;
			if ( a ) this.act( a );

		} );
		document.body.appendChild( el );
		return el;

	}

	act( a ) {

		if ( a === 'resume' ) this.setPaused( false );
		if ( a === 'restart' && this.actions.onRestart ) this.actions.onRestart();
		if ( a === 'menu' ) this.actions.onMenu();
		if ( a === 'new' ) this.actions.onNewStage();
		if ( a === 'performance' ) this.actions.performance.toggle();
		if ( a === 'ghost' ) {

			this.actions.ghost.next();
			this.updateGhostButton();

		}

	}

	updateGhostButton() {

		const button = this.pauseEl.querySelector( '[data-a="ghost"]' );
		if ( button ) button.textContent = t( 'pause.ghost', { mode: GHOST_LABELS[ this.actions.ghost.mode() ] } );

	}

	updateCameraControls() {
		const camera = this.actions.camera;
		if ( !camera ) return;
		this.cameraSwitch.textContent = t( 'lobby.camera' ) + ': ' + t( 'lobby.cameras.' + camera.mode() );
		this.cameraSwitch.disabled = camera.locked();
		this.cameraSwitch.title = camera.locked() ? t( 'lobby.hostOnly' ) : this.cameraSwitch.textContent;
		for ( const button of this.pauseEl.querySelectorAll( '[data-camera]' ) ) {
			button.setAttribute( 'aria-pressed', String( button.dataset.camera === camera.mode() ) );
			button.disabled = camera.locked();
		}
	}

	setCountdown( label ) {
		if ( this.countdown.textContent !== label ) this.countdown.textContent = label;
		this.countdown.hidden = !label;
	}

	setPaused( paused ) {

		if ( this.locked ) return;
		this.paused = paused;
		this.pauseEl.classList.toggle( 'open', paused );
		if ( paused ) this.pauseEl.querySelector( 'button' ).focus();
		this.actions.onPause( paused );

	}

	// Arrival of a limited stage: time, best, and what next
	showResult( { title, time, best, record, subtitle } ) {

		this.locked = true;
		this.corner.style.display = 'none';

		this.resultEl.querySelector( '.ui-card' ).innerHTML =
			`<h2>${ title }</h2>` +
			`<div class="big hud-num">${ formatTime( time ) }</div>` +
			`<div class="sub">${ subtitle }</div>` +
			( record ? `<div class="record">${ t( 'result.newRecord' ) }</div>` : `<div class="sub">${ t( 'result.record', { time: formatTime( best ) } ) }</div>` ) +
			`<button class="primary" data-a="restart">${ t( 'result.again' ) }</button>` +
			( this.actions.onNewStage ? `<button data-a="new">${ t( 'result.newStage' ) }</button>` : '' ) +
			`<button data-a="menu">${ t( 'pause.menu' ) }</button>`;

		this.resultEl.classList.add( 'open' );
		this.resultEl.querySelector( 'button' ).focus();

	}

}
