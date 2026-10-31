// Total distance driven in endless rally mode, kept in localStorage (metres).
// Reads never throw (private mode, blocked storage): 0 is returned.

const KEY = 'racing.endlessOdometer';
const SAVE_EVERY = 50; // m of unsaved distance before writing to storage

export function loadOdometer() {

	try {

		const v = Number( localStorage.getItem( KEY ) );
		return Number.isFinite( v ) && v > 0 ? v : 0;

	} catch {

		return 0;

	}

}

function saveOdometer( metres ) {

	try {

		localStorage.setItem( KEY, String( Math.round( metres ) ) );

	} catch {}

}

export function formatKm( metres ) {

	// Same format as the stage DIST line of the HUD
	return ( metres / 1000 ).toFixed( 2 ) + ' km';

}

// Adds distance as the car progresses and flushes it to storage every
// SAVE_EVERY metres, and when the page is hidden or closed.
export class Odometer {

	constructor() {

		this.total = loadOdometer();
		this.saved = this.total;

		const flush = () => this.flush();
		window.addEventListener( 'pagehide', flush );
		document.addEventListener( 'visibilitychange', () => {

			if ( document.visibilityState === 'hidden' ) flush();

		} );

	}

	add( metres ) {

		if ( ! ( metres > 0 ) ) return;
		this.total += metres;
		if ( this.total - this.saved >= SAVE_EVERY ) this.flush();

	}

	flush() {

		if ( this.total === this.saved ) return;
		// Another tab may have driven too: never go below what storage holds
		const stored = loadOdometer();
		const merged = Math.max( stored + ( this.total - this.saved ), this.total );
		saveOdometer( merged );
		this.total = merged;
		this.saved = merged;

	}

}
