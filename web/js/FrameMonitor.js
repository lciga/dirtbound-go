// ?debug only: logs every long frame to the console with what happened in it,
// to track down hitches (freeze every N seconds, car jumping ahead...).
// A drop of the JS heap between two frames means a garbage collection ran.
// Chromium browsers also report every long animation frame (> 50 ms) with
// where the main thread spent it: scripts (which ones), rendering, style and
// layout. A long gap between frames with a short [loaf] entry, or none, means
// the time went off the main thread: GPU or compositor.
// console.log, not warn: warn records a stack trace per line, which is slow.

const LONG_FRAME = 0.025; // s

export class FrameMonitor {

	constructor( renderer ) {

		this.renderer = renderer;
		this.lastHeap = null;
		this.lastLong = null;
		this.marks = {};
		this.observeLongFrames();

	}

	observeLongFrames() {

		if ( ! PerformanceObserver.supportedEntryTypes?.includes( 'long-animation-frame' ) ) {

			console.log( '[loaf] long-animation-frame non disponible dans ce navigateur (Chrome/Brave 123+ seulement)' );
			return;

		}

		new PerformanceObserver( ( list ) => {

			for ( const e of list.getEntries() ) {

				const end = e.startTime + e.duration;
				const scripts = e.renderStart ? e.renderStart - e.startTime : e.duration;
				const frame = e.renderStart && e.styleAndLayoutStart ? e.styleAndLayoutStart - e.renderStart : 0;
				const layout = e.styleAndLayoutStart ? end - e.styleAndLayoutStart : 0;
				const who = e.scripts
					.filter( ( sc ) => sc.duration >= 5 )
					.map( ( sc ) => `${ sc.invokerType } ${ sc.invoker || '' } ${ ( sc.sourceURL || '' ).split( '/' ).pop() }:${ sc.sourceFunctionName || '?' } ${ sc.duration.toFixed( 0 ) } ms` )
					.join( ' ; ' );
				console.log( `[loaf] ${ e.duration.toFixed( 0 ) } ms sur le fil principal (bloquant ${ e.blockingDuration.toFixed( 0 ) } ms) : scripts hors image ${ scripts.toFixed( 0 ) } ms, image (rAF) ${ frame.toFixed( 0 ) } ms, style/mise en page ${ layout.toFixed( 0 ) } ms${ who ? ' | ' + who : '' }` );

			}

		} ).observe( { type: 'long-animation-frame', buffered: false } );

	}

	// Wall-clock split of the frame: monitor.time( 'physics', () => ... )
	time( label, fn ) {

		const t = performance.now();
		fn();
		this.marks[ label ] = performance.now() - t;

	}

	// Call at the end of each frame with its (unclamped) duration and the time
	// our own code took in it (the rest is the browser: compositor, GPU, other tasks)
	frame( frameTime, steps, jsTime ) {

		const heap = performance.memory ? performance.memory.usedJSHeapSize : null;
		const gc = heap !== null && this.lastHeap !== null && heap < this.lastHeap - 256 * 1024;
		this.lastHeap = heap;

		if ( frameTime >= LONG_FRAME ) {

			const now = performance.now();
			const since = this.lastLong === null ? '' : ` | ${ ( ( now - this.lastLong ) / 1000 ).toFixed( 2 ) } s depuis la précédente`;
			this.lastLong = now;
			const split = Object.entries( this.marks ).map( ( [ k, v ] ) => `${ k } ${ v.toFixed( 1 ) } ms` ).join( ', ' );
			const outside = frameTime * 1000 - ( this.lastJs ?? 0 );
			console.log( `[frame] ${ ( frameTime * 1000 ).toFixed( 0 ) } ms (jeu ${ jsTime.toFixed( 1 ) } ms, hors jeu ~${ outside.toFixed( 0 ) } ms), ${ steps } pas, résolution ${ this.renderer.getPixelRatio() }, ${ split }${ gc ? ', GC (le tas a baissé)' : '' }${ since }` );

		}

		this.lastJs = jsTime;
		this.marks = {};

	}

}
