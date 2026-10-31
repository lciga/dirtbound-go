import * as THREE from 'three';
import { createImpactBuffer } from './ImpactSound.js';
import { EngineSound } from './EngineSound.js';
import { onAudioFocus, isAway } from './AudioFocus.js';
import { Gearbox } from './Gearbox.js';

function remap( value, inMin, inMax, outMin, outMax ) {

	return outMin + ( outMax - outMin ) * ( ( value - inMin ) / ( inMax - inMin ) );

}

// Collisions below this velocity use the dull-knock buffer set, above it the
// crunch set; velocity also drives per-hit volume and tone up to the ceiling.
const IMPACT_HARD_VELOCITY = 2.5;
const IMPACT_MAX_VELOCITY = 6;

// Camera follows at ~16 units. refDistance well below that puts a source
// ~7 dB down at nominal distance — the environment should sound "over there".
const REF_DISTANCE = 7;

// The engine is the player's own car: a reference distance below the camera
// distance keeps it fairly present, but not right at the ear.
const ENGINE_REF_DISTANCE = 11;

// Fixed high-end rolloff on the engine — a touch of air-absorption "distance"
// without the full perspective lowpass the environment sources get. Kept high:
// the NSX loops are real recordings, their top end is part of the sound.
const ENGINE_CUTOFF = 12000;

// Engine level into the positional source (samples are normalized to RMS 0.12
// and EngineSound adds its own throttle/rpm gain on top).
const ENGINE_VOLUME = 0.3;

// PannerNode only attenuates and pans, so a distance lowpass (exaggerated air
// absorption) is added separately: open when close, darkening with distance.
const _listenerPos = new THREE.Vector3();
const _targetPos = new THREE.Vector3();

function distanceCutoff( distance ) {

	return THREE.MathUtils.clamp(
		24000 * Math.pow( 6 / Math.max( distance, 6 ), 1.9 ),
		1200, 20000
	);

}

// Outdoor "air" impulse response: sparse early reflections + a short dark tail.
function createOutdoorIR( context ) {

	const sr = context.sampleRate;
	const length = Math.floor( 1.1 * sr );
	const buffer = context.createBuffer( 2, length, sr );

	for ( let ch = 0; ch < 2; ch ++ ) {

		const data = buffer.getChannelData( ch );

		// Early reflections: ground bounce + scattered distant objects
		for ( let r = 0; r < 8; r ++ ) {

			const t = 0.015 + Math.random() * 0.08;
			const idx = Math.floor( t * sr );
			data[ idx ] += ( Math.random() * 2 - 1 ) * ( 0.5 - r * 0.05 );

		}

		// Diffuse tail: lowpassed noise, exponential decay
		let lp = 0;
		const lpCoeff = 1 - Math.exp( - 2 * Math.PI * 2200 / sr );
		const start = Math.floor( 0.05 * sr );

		for ( let i = start; i < length; i ++ ) {

			const t = ( i - start ) / sr;
			lp += ( Math.random() * 2 - 1 - lp ) * lpCoeff;
			data[ i ] += lp * Math.exp( - t / 0.32 ) * 0.35;

		}

	}

	return buffer;

}

export class GameAudio {

	// volumes: { engine, tyres } 0..1 on top of the mix (menu Paramètres → Son)
	constructor( { engine = 1, tyres = 1 } = {} ) {

		this.volumes = { engine, tyres };
		this.listener = null;
		this.target = null;
		this.reverbSend = null;
		this.impactReverbSend = null;
		this.engineReverbSend = null;
		this.engineGain = null;
		this.engine = null;
		this.gearbox = new Gearbox();
		this.skidSound = null;
		this.skidTone = null;
		this.impactBuffers = [];
		this.impactPlayers = [];
		this.impactIndex = 0;
		this.distanceFilters = [];
		this.unlocked = false;

	}

