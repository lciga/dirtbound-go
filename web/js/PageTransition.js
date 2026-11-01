import * as THREE from 'three';

// Page changes (menu, game, editor). Leaving: a white rectangle grows from the
// centre over the page, then the browser goes on. Arriving: the page opens on
// that white with a 16:9 window in the middle, a shade darker, filled by a
// black bar as the page really loads (files, building, shaders: PageLoading
// below). Full, the black fades on the scene and the window opens out to the
// edges of the screen.
// The arriving overlay is in each page's HTML (#page-loader + its styles) so it
// covers the very first paint, before any module has run.

const EASE = 'cubic-bezier(0.92, 0, 0.48, 1)';
const COVER_TIME = 800;  // ms, the white rectangle growing over the page
const FADE_TIME = 450;   // ms, the black bar fading on the scene
const OPEN_TIME = 900;   // ms, the window opening out to the edges
const BAR_SPEED = 1100;  // ms for the whole bar: it glides at that steady pace towards the real progress
const BAR_MIN = 120;     // ms, shortest glide
const UI_TIME = 700;     // ms, each piece of interface sliding in after the opening
const UI_STAGGER = 70;   // ms between two pieces
const UI_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

const reduced = () => matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
const wait = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

// Some drivers never complete KHR_parallel_shader_compile. Warmup is optional:
// ordinary rendering can finish those programs on demand instead of blocking entry.
export async function warmupShaders( renderer, scene, camera, timeoutMs = 2500 ) {
	let deadline;
	try {
		return await Promise.race( [
			renderer.compileAsync( scene, camera ).then( () => true ),
			new Promise( resolve => { deadline = setTimeout( () => resolve( false ), timeoutMs ); } ),
		] );
	} finally { clearTimeout( deadline ); }
}

let leaving = false;

// Covers the page with the white rectangle, then opens url
export function leavePage( url ) {

	if ( leaving ) return;
	leaving = true;

	if ( reduced() ) {

		location.href = url;
		return;

	}

	const cover = document.createElement( 'div' );
	cover.setAttribute( 'aria-hidden', 'true' );
	cover.style.cssText = `position: fixed; inset: 0; z-index: 1000; background: #fff; transform: scale(0); transition: transform ${ COVER_TIME }ms ${ EASE };`;
	document.body.appendChild( cover );
	cover.getBoundingClientRect(); // start from scale(0)
	cover.style.transform = 'scale(1)';

	setTimeout( () => {

		location.href = url;

		// Back to this page from the browser's cache: uncovered
		addEventListener( 'pageshow', () => {

			cover.remove();
			leaving = false;

		}, { once: true } );

	}, COVER_TIME );

}

// Links to another page of the game get the same way out
export function leaveOnLinks( root = document ) {

	root.addEventListener( 'click', ( e ) => {

		const a = e.target.closest?.( 'a[href]' );
		if ( ! a || a.target === '_blank' || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) return;
		const url = new URL( a.href, location.href );
		if ( url.origin !== location.origin || ! /\.html$|\/$/.test( url.pathname ) ) return;
		e.preventDefault();
		leavePage( a.href );

	} );

}

// The loading of the page arriving. weights = { step: share of the bar }; each
// step reports 0..1 with set(), the bar shows the weighted sum (never going
// back). Files go through three's DefaultLoadingManager (GLTF, textures, the
// car pack: SecureAssets reports there too) into the step named 'files'.
// The interface waits for the window to be open: a page whose <html> carries
// data-ui="wait" hides it in its styles; once open the attribute goes (the
// page's own entrance animations start then) and options.ui() = the elements
// to slide in, one after the other.
export class PageLoading {

	constructor( weights, { ui = () => [] } = {} ) {

		this.ui = ui;

		this.el = document.getElementById( 'page-loader' );
		this.bar = this.el?.querySelector( 'i' );
		this.weights = weights;
		this.total = Object.values( weights ).reduce( ( a, b ) => a + b, 0 );
		this.done = {};
		this.shown = 0;   // the real progress
		this.drawn = 0;   // where the bar's current glide ends
		this.glide = null;

		if ( 'files' in weights ) {

			THREE.DefaultLoadingManager.onProgress = ( url, loaded, total ) => this.set( 'files', loaded / total );

		}

	}

	set( step, fraction ) {

		this.done[ step ] = Math.min( 1, Math.max( this.done[ step ] || 0, fraction ) );
		let sum = 0;
		for ( const k in this.weights ) sum += this.weights[ k ] * ( this.done[ k ] || 0 );
		this.shown = Math.max( this.shown, sum / this.total );
		if ( ! this.glide ) this.glideOn();

	}

