// The controls, shown at the start of every race (main.js), bottom of the
// screen: for the device in hand (touch, gamepad, else the keyboard with the
// player's own keys, menu Paramètres → Contrôles). Goes a moment after the car
// sets off, or after SHOW s.

import { keyLabel, layoutReady } from './KeyNames.js';
import { t } from './i18n.js';
import { useHudTheme } from './HudTheme.js';

const SHOW = 8; // s on screen at most
const AFTER_START = 1.5; // s left once the player accelerates

const CSS = `
	#controls-hint { position: fixed; left: 50%; bottom: 36px; z-index: 12; transform: translate( -50%, 12px ); opacity: 0; transition: opacity 0.4s, transform 0.4s; pointer-events: none;
		display: flex; flex-wrap: wrap; justify-content: center; gap: 14px 30px; max-width: min( 96vw, 1100px ); font-size: 22px; }
	#controls-hint.on { opacity: 1; transform: translate( -50%, 0 ); }
	#controls-hint .item { display: flex; align-items: center; gap: 9px; white-space: nowrap; }
	#controls-hint .title { width: 100%; text-align: center; font: 38px/1 var(--brand); color: var(--accent-light); text-transform: uppercase; letter-spacing: 0; margin-bottom: 2px; }
	#controls-hint .hud-key { min-width: 36px; padding: 7px 14px; border-radius: 10px; font-size: 19px; }
	@media ( prefers-reduced-motion: reduce ) { #controls-hint { transition: none; } }
`;

const hasPad = () => [ ...( navigator.getGamepads?.() || [] ) ].some( Boolean );
const isTouch = () => 'ontouchstart' in window && matchMedia( '(pointer: coarse)' ).matches;

// [ [ keys…, label ] ] for this device. keys: the bindings (Settings.js);
// view: the view key works here; restart: the quick restart does (solo)
export function hintItems( keys, { pad = false, touch = false, view = true, restart = false } = {} ) {

	if ( touch ) return [ [ t( 'hint.touch' ) ] ];

	if ( pad ) {

		return [
			[ 'RT', t( 'hint.accelerate' ) ], [ 'LT', t( 'hint.brake' ) ], [ 'Stick', t( 'hint.steer' ) ], [ 'A', t( 'hint.handbrake' ) ],
			...( view ? [ [ 'Y', t( 'hint.view' ) ] ] : [] ), ...( restart ? [ [ 'Select', t( 'hint.restart' ) ] ] : [] ), [ 'Start', t( 'hint.pause' ) ],
		];

	}

	const bound = ( action ) => ( keys[ action ] || [] ).slice( 0, 1 ).filter( Boolean ).map( keyLabel );

	return [
		[ ...bound( 'accelerate' ), ...bound( 'left' ), ...bound( 'brake' ), ...bound( 'right' ), t( 'hint.drive' ) ],
		[ ...bound( 'handbrake' ), t( 'hint.handbrake' ) ],
		...( view ? [ [ ...bound( 'camera' ), t( 'hint.view' ) ] ] : [] ),
		...( restart ? [ [ ...bound( 'restart' ), t( 'hint.restart' ) ] ] : [] ),
		[ keyLabel( 'Escape' ), t( 'hint.pause' ) ],
	].filter( ( item ) => item.length > 1 );

}

export class ControlsHint {

	constructor( keys, options ) {

		this.keys = keys;
		this.options = options;
		this.el = null;
		this.left = 0;

	}

	// Once the scene is on screen
	async show() {

		if ( this.el ) return;
		await layoutReady;

		useHudTheme();
		const style = document.createElement( 'style' );
		style.textContent = CSS;
		document.head.appendChild( style );

		const el = document.createElement( 'div' );
		el.id = 'controls-hint';
		el.className = 'hud-float';
		el.setAttribute( 'role', 'status' );
		const title = document.createElement( 'div' );
		title.className = 'title';
		title.textContent = t( 'hint.title' );
		el.appendChild( title );

		for ( const item of hintItems( this.keys, { ...this.options, pad: hasPad(), touch: isTouch() } ) ) {

			const row = document.createElement( 'span' );
			row.className = 'item';

			for ( const key of item.slice( 0, - 1 ) ) {

				const kbd = document.createElement( 'kbd' );
				kbd.className = 'hud-key';
				kbd.textContent = key;
				row.appendChild( kbd );

			}

			row.appendChild( document.createTextNode( item[ item.length - 1 ] ) );
			el.appendChild( row );

		}

		document.body.appendChild( el );
		this.el = el;
		this.left = SHOW;
		requestAnimationFrame( () => el.classList.add( 'on' ) );

	}

	// Every frame: gone a moment after the car sets off, or after SHOW s
	frame( dt, input ) {

		if ( ! this.el || this.left <= 0 ) return;
		this.left -= dt;
		if ( input && ( input.z > 0.1 || input.touchActive ) ) this.left = Math.min( this.left, AFTER_START );
		if ( this.left <= 0 ) this.el.classList.remove( 'on' );

	}

}
