// Playing with a gamepad (standard mapping). Driving itself is read by
// Controls.js (left stick / d-pad, RT / LT, A, B / RB, Y); this module covers
// everything around it, so the whole game can be played without a keyboard:
//   - menus (main menu, pause, arrival screen): d-pad or left stick moves the
//     focus to the nearest button in that direction, A clicks it, B goes back
//     (an Escape key press: the pages already handle it)
//   - extra buttons for the page (`buttons`: index → function on the press),
//     e.g. Start = pause, Back = put back on the road in the game
// A toast says when a pad shows up. Polled once per animation frame, only
// once a pad has been seen (navigator.getGamepads() can be slow, Controls.js).

import { t } from './i18n.js';

export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const STICK = 0.6;        // left stick past this = a direction
const REPEAT_FIRST = 380; // ms held before a direction repeats
const REPEAT_NEXT = 140;  // ms between repeats
const REFOCUS = 15000;    // ms: the pad used this recently, a new screen gets a focused button
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])';

let styled = false;

function style() {

	if ( styled ) return;
	styled = true;
	const css = document.createElement( 'style' );
	css.textContent = `
		.pad-focus { outline: 3px solid #e8590c !important; outline-offset: 3px !important; }
		.pad-toast { position: fixed; left: 50%; bottom: 28px; z-index: 2000; transform: translate(-50%, 20px); padding: 11px 20px; border-radius: 999px;
			background: rgba(255, 255, 255, 0.95); color: #1f2430; box-shadow: 0 18px 50px rgba(20, 24, 36, 0.22);
			font: 800 14px 'text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; letter-spacing: var(--track, -0.04em); opacity: 0; pointer-events: none;
			transition: opacity 0.25s, transform 0.25s; white-space: nowrap; }
		.pad-toast.on { opacity: 1; transform: translate(-50%, 0); }
		.pad-toast b { color: #e8590c; font-weight: 900; }
	`;
	document.head.appendChild( css );

}

function visible( el ) {

	if ( ! el.getClientRects().length ) return false;
	for ( let e = el; e; e = e.parentElement ) {

		const s = getComputedStyle( e );
		if ( s.visibility === 'hidden' || s.display === 'none' || Number( s.opacity ) === 0 ) return false;

	}

	return true;

}

export class GamepadUI {

	// navActive(): whether the d-pad / stick / A / B drive the menus now
	// (in the game: only while an overlay is open); root(): where to look for
	// buttons (the open overlay, else the page); buttons: { index: fn };
	// hint: the toast's text on connection (HTML)
	constructor( { navActive = () => true, root = () => document, buttons = {}, hint = '' } = {} ) {

		this.navActive = navActive;
		this.root = root;
		this.buttons = buttons;
		this.hint = hint;
		this.pressed = [];
		this.held = null; // { dir, next } the direction held, when it repeats
		this.focused = null;
		this.pads = 0;

		window.addEventListener( 'gamepadconnected', () => {

			this.pads ++;
			this.toast( '🎮 ' + t( 'pad.connected' ) + ( this.hint ? ' · ' + this.hint : '' ) );
			if ( this.pads === 1 ) this.poll();

		} );
		window.addEventListener( 'gamepaddisconnected', () => {

			this.pads = Math.max( 0, this.pads - 1 );
			if ( ! this.pads ) this.toast( t( 'pad.disconnected' ) );

		} );

	}

	toast( html ) {

		style();
		if ( ! this.toastEl ) {

			this.toastEl = document.createElement( 'div' );
			this.toastEl.className = 'pad-toast';
			document.body.appendChild( this.toastEl );

		}

		this.toastEl.innerHTML = html;
		this.toastEl.classList.add( 'on' );
		clearTimeout( this.toastTimer );
		this.toastTimer = setTimeout( () => this.toastEl.classList.remove( 'on' ), 3200 );

	}