	// The bar glides at a steady pace to the real progress; news arriving
	// meanwhile wait for the end of that glide, so it never jerks nor
	// restarts. A transform animation: it runs on the compositor, the bar keeps
	// moving while a long step blocks the page. The last glide (to the full
	// bar) slows down at the end.
	glideOn() {

		const to = this.shown;
		if ( ! this.bar || to <= this.drawn ) return this.glideDone?.();
		const from = this.drawn;
		const full = to >= 1;
		this.drawn = to;
		this.glide = this.bar.animate( [ { transform: `scaleX(${ from })` }, { transform: `scaleX(${ to })` } ], {
			duration: Math.max( BAR_MIN, ( to - from ) * BAR_SPEED * ( full ? 1.6 : 1 ) ),
			easing: full ? 'cubic-bezier(0.3, 0.7, 0.4, 1)' : 'linear',
			fill: 'forwards',
		} );
		this.glide.onfinish = () => {

			this.glide = null;
			this.glideOn();

		};

	}

	// Resolves once the bar is drawn full
	barFull() {

		if ( ! this.bar || ( this.drawn >= 1 && ! this.glide ) ) return Promise.resolve();
		return new Promise( ( resolve ) => {

			this.glideDone = () => {

				if ( this.drawn < 1 ) return;
				this.glideDone = null;
				resolve();

			};

		} );

	}

	// Resolves with the promise, the step full when it settles
	track( step, promise ) {

		const end = () => this.set( step, 1 );
		promise.then( end, end );
		return promise;

	}

	// Lets the browser draw the bar between two long blocking steps
	paint() {

		return new Promise( ( resolve ) => {

			requestAnimationFrame( () => setTimeout( resolve, 0 ) );
			setTimeout( resolve, 100 ); // hidden tab: no animation frames

		} );

	}

	// renderer.compileAsync, the step following the shader programs as they
	// finish compiling. The current render target picks the variants (see
	// main.js, the probe bake)
	async compile( step, renderer, scene, camera ) {

		const before = new Set( renderer.info.programs );
		if ( this.el ) this.el.dataset.loadingStep = step;
		const ready = warmupShaders( renderer, scene, camera );
		const fresh = renderer.info.programs.filter( ( p ) => ! before.has( p ) );
		const count = () => this.set( step, fresh.length ? fresh.filter( ( p ) => p.isReady() ).length / fresh.length : 1 );
		const timer = setInterval( count, 30 );
		let compiled;
		try { compiled = await ready; }
		finally { clearInterval( timer ); }
		this.set( step, 1 );
		if ( ! compiled ) console.info( '[shader-warmup] Deferred: ' + step );
		return compiled;

	}

	// Everything loaded: the bar full, the black fades on the scene, the
	// window opens out; the overlay goes
	reveal() {

		if ( ! this.revealed ) this.revealed = this.open();
		return this.revealed;

	}

	async open() {

		for ( const k in this.weights ) this.set( k, 1 );
		const el = this.el;

		if ( el && ! reduced() ) {

			await Promise.race( [ this.barFull(), wait( 3000 ) ] ); // a hidden tab may never finish the glide
			el.dataset.state = 'full';
			await wait( 150 );
			el.dataset.state = 'fade';
			await wait( FADE_TIME );
			el.dataset.state = 'open';
			await wait( OPEN_TIME );

		}

		el?.remove();
		this.showInterface();

	}

	// Top pieces drop in, bottom ones rise
	showInterface() {

		delete document.documentElement.dataset.ui;
		if ( reduced() ) return;
		let i = 0;

		for ( const el of this.ui() ) {

			const box = el.getBoundingClientRect();
			const style = getComputedStyle( el );
			if ( ( ! box.width && ! box.height ) || style.visibility === 'hidden' || Number( style.opacity ) === 0 ) continue; // not shown (toasts, the respawn fade…)
			const from = box.top + box.height / 2 > innerHeight / 2 ? '0 18px' : '0 -18px';
			// Only the start given (offset 0: a lone keyframe is the end otherwise),
			// so it ends on the element's own opacity and place
			el.animate( [ { opacity: 0, translate: from, offset: 0 } ], { duration: UI_TIME, delay: i ++ * UI_STAGGER, easing: UI_EASE, fill: 'backwards' } );

		}

	}

}
