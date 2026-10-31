// How a key code reads on screen (the in-race controls hint): the special
// keys named in the player's language (keys.* in the locales), the letter
// printed on this keyboard when the browser knows the layout (Chromium), else
// AZERTY for a French browser (Firefox has no layout map: KeyW is the Z key
// there), else the US position name

import { t } from './i18n.js';

const KEY_NAMES = {
	ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'Tab', AltLeft: 'Alt', AltRight: 'Alt Gr',
	...Object.fromEntries( [ 'Space', 'Escape', 'Enter', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'Backspace', 'CapsLock', 'Delete' ].map( ( k ) => [ k, t( 'keys.' + k ) ] ) ),
};

// The keys that move between QWERTY and AZERTY
const AZERTY = { KeyQ: 'A', KeyA: 'Q', KeyW: 'Z', KeyZ: 'W', Semicolon: 'M', KeyM: ',' };

let layout = null;

// Resolves once the layout is known (or not available)
export const layoutReady = Promise.resolve( navigator.keyboard?.getLayoutMap?.() )
	.then( ( map ) => { layout = map || null; } )
	.catch( () => {} );

const french = () => /^fr\b/i.test( navigator.language || '' );

export function keyLabel( code ) {

	if ( ! code ) return '—';
	if ( KEY_NAMES[ code ] ) return KEY_NAMES[ code ];
	const printed = layout?.get( code );
	if ( printed ) return printed.toUpperCase();
	if ( ! layout && french() && AZERTY[ code ] ) return AZERTY[ code ];
	return code.replace( /^Key|^Digit/, '' ).replace( /^Numpad/, t( 'keys.numpad' ) + ' ' );

}