	// `target` is the object the sounds live on (the vehicle container):
	// every source is a PositionalAudio child of it, panned and attenuated
	// relative to the camera-mounted listener.
	init( camera, target ) {

		// 44.1 kHz like the NSX loops: otherwise decodeAudioData resamples each
		// loop and the resampler's edge artifacts come back on every loop turn.
		// The browser converts the continuous output stream instead (inaudible).
		THREE.AudioContext.setContext( new AudioContext( { sampleRate: 44100 } ) );

		this.listener = new THREE.AudioListener();
		camera.add( this.listener );

		this.target = target;

		// Shared outdoor reverb: sources send into one convolver. Impacts get
		// a hotter send — a crash reads as "in the world" mainly through its
		// environmental tail, which a brief transient otherwise barely excites.
		const ctx = this.listener.context;
		const convolver = ctx.createConvolver();
		convolver.buffer = createOutdoorIR( ctx );
		convolver.connect( this.listener.getInput() );

		this.reverbSend = ctx.createGain();
		this.reverbSend.gain.value = 0.15;
		this.reverbSend.connect( convolver );

		this.impactReverbSend = ctx.createGain();
		this.impactReverbSend.gain.value = 0.35;
		this.impactReverbSend.connect( convolver );

		this.engineReverbSend = ctx.createGain();
		this.engineReverbSend.gain.value = 0.11;
		this.engineReverbSend.connect( convolver );

		this.initEngine().catch( ( e ) => {

			console.warn( 'Engine samples unavailable:', e );

		} );

		// Skid loop: sample player with a tone filter that opens as the
		// drift intensifies
		const skid = this.createSampleSource( this.reverbSend );
		this.skidSound = skid.sound;
		this.skidTone = skid.tone;

		// Collision one-shots: two hardness sets of three seeded variations
		// each (soft knocks dully, hard crunches). Three shared players swap
		// in a random buffer per hit and add rate/tone variation on top.
		for ( let i = 0; i < 3; i ++ ) this.impactBuffers.push( createImpactBuffer( ctx, i + 1, 0.4 ) );
		for ( let i = 0; i < 3; i ++ ) this.impactBuffers.push( createImpactBuffer( ctx, i + 4, 1.0 ) );
		for ( let i = 0; i < 3; i ++ ) this.impactPlayers.push( this.createSampleSource( this.impactReverbSend ) );

		const loader = new THREE.AudioLoader();

		loader.load( 'audio/skid.ogg', ( buffer ) => {

			this.skidSound.setBuffer( buffer );
			this.skidSound.setLoop( true );
			this.skidSound.setVolume( 0 );

			if ( this.unlocked ) this.startSounds();

		} );

		const unlock = () => {

			if ( this.unlocked ) return;
			this.unlocked = true;

			if ( ctx.state === 'suspended' ) ctx.resume();

			this.startSounds();

			window.removeEventListener( 'keydown', unlock );
			window.removeEventListener( 'click', unlock );
			window.removeEventListener( 'touchstart', unlock );

		};

		window.addEventListener( 'keydown', unlock );
		window.addEventListener( 'click', unlock );
		window.addEventListener( 'touchstart', unlock );

		// Pause all audio while the game is not in front (tab hidden, another
		// window focused: AudioFocus.js); resume once it is back (only if the
		// user has already interacted to unlock playback, and not in the pause)
		onAudioFocus( ( away ) => {

			if ( away ) {

				if ( ctx.state === 'running' ) ctx.suspend();

			} else if ( this.unlocked && ! this.paused && ctx.state === 'suspended' ) {

				ctx.resume();

			}

		} );

	}

	// Game paused: silence everything (the context keeps its state)
	setPaused( paused ) {

		this.paused = paused;
		const ctx = this.listener.context;
		if ( paused && ctx.state === 'running' ) ctx.suspend();
		else if ( ! paused && this.unlocked && ! isAway() && ctx.state === 'suspended' ) ctx.resume();

	}

	async initEngine() {

		const ctx = this.listener.context;

		const engine = new EngineSound( ctx );

		this.engineGain = ctx.createGain();
		this.engineGain.gain.value = ENGINE_VOLUME * this.volumes.engine;
		engine.output.connect( this.engineGain );

		// Fairly present: a moderate reference distance, a fixed high-end
		// rolloff instead of the environment's distance-driven lowpass, and a
		// light reverb send. It pans with the car but sits a little back.
		const tone = this.neutralLowpass();
		tone.frequency.value = ENGINE_CUTOFF;

		const audio = new THREE.PositionalAudio( this.listener );
		audio.setRefDistance( ENGINE_REF_DISTANCE );
		audio.panner.panningModel = 'equalpower';
		audio.setFilter( tone );
		audio.setNodeSource( this.engineGain );
		this.target.add( audio );

		this.engineGain.connect( this.engineReverbSend );

		await engine.load();
		this.engine = engine;

	}

	// A transparent-until-driven lowpass. filters[0] on each source is the
	// perspective/distance filter; sample sources add a second for tone.
	neutralLowpass() {

		const filter = this.listener.context.createBiquadFilter();
		filter.type = 'lowpass';
		filter.Q.value = 0.0001;
		filter.frequency.value = 20000;

		return filter;

	}

