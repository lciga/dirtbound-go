// In-game overlays: pause menu (Escape / the pause key of the settings / the corner button) and the
// arrival screen of a limited rally stage. Buttons call back into main.js.

import { formatTime, loadSettings } from './Settings.js';
import { t } from './i18n.js';
import { useHudTheme } from './HudTheme.js';

const GHOST_LABELS = { off: t( 'pause.ghostOff' ), record: t( 'pause.ghostRecord' ), tas: 'TAS' };

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

		this.pauseEl = this.overlay(
			`<h2>${ t( 'pause.title' ) }</h2>` +
			`<button class="primary" data-a="resume">${ t( 'pause.resume' ) }</button>` +
			( actions.ghost ? '<button data-a="ghost"></button>' : '' ) +
			( actions.performance ? `<button data-a="performance">${ t( actions.performance.enabled() ? 'pause.performanceOn' : 'pause.performanceOff' ) }</button>` : '' ) +
			( actions.onRestart ? `<button data-a="restart">${ t( 'pause.restart' ) }</button>` : '' ) +
			`<button data-a="menu">${ t( 'pause.menu' ) }</button>`
		);
		this.updateGhostButton();

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
