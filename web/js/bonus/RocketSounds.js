// Rocket and lightning sounds of the bonus races (audio/bonus/, cut and levelled from the
// sources by hand: launches start on their first sample, blasts end in a
// fade): launches and blasts played where they happen, through a Web Audio
// panner in the world (the game's AudioListener rides the camera).
//
// No two plays alike: another file than the last one of that set, the rate
// (pitch and length together) off by up to `cents`, the level by up to `db`,
// and a lowpass closing with distance (far blasts thud, near ones crack).
// A car blowing up plays lower and louder than a rocket bursting on the road.

import { Vector3 } from 'three';

const FILES = {
	launch: [ 'rocket-launch-1', 'rocket-launch-2', 'rocket-launch-3', 'rocket-launch-4' ], // small rocket whooshes
	salvo: [ 'rocket-launch-salvo' ], // a heavier launch under a level 3 salvo
	blast: [ 'rocket-blast-1', 'rocket-blast-2', 'rocket-blast-3' ],
	thunder: [ 'lightning-thunder' ], // a very close thunderclap: lightning on the others
	shock: [ 'lightning-shock-1', 'lightning-shock-2' ], // the electric hit (mine close up, the others' by distance)
	spell: [ 'lightning-cast' ], // casting a lightning bonus, a level 3 turbo's rift opening
	attack: [ 'lightning-reverse' ], // my wheels electrified (the reversed controls malus)
	boost: [ 'turbo-burn' ], // a turbo burning (levels 1 and 2), 5.4 s: cut short with a fade
};

const VOICES = 10; // at most at once (a level 3 salvo bursting on 7 cars…): the oldest is cut
const REF_DISTANCE = 7; // m, like the car's sounds (Audio.js)
const ROLLOFF = 1.1;
const MAX_DISTANCE = 250; // m: past it, not played
const BOOST_FADE = 0.45; // s: a turbo's sound fades out over its last moments
const BRIGHT = 16000, DULL = 1400, DULL_AT = 90; // Hz near / far, m for the far one

// Each kind of play: base level and rate, and how far they may wander
export const ROCKET_SOUNDS = {
	launch: { set: 'launch', gain: 0.55, rate: 1, cents: 90, db: 1.5 },
	salvo: { set: 'salvo', gain: 0.6, rate: 1, cents: 60, db: 1 },
	burst: { set: 'blast', gain: 0.55, rate: 1.1, cents: 110, db: 2 }, // a rocket on the road or a barrier
	carBlast: { set: 'blast', gain: 0.9, rate: 0.84, cents: 70, db: 1.5 }, // a car hit
	thunder: { set: 'thunder', gain: 0.8, rate: 1, cents: 150, db: 2 }, // one file: the rate does the varying
	shock: { set: 'shock', gain: 0.75, rate: 1, cents: 80, db: 1.5 },
	spell: { set: 'spell', gain: 0.6, rate: 1, cents: 80, db: 1 },
	attack: { set: 'attack', gain: 0.65, rate: 1, cents: 60, db: 1 },
	boost: { set: 'boost', gain: 0.45, rate: 1, cents: 50, db: 1 },
	stormBehind: { set: 'thunder', gain: 0.55, rate: 0.9, cents: 100, db: 1.5 }, // under my shock when the whole field was struck (level 3)
};

const _listener = new Vector3();

export class RocketSounds {

	// audio: the race's GameAudio (null: silent)
	constructor( audio ) {

		this.audio = audio;
		this.buffers = {}; // set → [ AudioBuffer ]
		this.last = {}; // set → index played last
		this.voices = [];
		this.riding = []; // sounds following a car: { voice, where }
		this.loading = null;
		this.load(); // now: a launch must not wait for its file (else the first shot is silent)

	}

	load() {

		if ( this.loading || ! this.audio?.listener ) return;
		const ctx = this.audio.listener.context;
		this.loading = Promise.all( Object.entries( FILES ).map( async ( [ set, names ] ) => {

			this.buffers[ set ] = await Promise.all( names.map( ( name ) => fetch( `audio/bonus/${ name }.mp3` )
				.then( ( r ) => r.arrayBuffer() )
				.then( ( data ) => ctx.decodeAudioData( data ) ) ) );

		} ) ).catch( ( e ) => console.warn( 'Rocket sounds unavailable:', e ) );

	}

	// A launch from where the shot left: n rockets (a salvo layers the heavy
	// launch under up to two whooshes, a little apart)
	launch( at, n = 1 ) {

		if ( n >= 3 ) this.play( ROCKET_SOUNDS.salvo, at );
		for ( let i = 0; i < Math.min( n, 2 ); i ++ ) this.play( ROCKET_SOUNDS.launch, at, i * ( 0.04 + Math.random() * 0.05 ) );

	}

