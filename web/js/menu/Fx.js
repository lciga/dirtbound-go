// Menu effects layered over the showroom and under/over the UI (styles in
// index.html, "Effects"):
//   - cut() + frame( canvas, p ): on every camera cut the showroom keeps
//     rendering the outgoing shot (still moving) and hands each frame over; it
//     stays on top and goes away either as a crossfade or split in two at the
//     centre (top half up, bottom half down), revealing the new shot underneath
//   - transition( swap ): a wipe of skewed bands covering the screen while the
//     menu swaps screens, then the new one reveals in cascade
//   - pulse( kick ): the beat level as a CSS variable (--kick) for the primary
//     card and the music button
// Everything goes quiet with prefers-reduced-motion.

const smooth = ( t ) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow( - 2 * t + 2, 3 ) / 2; // cubic in-out
const rect = ( x, y, w, h ) => w <= 0 || h <= 0 ? '' : `M${ x.toFixed( 1 ) } ${ y.toFixed( 1 ) }h${ w.toFixed( 1 ) }v${ h.toFixed( 1 ) }h${ ( - w ).toFixed( 1 ) }Z`;

// Each transition: for p in 0..1 (0 = the outgoing shot covers everything),
// how the outgoing shot is shown: path = the part that remains, as an SVG path
// in CSS pixels (clip-path: path()), opacity
const CUTS = {

	fade( p ) {

		return { opacity: 1 - smooth( p ) };

	},

	// The screen opens from the centre line
	split( p, W, H ) {

		const h = H / 2 * ( 1 - smooth( p ) );
		return { path: ( rect( 0, 0, W, h ) + rect( 0, H - h, W, h ) ) || 'M0 0Z' };

	},

};

const KINDS = Object.keys( CUTS );

export class Fx {

	constructor() {

		this.reduced = matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
		this.kind = 'fade';
		this.root = document.documentElement;

		// Cut layer: the outgoing shot
		this.cutEl = document.createElement( 'div' );
		this.cutEl.id = 'fx-cut';
		this.cutEl.setAttribute( 'aria-hidden', 'true' );
		this.still = document.createElement( 'canvas' );
		this.cutEl.append( this.still );
		document.body.appendChild( this.cutEl );

		// Screen wipe: three bands chasing each other
		this.wipeEl = document.createElement( 'div' );
		this.wipeEl.id = 'fx-wipe';
		this.wipeEl.setAttribute( 'aria-hidden', 'true' );
		this.wipeEl.innerHTML = '<i></i><i></i><i></i>';
		document.body.appendChild( this.wipeEl );

		const grain = document.createElement( 'div' );
		grain.id = 'fx-grain';
		grain.setAttribute( 'aria-hidden', 'true' );
		document.body.appendChild( grain );

	}

	// A camera cut: picks the transition
	cut() {

		this.kind = KINDS[ Math.floor( Math.random() * KINDS.length ) ];

	}

	// Every frame of the transition: source = the showroom canvas holding the
	// outgoing shot (copied now: the WebGL buffer is gone after this task),
	// p = 0..1; source null = the transition is over
	frame( source, p ) {

		const still = this.still;

		if ( ! source || this.reduced || p >= 1 ) {

			still.style.visibility = 'hidden';
			return;

		}

		if ( still.width !== source.width || still.height !== source.height ) {

			still.width = source.width;
			still.height = source.height;

		}

		still.getContext( '2d' ).drawImage( source, 0, 0 );

		const m = CUTS[ this.kind ]( p, window.innerWidth, window.innerHeight );
		still.style.visibility = 'visible';
		still.style.clipPath = m.path ? `path('${ m.path }')` : 'none';
		still.style.opacity = m.opacity ?? 1;

	}

	// Covers the screen, runs swap() at full cover, then uncovers
	transition( swap, direction = 1 ) {

		if ( this.reduced || this.busy ) {

			swap();
			return;

		}

		this.busy = true;
		this.wipeEl.className = 'in' + ( direction < 0 ? ' reverse' : '' );

		setTimeout( () => {

			swap();
			this.wipeEl.className = 'out' + ( direction < 0 ? ' reverse' : '' );

			setTimeout( () => {

				this.wipeEl.className = '';
				this.busy = false;

			}, 520 );

		}, 380 );

	}

	pulse( kick ) {

		this.root.style.setProperty( '--kick', this.reduced ? 0 : kick.toFixed( 3 ) );

	}

}
