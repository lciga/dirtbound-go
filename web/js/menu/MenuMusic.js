// Menu music and its beat clock: a playlist of guitar tracks by andriig
// (Pixabay, free licence; audio/music/, MP3 128 kb/s constant bit rate: a
// variable rate makes some browsers' currentTime drift off the beat grid),
// played one after the other from a random one. Per track: tempo and first
// beat measured offline (spectral flux onsets, the beat grid that lines them
// up best), calm passages = loudness well under the track's median. The menu
// edits its camera cuts and pulses its UI on the grid of the track playing (a
// new track = a jump back on the grid, the edit resyncs as on a loop); the
// kick level comes live from an analyser, so quiet passages pulse less.
//
// Browsers only allow sound after a user gesture: the first click or key
// starts it. Until then (or when muted) the clock keeps running on its own,
// so the edit and the pulses carry on in silence.

import { onAudioFocus } from '../AudioFocus.js';

const TRACKS = [
	{ src: 'audio/music/menu-guitar-1.mp3', bpm: 124, offset: 0.215, calm: [] },
	{ src: 'audio/music/menu-guitar-2.mp3', bpm: 112, offset: 0.511, calm: [ [ 122.4, 126.5 ] ] },
	{ src: 'audio/music/menu-guitar-3.mp3', bpm: 139.5, offset: 0.389, calm: [ [ 0, 21 ] ] }, // 3 against 2 in places: 93 BPM scores close
];
export const BPM = 122; // the silent clock's
export const BEAT = 60 / BPM; // s
const VOLUME = 0.275;
const FADE_IN = 2; // s

export class MenuMusic {

	// volume: 0..1 on top of VOLUME (menu Paramètres → Son)
	constructor( { enabled = true, volume = 1 } = {} ) {

		this.enabled = enabled;
		this.volume = volume;
		this.track = Math.floor( Math.random() * TRACKS.length );
		this.audio = new Audio( TRACKS[ this.track ].src );
		this.audio.preload = 'auto';

		// The next track when one ends (the last one goes back to the first)
		this.audio.addEventListener( 'ended', () => {

			this.track = ( this.track + 1 ) % TRACKS.length;
			this.audio.src = TRACKS[ this.track ].src;
			if ( this.enabled ) this.audio.play().catch( () => {} );

		} );
		this.ctx = null;
		this.gain = null;
		this.analyser = null;
		this.bins = null;
		this.kickLevel = 0;
		this.floor = 0.2; // slow-moving reference the kick is measured against
		this.silentStart = performance.now() / 1000;

		// First gesture anywhere starts the music (if enabled)
		const unlock = () => {

			window.removeEventListener( 'pointerdown', unlock, true );
			window.removeEventListener( 'keydown', unlock, true );
			if ( this.enabled ) this.start();

		};

		window.addEventListener( 'pointerdown', unlock, true );
		window.addEventListener( 'keydown', unlock, true );

		// Not a note while the game is not in front (AudioFocus.js): the track
		// pauses where it is and goes on from there
		let resume = false;
		onAudioFocus( ( away ) => {

			if ( away ) {

				resume = this.playing;
				if ( resume ) {

					this.audio.pause();
					this.ctx.suspend();

				}

			} else if ( resume ) {

				resume = false;
				if ( ! this.enabled ) return;
				this.ctx.resume();
				this.audio.play().catch( () => {} );

			}

		} );

	}

	get playing() {

		return !! this.ctx && ! this.audio.paused;

	}

	start() {

		if ( ! this.ctx ) {

			this.ctx = new AudioContext();
			const source = this.ctx.createMediaElementSource( this.audio );
			this.gain = this.ctx.createGain();
			this.gain.gain.value = 0;
			this.analyser = this.ctx.createAnalyser();
			this.analyser.fftSize = 1024;
			this.analyser.smoothingTimeConstant = 0.35;
			this.bins = new Uint8Array( this.analyser.frequencyBinCount );
			source.connect( this.gain ).connect( this.analyser ).connect( this.ctx.destination );

		}

		this.ctx.resume();
		this.audio.play().catch( () => {} );
		const t = this.ctx.currentTime;
		this.gain.gain.cancelScheduledValues( t );
		this.gain.gain.setValueAtTime( this.gain.gain.value, t );
		this.gain.gain.linearRampToValueAtTime( VOLUME * this.volume, t + FADE_IN );

	}

	// Resolves once faded out (and paused)
	fadeOut( seconds = 0.4 ) {

		if ( ! this.playing ) return Promise.resolve();
		const t = this.ctx.currentTime;
		this.gain.gain.cancelScheduledValues( t );
		this.gain.gain.setValueAtTime( this.gain.gain.value, t );
		this.gain.gain.linearRampToValueAtTime( 0, t + seconds );
		return new Promise( ( r ) => setTimeout( () => {

			this.audio.pause();
			r();

		}, seconds * 1000 ) );

	}

	// Live, from the volume slider
	setVolume( volume ) {

		this.volume = volume;
		if ( ! this.playing ) return;
		const t = this.ctx.currentTime;
		this.gain.gain.cancelScheduledValues( t );
		this.gain.gain.setTargetAtTime( VOLUME * volume, t, 0.05 );

	}

	setEnabled( on ) {

		this.enabled = on;
		if ( on ) this.start();
		else this.fadeOut( 0.3 );

	}

	// Music time (s) while playing, a free-running clock otherwise
	time() {

		return this.playing ? this.audio.currentTime : performance.now() / 1000 - this.silentStart;

	}

	calm( time = this.time() ) {

		return this.playing && TRACKS[ this.track ].calm.some( ( [ a, b ] ) => time >= a && time < b );

	}

	// { time, beat (float, beats since the track's start), phase (0..1 in the beat),
	// beatLength (s, the track's), kick (0..1) }
	info() {

		const time = this.time();
		const track = TRACKS[ this.track ];
		const beatLength = this.playing ? 60 / track.bpm : BEAT;
		const beat = ( time - ( this.playing ? track.offset : 0 ) ) / beatLength;
		const phase = beat - Math.floor( beat );

		let kick;

		if ( this.playing ) {

			// Low end (≈ 45-190 Hz) against its own slow average: peaks on kicks
			this.analyser.getByteFrequencyData( this.bins );
			const low = ( this.bins[ 1 ] + this.bins[ 2 ] + this.bins[ 3 ] + this.bins[ 4 ] ) / ( 4 * 255 );
			this.floor += ( low - this.floor ) * 0.02;
			const target = Math.min( 1, Math.max( 0, ( low - this.floor * 0.85 ) * 4 ) );
			this.kickLevel = target > this.kickLevel ? target : this.kickLevel * 0.88;
			kick = this.kickLevel;

		} else {

			kick = 0.35 * Math.exp( - phase * 7 ); // silent: a soft pulse on the grid

		}

		return { time, beat, phase, beatLength, kick };

	}

}
