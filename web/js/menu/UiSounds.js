// Menu interface sounds (audio/menu/, trimmed to their first and last
// audible sample, peaks levelled to -3 dB): a pop on every click of a button
// (titles, tiles, buttons; one of two, never the same twice in a row) and
// another for a popup opening (the pseudo / profile card, the lobby forms).
// Each play is a little off: rate ± CENTS, level ± DB.
//
// The context is made at load (suspended until the first gesture: browsers
// allow it to decode meanwhile, so the first click already has its sound).

import { silenceWhenAway } from '../AudioFocus.js';

const CLICKS = [ 'ui-click-1', 'ui-click-2' ];
const POPUP = 'ui-popup';
// The travelling to the garage: time-warped (pitch kept) so its body (within
// 6 dB of its peak) spans the camera's half-speed window, 0.81-1.69 s after
// the click, and its envelope lines up with the camera's speed (0 ms by
// cross-correlation; Showroom: 3.12 s place change × TRAVEL_SHARE 2/3, TRAVEL_EASE).
// Played as it is: no rate change, it would move it off the camera
const WOOSH = 'ui-woosh';
const WOOSH_VOLUME = 0.5;
const WOOSH_CENTER = 1.25; // s into the file: the middle of its energy (the camera's fastest moment)
// Wooshes over one another (season changes clicked in a row): the same file a
// few hundred ms apart combs (a metallic flanging) and adds up too loud. So
// each overlapping one plays a little off pitch (± JITTER cents, its middle
// still where asked), the ones already playing step back (level × DUCK, their
// highs closing to DUCK_TONE Hz over DUCK_TIME, as if further away), at most
// WOOSHES at once (the oldest fades out), and a new one comes in a little
// lower the more are playing
const JITTER = 90;
const DUCK = 0.45, DUCK_TONE = 2600, DUCK_TIME = 0.25;
const WOOSHES = 2;
const VOLUME = 0.32;
const CENTS = 120, DB = 1.5;
const SAME_CLICK = 0.04; // s: one click sound for a click passed on (the account card clicking the hidden #profile)
const POPUP_OVER = 0.12; // s: a popup opened by a click takes that click's place

export class UiSounds {

	constructor() {

		this.ctx = null;
		this.buffers = {};
		this.last = - 1;
		this.click = null; // the last click sound's source
		this.clickAt = - Infinity;
		this.popupAt = - Infinity; // and when (s, context time): a popup or a passed-on click within reach of it
		try {

			this.ctx = new AudioContext();

		} catch {

			return;

		}

		silenceWhenAway( this.ctx ); // nothing while the game is not in front (AudioFocus.js)

		for ( const name of [ ...CLICKS, POPUP, WOOSH ] ) {

			fetch( `audio/menu/${ name }.mp3` )
				.then( ( r ) => r.arrayBuffer() )
				.then( ( data ) => this.ctx.decodeAudioData( data ) )
				.then( ( buffer ) => { this.buffers[ name ] = buffer; } )
				.catch( () => {} );

		}

	}

	clicked() {

		if ( ! this.ready() ) return;
		if ( this.ctx.currentTime - this.clickAt < SAME_CLICK || this.ctx.currentTime - this.popupAt < SAME_CLICK ) return; // passed on, or it opened a popup (whose handler ran first)
		let i = Math.floor( Math.random() * CLICKS.length );
		if ( i === this.last ) i = ( i + 1 ) % CLICKS.length;
		this.last = i;
		this.click = this.play( CLICKS[ i ] );
		this.clickAt = this.ctx.currentTime;

	}

	popup() {

		if ( ! this.ready() ) return;
		if ( this.click && this.ctx.currentTime - this.clickAt < POPUP_OVER ) {

			try { this.click.stop(); } catch {} // already over
			this.click = null;

		}
		this.play( POPUP );
		this.popupAt = this.ctx.currentTime;

	}

