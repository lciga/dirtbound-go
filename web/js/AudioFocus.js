// Every sound stops while the game is not in front: its tab hidden, or its
// window not the focused one (another application or window over it, even
// with the tab still open), and starts again when it is back.
//
// onAudioFocus( ( away ) => … ) is called on each change, and once at once
// when the page is already away. Each sound source silences itself its own way
// (Audio.js suspends the game's context unless the game is paused,
// MenuMusic pauses its track, UiSounds suspends its context).

const listeners = new Set();
let away = typeof document !== 'undefined' && ( document.hidden || ! document.hasFocus() );

function check() {

	const now = document.hidden || ! document.hasFocus();
	if ( now === away ) return;
	away = now;
	for ( const listener of listeners ) listener( away );

}

if ( typeof window !== 'undefined' ) {

	document.addEventListener( 'visibilitychange', check );
	window.addEventListener( 'blur', check );
	window.addEventListener( 'focus', check );
	window.addEventListener( 'pagehide', check );

}

export const isAway = () => away;

export function onAudioFocus( listener ) {

	listeners.add( listener );
	if ( away ) listener( true );
	return () => listeners.delete( listener );

}

// An AudioContext silenced while away (suspended, then resumed if it was running)
export function silenceWhenAway( ctx ) {

	let resume = false;
	return onAudioFocus( ( isAway ) => {

		if ( isAway ) {

			resume = ctx.state === 'running';
			if ( resume ) ctx.suspend();

		} else if ( resume ) {

			resume = false;
			ctx.resume();

		}

	} );

}