	// A rocket bursting (car: a car blown up, deeper and louder)
	blast( at, car = false ) {

		this.play( car ? ROCKET_SOUNDS.carBlast : ROCKET_SOUNDS.burst, at );

	}

	// Lightning on another car (sky strike or ball): the thunderclap and the
	// electric hit, both fading with distance
	struck( at ) {

		this.play( ROCKET_SOUNDS.thunder, at );
		this.play( ROCKET_SOUNDS.shock, at );

	}

	// I cast a lightning bonus (at = my car)
	spell( at ) {

		this.play( ROCKET_SOUNDS.spell, at );

	}

	// My wheels electrified: the reversed controls malus landed on me
	reversed( at ) {

		this.play( ROCKET_SOUNDS.attack, at );

	}

	// Lightning on my car (at = my car): the shock, and a level 3 storm's
	// thunder rolling in behind it
	shock( at, level = 1 ) {

		this.play( ROCKET_SOUNDS.shock, at );
		if ( level >= 3 ) this.play( ROCKET_SOUNDS.stormBehind, at, 0.12 + Math.random() * 0.1 );

	}

	// A turbo on a car for `seconds` (what is left of it): the sound rides the
	// car (where() → its position, null when not drawn) and fades out as it ends
	boost( where, seconds ) {

		const at = where();
		if ( ! at || seconds <= BOOST_FADE ) return;
		const voice = this.play( ROCKET_SOUNDS.boost, at, 0, seconds );
		if ( voice ) this.riding.push( { voice, where } );

	}

	// Every frame: the sounds riding a car move with it
	update() {

		this.riding = this.riding.filter( ( { voice, where } ) => {

			if ( voice.ended ) return false;
			const at = where();
			if ( ! at ) return true;
			voice.panner.positionX.value = at.x;
			voice.panner.positionY.value = at.y;
			voice.panner.positionZ.value = at.z;
			return true;

		} );

	}

	// length: s, stops there after a fade (null: the whole file)
	play( kind, at, delay = 0, length = null ) {

		const audio = this.audio;
		if ( ! audio || ! audio.unlocked || audio.paused || ! audio.listener ) return;
		this.load();
		const list = this.buffers[ kind.set ];
		const ctx = audio.listener.context;
		if ( ! list || ctx.state !== 'running' ) return;

		audio.listener.getWorldPosition( _listener );
		const distance = Math.hypot( at.x - _listener.x, at.y - _listener.y, at.z - _listener.z );
		if ( distance > MAX_DISTANCE ) return;

		// Another file than last time (when there is a choice)
		let i = Math.floor( Math.random() * list.length );
		if ( list.length > 1 && i === this.last[ kind.set ] ) i = ( i + 1 + Math.floor( Math.random() * ( list.length - 1 ) ) ) % list.length;
		this.last[ kind.set ] = i;

		const t = ctx.currentTime + delay;
		const source = ctx.createBufferSource();
		source.buffer = list[ i ];
		source.playbackRate.value = kind.rate * Math.pow( 2, ( Math.random() * 2 - 1 ) * kind.cents / 1200 );

		const tone = ctx.createBiquadFilter();
		tone.type = 'lowpass';
		tone.frequency.value = DULL + ( BRIGHT - DULL ) * Math.exp( - distance / DULL_AT ) * ( 0.85 + Math.random() * 0.3 );

		const gain = ctx.createGain();
		const level = kind.gain * Math.pow( 10, ( Math.random() * 2 - 1 ) * kind.db / 20 );
		gain.gain.value = level;
		if ( length !== null ) {

			gain.gain.setValueAtTime( level, t + Math.max( 0, length - BOOST_FADE ) );
			gain.gain.linearRampToValueAtTime( 0, t + length );

		}

		const panner = ctx.createPanner();
		panner.panningModel = 'equalpower';
		panner.distanceModel = 'inverse';
		panner.refDistance = REF_DISTANCE;
		panner.rolloffFactor = ROLLOFF;
		panner.positionX.value = at.x;
		panner.positionY.value = at.y;
		panner.positionZ.value = at.z;

		source.connect( tone ).connect( gain ).connect( panner ).connect( audio.listener.getInput() );
		source.start( t );
		if ( length !== null ) source.stop( t + length + 0.02 );

		const voice = { source, panner, ended: false };
		this.voices.push( voice );
		source.onended = () => {

			voice.ended = true;
			const k = this.voices.indexOf( voice );
			if ( k >= 0 ) this.voices.splice( k, 1 );
			panner.disconnect();

		};

		if ( this.voices.length > VOICES ) this.voices.shift().source.stop();
		return voice;

	}

}