	poll() {

		if ( ! this.pads ) return;
		requestAnimationFrame( () => this.poll() );

		const pad = [ ...navigator.getGamepads() ].find( ( p ) => p && p.connected );
		if ( ! pad ) return;

		const now = performance.now();
		if ( pad.buttons.some( ( b ) => b.pressed ) || pad.axes.some( ( v ) => Math.abs( v ) > STICK ) ) this.lastUse = now;
		const down = ( i ) => !! pad.buttons[ i ]?.pressed;
		const press = ( i ) => {

			const was = this.pressed[ i ];
			this.pressed[ i ] = down( i );
			return this.pressed[ i ] && ! was;

		};

		for ( const i in this.buttons ) if ( press( Number( i ) ) ) this.buttons[ i ]();

		const nav = this.navActive();
		const a = press( PAD.A ), b = press( PAD.B );

		if ( ! nav ) {

			this.held = null;
			this.clearFocus();
			return;

		}

		// Direction: d-pad or left stick, repeating while held
		const ax = pad.axes[ 0 ] || 0, ay = pad.axes[ 1 ] || 0;
		const dir = down( PAD.UP ) || ay < - STICK ? 'up' : down( PAD.DOWN ) || ay > STICK ? 'down'
			: down( PAD.LEFT ) || ax < - STICK ? 'left' : down( PAD.RIGHT ) || ax > STICK ? 'right' : null;

		if ( ! dir ) this.held = null;
		else if ( ! this.held || this.held.dir !== dir ) {

			this.held = { dir, next: now + REPEAT_FIRST };
			this.move( dir );

		} else if ( now >= this.held.next ) {

			this.held.next = now + REPEAT_NEXT;
			this.move( dir );

		}

		if ( a ) {

			const el = this.current();
			if ( el ) el.click();
			else this.move( null );

		}

		if ( b ) window.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', code: 'Escape', bubbles: true } ) );

		// A new screen (the menu redraws, an overlay opens) while playing with
		// the pad: a button is focused straight away
		if ( ! dir && ! a && ! b && now - ( this.lastUse || - Infinity ) < REFOCUS && ! this.current() ) this.move( null );

	}

	// The buttons that can take the focus now
	candidates() {

		const root = this.root() || document;
		return [ ...root.querySelectorAll( FOCUSABLE ) ].filter( visible );

	}

	current() {

		const el = document.activeElement;
		return el && el !== document.body && this.candidates().includes( el ) ? el : null;

	}

	// Focus the nearest button in direction dir (null: a default one)
	move( dir ) {

		const list = this.candidates();
		if ( ! list.length ) return;
		const from = this.current();
		let best = null;

		if ( ! from || ! dir ) {

			best = list.find( ( el ) => el.matches( '.on, .primary, .go, [autofocus]' ) ) || list[ 0 ];

		} else {

			const r = from.getBoundingClientRect();
			const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
			const [ dx, dy ] = { up: [ 0, - 1 ], down: [ 0, 1 ], left: [ - 1, 0 ], right: [ 1, 0 ] }[ dir ];
			let score = Infinity;

			for ( const el of list ) {

				if ( el === from ) continue;
				const q = el.getBoundingClientRect();
				const ex = q.left + q.width / 2 - cx, ey = q.top + q.height / 2 - cy;
				const along = ex * dx + ey * dy;
				if ( along <= 4 ) continue; // not in that direction
				const across = Math.abs( ex * dy - ey * dx );
				const s = along + across * 2.5;

				if ( s < score ) {

					score = s;
					best = el;

				}

			}

		}

		if ( best ) this.focus( best );

	}

	focus( el ) {

		style();
		this.clearFocus();
		el.focus( { preventScroll: true, focusVisible: true } );
		el.scrollIntoView( { block: 'nearest', inline: 'nearest' } );
		el.classList.add( 'pad-focus' );
		this.focused = el;
		el.addEventListener( 'blur', () => el.classList.remove( 'pad-focus' ), { once: true } );

	}

	clearFocus() {

		if ( this.focused ) this.focused.classList.remove( 'pad-focus' );
		this.focused = null;

	}

}
