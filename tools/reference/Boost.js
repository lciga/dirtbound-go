// Secret accelerator: the Konami code (↑ ↑ ↓ ↓ ← → ← → B A) typed during a
// race unlocks Shift = boost (kept on this device), typed again locks it.
// Not in multiplayer. Laps and stages driven with it count like any other
// only while COUNT_BOOSTED is true; false (current) = never saved
// nor sent to the leaderboard (main.js).

export const KONAMI = [ 'arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a' ];
export const BOOST_KEYS = [ 'ShiftLeft', 'ShiftRight' ];
export const BOOST_SPEED = 1.5; // top speed ×
export const BOOST_PUNCH = 2; // how fast the car gets there ×
export const COUNT_BOOSTED = false;
// Bonus races stack boosts (a boost pad on top of a turbo): top speed and pull
// per number of boosts at once. 1.7 × keeps the fastest car (~20 m/s) under the
// server's GHOST_MAX_SPEED (35 m/s), past which a move counts as a jump
const STACK_TOP = [ 1, BOOST_SPEED, 1.7 ];
const STACK_PUNCH = [ 1, BOOST_PUNCH, 3 ];
export const BOOST_STACK = STACK_TOP.length - 1; // boosts that add up, at most

const STORAGE_KEY = 'racing.boost';

// Next position in the code after `key` (KeyboardEvent.key: letters by what
// they type, so it works on AZERTY too); KONAMI.length = complete
export function konamiStep( index, key ) {

	const k = String( key ).toLowerCase();
	if ( k === KONAMI[ index ] ) return index + 1;
	// A third up after ↑ ↑ keeps the two ups typed so far
	if ( k === KONAMI[ 0 ] ) return index === 2 ? 2 : 1;
	return 0;

}

// on: false / true, or how many boosts at once (stacked, up to BOOST_STACK)
export function boostedSpeed( on ) {

	const n = Math.min( BOOST_STACK, Math.max( 0, Math.floor( Number( on ) || 0 ) ) );
	return { top: STACK_TOP[ n ], rate: STACK_PUNCH[ n ] };

}

export function isBoostUnlocked() {

	try {

		return globalThis.localStorage?.getItem( STORAGE_KEY ) === '1';

	} catch {

		return false;

	}

}

function saveUnlocked( on ) {

	try {

		if ( on ) localStorage.setItem( STORAGE_KEY, '1' );
		else localStorage.removeItem( STORAGE_KEY );

	} catch {

		// Site data blocked: the boost still works until the page closes

	}

}

// Listens for the code; onToggle( unlocked ) after each complete code.
// Returns the function that stops listening.
export function listenKonami( onToggle, initial = isBoostUnlocked() ) {

	let index = 0;
	let unlocked = initial;

	const onKey = ( e ) => {

		if ( e.repeat ) return;
		index = konamiStep( index, e.key );
		if ( index < KONAMI.length ) return;

		index = 0;
		unlocked = ! unlocked;
		saveUnlocked( unlocked );
		onToggle( unlocked );

	};

	window.addEventListener( 'keydown', onKey );
	return () => window.removeEventListener( 'keydown', onKey );

}