	// Positional source on the vehicle. filters[0] is registered as the
	// distance filter; it must be set before the source connects.
	makePositional( filters ) {

		const audio = new THREE.PositionalAudio( this.listener );
		audio.setRefDistance( REF_DISTANCE );
		audio.panner.panningModel = 'equalpower';
		audio.setFilters( filters );
		this.distanceFilters.push( filters[ 0 ] );
		this.target.add( audio );

		return audio;

	}

	// Sample player: distance filter + a tone filter for per-sound variation,
	// reverb tapped post-gain so the send tracks the sound's own volume.
	createSampleSource( reverbSend ) {

		const tone = this.neutralLowpass();
		const audio = this.makePositional( [ this.neutralLowpass(), tone ] );
		audio.gain.connect( reverbSend );

		return { sound: audio, tone };

	}

	startSounds() {

		if ( this.skidSound.buffer && ! this.skidSound.isPlaying ) this.skidSound.play();

	}

	update( dt, speed, throttle, driftIntensity ) {

		// Cosmetic gearbox: reads speed/throttle, never feeds back into physics
		this.gearbox.update( dt, speed, throttle );

		const now = this.listener.context.currentTime;

		// Perspective filtering: all sources sit on the car, so one distance
		// drives every filter
		this.listener.getWorldPosition( _listenerPos );
		this.target.getWorldPosition( _targetPos );
		const cutoff = distanceCutoff( _listenerPos.distanceTo( _targetPos ) );

		for ( const filter of this.distanceFilters ) {

			filter.frequency.setTargetAtTime( cutoff, now, 0.1 );

		}

		if ( this.engine ) this.engine.update( this.gearbox );

		if ( this.skidSound.buffer ) {

			const shouldSkid = driftIntensity > 0.5;
			let skidVol = 0;

			if ( shouldSkid ) {

				skidVol = remap(
					THREE.MathUtils.clamp( driftIntensity, 0.5, 2.0 ),
					0.5, 2.0, 0.08, 0.35
				);

			}

			this.skidSound.gain.gain.setTargetAtTime( skidVol * this.volumes.tyres, now, 0.05 );

			const skidPitch = THREE.MathUtils.clamp( Math.abs( speed ), 1, 3 );
			const curPitch = this.skidSound.getPlaybackRate();
			this.skidSound.setPlaybackRate( THREE.MathUtils.lerp( curPitch, skidPitch, 0.1 ) );

			// Tone opens as the drift digs in: light slides stay dull,
			// hard drifts scream
			const intensity01 = THREE.MathUtils.clamp(
				remap( driftIntensity, 0.5, 1.6, 0, 1 ), 0, 1
			);
			this.skidTone.frequency.setTargetAtTime( 2500 + intensity01 * 7500, now, 0.1 );

		}

	}

	playImpact( impactVelocity ) {

		if ( ! this.unlocked ) return;

		// Round-robin a player; swap in a random buffer from the soft or hard
		// set so repeated hits of the same strength still differ.
		const { sound, tone } = this.impactPlayers[ this.impactIndex % this.impactPlayers.length ];
		this.impactIndex ++;

		const set = impactVelocity < IMPACT_HARD_VELOCITY ? 0 : 3;
		const buffer = this.impactBuffers[ set + ( Math.random() * 3 | 0 ) ];

		if ( sound.isPlaying ) sound.stop();
		sound.setBuffer( buffer );

		const volume = THREE.MathUtils.clamp(
			remap( impactVelocity, 0, IMPACT_MAX_VELOCITY, 0.01, 1.0 ), 0.01, 1.0 );
		sound.setVolume( volume );

		// Variation on top of the seeded buffers: pitch jitter per hit,
		// tone tracks hit strength
		sound.setPlaybackRate( 0.9 + Math.random() * 0.2 );

		const brightness = THREE.MathUtils.clamp( impactVelocity / IMPACT_MAX_VELOCITY, 0, 1 );
		tone.frequency.value = ( 2500 + brightness * 9000 ) * ( 0.8 + Math.random() * 0.4 );

		sound.play();

		// PositionalAudio only tracks the panner while playing, so a one-shot
		// otherwise starts at a stale position. Snap it to the car now that
		// it's playing, so the crash attack is localised from the first sample.
		sound.updateMatrixWorld( true );

	}

}
