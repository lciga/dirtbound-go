// Keeps the frame rate up by adjusting the render resolution (pixel ratio).
//
// Every change resizes the canvas and reallocates the render targets, which
// itself stutters, so it must stay rare:
// - the median frame time of a window is measured (one hitch doesn't count)
// - the ratio drops a step only after two slow windows in a row, and nothing
//   changes for COOLDOWN seconds after a change
// - a drop that doesn't make frames faster by MIN_GAIN is undone and the
//   ratio frozen: pixels were not the bottleneck (CPU, compositor...)
// - raising back is allowed after several smooth windows, but a drop right
//   after a raise freezes the ratio at the lower level (no flip-flopping)

const MAX_RATIO = 2; // above this the extra pixels are invisible but costly
const MIN_RATIO = 0.6;
const STEP = 0.15;
const WINDOW = 1.5; // s of frames per measure
const SLOW_FPS = 48;
const FAST_FPS = 57;
const SLOW_WINDOWS_TO_DROP = 2;
const FAST_WINDOWS_TO_RAISE = 6;
const COOLDOWN = 10; // s without any change after one
const MIN_GAIN = 1.08; // a drop must make the median fps at least 8 % better

function median( values ) {

	const sorted = [ ...values ].sort( ( a, b ) => a - b );
	return sorted[ Math.floor( sorted.length / 2 ) ];

}

export class AdaptiveResolution {

	// maxRatio: lower ceiling (performance mode uses 1)
	constructor( renderer, maxRatio = MAX_RATIO ) {

		this.renderer = renderer;
		this.max = Math.min( window.devicePixelRatio || 1, maxRatio );
		this.ratio = this.max;
		this.times = [];
		this.elapsed = 0;
		this.slowWindows = 0;
		this.fastWindows = 0;
		this.cooldown = 0;
		this.skipNext = true; // first window includes loading hitches
		this.frozen = false;
		this.lastChange = null; // { from, fpsBefore, raise } to judge the change afterwards

		renderer.setPixelRatio( this.ratio );

	}

	// dt = real frame time in seconds (not clamped)
	update( dt ) {

		if ( this.frozen ) return;

		this.elapsed += dt;
		this.times.push( dt );
		if ( this.elapsed < WINDOW ) return;

		const fps = 1 / median( this.times );
		const windowLength = this.elapsed;
		this.times = [];
		this.elapsed = 0;

		if ( this.skipNext ) {

			this.skipNext = false;
			return;

		}

		// Judge the last drop on the first clean window after it
		if ( this.lastChange && ! this.lastChange.raise ) {

			const helped = fps >= this.lastChange.fpsBefore * MIN_GAIN;
			if ( ! helped ) {

				this.apply( this.lastChange.from );
				this.frozen = true; // resolution isn't what limits this machine
				return;

			}

			this.lastChange = null;

		}

		if ( this.cooldown > 0 ) {

			this.cooldown -= windowLength;
			return;

		}

		this.slowWindows = fps < SLOW_FPS ? this.slowWindows + 1 : 0;
		this.fastWindows = fps >= FAST_FPS ? this.fastWindows + 1 : 0;

		if ( this.slowWindows >= SLOW_WINDOWS_TO_DROP && this.ratio > MIN_RATIO ) {

			const raisedJustBefore = this.lastChange && this.lastChange.raise;
			this.change( this.ratio - STEP, fps, false );
			if ( raisedJustBefore ) this.frozen = true; // it went up, then down again: stay here

		} else if ( this.fastWindows >= FAST_WINDOWS_TO_RAISE && this.ratio < this.max ) {

			this.change( this.ratio + STEP, fps, true );

		}

	}

	change( ratio, fpsBefore, raise ) {

		this.lastChange = { from: this.ratio, fpsBefore, raise };
		this.slowWindows = 0;
		this.fastWindows = 0;
		this.cooldown = COOLDOWN;
		this.apply( ratio );

	}

	// After a pause or a hidden tab the long frame must not count
	reset() {

		this.times = [];
		this.elapsed = 0;
		this.skipNext = true;

	}

	apply( ratio ) {

		this.ratio = Math.min( this.max, Math.max( MIN_RATIO, Math.round( ratio * 100 ) / 100 ) );
		this.renderer.setPixelRatio( this.ratio );
		this.skipNext = true; // the resize itself costs a frame

	}

}