	// A woosh whose middle is heard `center` s from now: by default the
	// camera's travelling to or from the garage, which starts now (played as it
	// is: no pitch change, it is cut to the camera); the home's season, when its
	// front sweeps under the camera (overlap: true, several may run at once).
	// Shifted for the output's latency (started that much into the file, or
	// that much sooner)
	woosh( center = WOOSH_CENTER, { overlap = false } = {} ) {

		if ( ! this.ready() || ! this.buffers[ WOOSH ] ) return;
		const ctx = this.ctx, t = ctx.currentTime;
		this.wooshes = ( this.wooshes || [] ).filter( ( w ) => ! w.ended );
		if ( ! overlap ) for ( const w of this.wooshes ) this.fadeWoosh( w, 0.12 );
		else {

			// The ones playing step back; past WOOSHES - 1 of them, the oldest go
			this.wooshes.forEach( ( w, i ) => {

				if ( i < this.wooshes.length - ( WOOSHES - 1 ) ) return this.fadeWoosh( w, 0.25 );
				w.gain.gain.cancelScheduledValues( t );
				w.gain.gain.setValueAtTime( w.gain.gain.value, t );
				w.gain.gain.linearRampToValueAtTime( w.level * DUCK, t + DUCK_TIME );
				w.tone.frequency.cancelScheduledValues( t );
				w.tone.frequency.setValueAtTime( w.tone.frequency.value, t );
				w.tone.frequency.exponentialRampToValueAtTime( DUCK_TONE, t + DUCK_TIME );

			} );

		}

		const playing = this.wooshes.filter( ( w ) => ! w.fading ).length;
		const rate = overlap && playing ? Math.pow( 2, ( Math.random() * 2 - 1 ) * JITTER / 1200 ) : 1;
		const level = WOOSH_VOLUME / Math.sqrt( 1 + playing * 0.5 );
		const source = ctx.createBufferSource();
		source.buffer = this.buffers[ WOOSH ];
		source.playbackRate.value = rate;
		const tone = ctx.createBiquadFilter();
		tone.type = 'lowpass';
		tone.frequency.value = 20000;
		const gain = ctx.createGain();
		gain.gain.value = level;
		source.connect( tone ).connect( gain ).connect( ctx.destination );
		const w = { source, gain, tone, level, ended: false, fading: false };
		source.onended = () => { w.ended = true; };
		this.wooshes.push( w );

		// The file's middle reached `center` s from now at this rate, heard after the latency
		const latency = Math.min( 0.1, ( ctx.outputLatency || 0 ) + ( ctx.baseLatency || 0 ) );
		const wait = center - latency - WOOSH_CENTER / rate;
		if ( wait >= 0 ) source.start( t + wait );
		else source.start( t, Math.min( - wait * rate, source.buffer.duration - 0.01 ) );

	}

	fadeWoosh( w, fade ) {

		if ( w.fading ) return;
		w.fading = true;
		const t = this.ctx.currentTime;
		w.gain.gain.cancelScheduledValues( t );
		w.gain.gain.setValueAtTime( w.gain.gain.value, t );
		w.gain.gain.linearRampToValueAtTime( 0, t + fade );
		try { w.source.stop( t + fade + 0.01 ); } catch {}

	}

	ready() {

		if ( ! this.ctx ) return false;
		if ( this.ctx.state === 'suspended' ) this.ctx.resume();
		return true;

	}

	play( name ) {

		const buffer = this.buffers[ name ];
		if ( ! buffer ) return null;
		const source = this.ctx.createBufferSource();
		source.buffer = buffer;
		source.playbackRate.value = Math.pow( 2, ( Math.random() * 2 - 1 ) * CENTS / 1200 );
		const gain = this.ctx.createGain();
		gain.gain.value = VOLUME * Math.pow( 10, ( Math.random() * 2 - 1 ) * DB / 20 );
		source.connect( gain ).connect( this.ctx.destination );
		source.start();
		return source;

	}

}
