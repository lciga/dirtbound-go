// Sample-based engine, ported from Overtake (js/audio/engineSound.js).
//
// Real recorded loops, one per rpm step (audio/nsx/<rpm>.wav), crossfaded and
// re-pitched to the gearbox rpm (Gearbox.js). Only the two steps around the
// current rpm play (equal-power fade in log space), each re-pitched through
// playbackRate to hit the exact rpm.
//
//   loop per step ─ crossfade gain ┐
//   loop per step ─ crossfade gain ┤─ tone (lowpass) ─ rasp (highshelf) ─ out
//   ...                            ┘
//
// "Life" layer on top of the steady loops, driven by rpm/load derivatives:
//   - rasp: high shelf opening while the rpm CLIMBS on throttle;
//   - throttle attack faster than release (the "bark" when opening up);
//   - wobble: slow shared pitch drift (strong at idle, gone at high load);
//   - limiter chop: gain chopped at 13 Hz while bouncing off the rev limiter.
//
// Spatialization, distance and reverb stay in Audio.js: `output` is plugged
// into the car's PositionalAudio like the old synth was.
//
// NSX bank (Overtake): loops from the "Honda NSX GT500 2023" Assetto Corsa mod,
// re-pitched at export to their named rpm (±0.6 %).

const BANK_DIR = 'audio/nsx/';
const BANK_RPMS = [ 2100, 3300, 4700, 6000, 7400 ];

const TARGET_RMS = 0.12; // common level after equalization
const LOOP_FADE_SECONDS = 0.05;
const LIMITER_CHOP_HZ = 13;

// Cuts the buffer to a whole number of 720° engine cycles at `rpm` and fades its
// end into the material preceding the start point, so the loop closes without
// a click.
function makeSeamlessLoop( ctx, buffer, rpm ) {

	const s = buffer;
	const cycleFrames = ( s.sampleRate * 120 ) / rpm;
	let fade = Math.round( s.sampleRate * LOOP_FADE_SECONDS );
	let cycles = Math.floor( ( s.length - fade ) / cycleFrames );

	if ( cycles < 1 ) {

		cycles = Math.max( 1, Math.round( s.length / cycleFrames ) );
		fade = Math.max( 0, s.length - Math.round( cycles * cycleFrames ) );

	}

	const M = Math.min( Math.round( cycles * cycleFrames ), s.length - fade );
	const out = ctx.createBuffer( s.numberOfChannels, M, s.sampleRate );

	for ( let ch = 0; ch < s.numberOfChannels; ch ++ ) {

		const src = s.getChannelData( ch );
		const dst = out.getChannelData( ch );

		for ( let i = 0; i < M; i ++ ) dst[ i ] = src[ fade + i ];

		for ( let j = 0; j < fade; j ++ ) {

			const w = ( j + 1 ) / fade;
			const a = Math.cos( ( w * Math.PI ) / 2 );
			const b = Math.sin( ( w * Math.PI ) / 2 );
			dst[ M - fade + j ] = src[ M + j ] * a + src[ j ] * b;

		}

	}

	return out;

}

// Slow (~3 Hz) random walk normalized to ±1, edges faded to 0 so it loops.
function buildWobbleBuffer( ctx, seconds = 4 ) {

	const len = Math.floor( ctx.sampleRate * seconds );
	const buf = ctx.createBuffer( 1, len, ctx.sampleRate );
	const d = buf.getChannelData( 0 );
	const k = 1 - Math.exp( ( - 2 * Math.PI * 3 ) / ctx.sampleRate );
	let y = 0;
	let peak = 0;

	for ( let i = 0; i < len; i ++ ) {

		y += k * ( ( Math.random() * 2 - 1 ) - y );
		d[ i ] = y;
		peak = Math.max( peak, Math.abs( y ) );

	}

	const edge = Math.floor( ctx.sampleRate * 0.05 );

	for ( let i = 0; i < len; i ++ ) {

		const fade = Math.min( 1, i / edge, ( len - 1 - i ) / edge );
		d[ i ] = ( d[ i ] / peak ) * fade;

	}

	return buf;

}

function bufferRms( buffer ) {

	let sum = 0;
	let n = 0;

	for ( let ch = 0; ch < buffer.numberOfChannels; ch ++ ) {

		const d = buffer.getChannelData( ch );
		for ( let i = 0; i < d.length; i ++ ) sum += d[ i ] * d[ i ];
		n += d.length;

	}

	return Math.sqrt( sum / n );

}

export class EngineSound {

	constructor( ctx ) {

		this.ctx = ctx;
		this.samples = null; // [{ rpm, logRpm, norm, source, gain }] once decoded

		this.lastT = 0;
		this.lastRpm = 0;
		this.rpmRateSmooth = 0;
		this.prevBaseGain = 0;

		this.bus = ctx.createGain();

		this.tone = ctx.createBiquadFilter();
		this.tone.type = 'lowpass';
		this.tone.frequency.value = 12000;
		this.tone.Q.value = 0.5;

		this.rasp = ctx.createBiquadFilter();
		this.rasp.type = 'highshelf';
		this.rasp.frequency.value = 1800;
		this.rasp.gain.value = 0;

		this.output = ctx.createGain();
		this.output.gain.value = 0.5;

		// One shared wobble source on every loop's playbackRate: same engine,
		// same tremor, coherent during crossfades.
		const wobbleSrc = ctx.createBufferSource();
		wobbleSrc.buffer = buildWobbleBuffer( ctx );
		wobbleSrc.loop = true;
		this.wobbleDepth = ctx.createGain();
		this.wobbleDepth.gain.value = 0.004;
		wobbleSrc.connect( this.wobbleDepth );
		wobbleSrc.start();

		const limiterChop = ctx.createOscillator();
		limiterChop.type = 'square';
		limiterChop.frequency.value = LIMITER_CHOP_HZ;
		this.limiterDepth = ctx.createGain();
		this.limiterDepth.gain.value = 0;
		limiterChop.connect( this.limiterDepth ).connect( this.output.gain );
		limiterChop.start();

		this.bus.connect( this.tone ).connect( this.rasp ).connect( this.output );

	}

	async load() {

		const ctx = this.ctx;

		const loaded = await Promise.all( BANK_RPMS.map( async ( rpm ) => {

			const res = await fetch( `${BANK_DIR}${rpm}.wav` );
			if ( ! res.ok ) throw new Error( `${BANK_DIR}${rpm}.wav: HTTP ${res.status}` );
			const raw = await ctx.decodeAudioData( await res.arrayBuffer() );
			const loop = makeSeamlessLoop( ctx, raw, rpm );
			return { rpm, buffer: loop, norm: Math.min( TARGET_RMS / bufferRms( loop ), 6 ) };

		} ) );

		this.samples = loaded
			.sort( ( a, b ) => a.rpm - b.rpm )
			.map( ( { rpm, buffer, norm } ) => {

				const source = ctx.createBufferSource();
				source.buffer = buffer;
				source.loop = true;
				this.wobbleDepth.connect( source.playbackRate );
				const gain = ctx.createGain();
				gain.gain.value = 0;
				source.connect( gain ).connect( this.bus );
				source.start();
				return { rpm, logRpm: Math.log( rpm ), norm, source, gain };

			} );

	}

	// `state`: { rpm, redline, load, shifting } from Gearbox.
	update( state ) {

		const samples = this.samples;
		if ( ! samples ) return;

		const t = this.ctx.currentTime;
		const rpm = Math.max( state.rpm, samples[ 0 ].rpm * 0.6 );
		const rpmNorm = state.rpm / state.redline;

		// Clutch open during shifts: the rpm drop is heard off throttle
		const load = state.shifting ? 0 : state.load;

		const dtA = Math.min( Math.max( t - this.lastT, 0.004 ), 0.1 );
		this.lastT = t;
		this.rpmRateSmooth += ( ( state.rpm - this.lastRpm ) / dtA - this.rpmRateSmooth ) * Math.min( 1, dtA * 6 );
		this.lastRpm = state.rpm;

		// Equal-power fade between the two surrounding steps, in log space
		const logRpm = Math.log( rpm );
		let lo = 0;
		while ( lo < samples.length - 2 && samples[ lo + 1 ].logRpm < logRpm ) lo ++;
		const a = samples[ lo ];
		const b = samples[ Math.min( lo + 1, samples.length - 1 ) ];
		const span = b.logRpm - a.logRpm;
		const w = span > 0 ? Math.min( Math.max( ( logRpm - a.logRpm ) / span, 0 ), 1 ) : 0;

		for ( const s of samples ) {

			let g = 0;
			if ( s === a ) g = Math.cos( ( w * Math.PI ) / 2 );
			if ( s === b ) g = Math.sin( ( w * Math.PI ) / 2 ) + ( s === a ? g : 0 );
			if ( g > 0 ) s.source.playbackRate.setTargetAtTime( rpm / s.rpm, t, 0.03 );
			s.gain.gain.setTargetAtTime( g * s.norm, t, 0.05 );

		}

		// Off throttle darkens only on engine braking at high rpm; at idle and
		// under load the recording is already the right sound.
		const offCutoff = 1500 + 12000 * ( 1 - rpmNorm );
		this.tone.frequency.setTargetAtTime( offCutoff + ( 18000 - offCutoff ) * load, t, 0.06 );

		const baseGain = 0.38 + 0.42 * load + 0.20 * rpmNorm;
		this.output.gain.setTargetAtTime( baseGain, t, baseGain > this.prevBaseGain ? 0.02 : 0.07 );
		this.prevBaseGain = baseGain;

		// Up to +7 dB above 1.8 kHz while revving up on throttle
		const raspDb = 7 * load * Math.min( Math.max( this.rpmRateSmooth / 4000, 0 ), 1 );
		this.rasp.gain.setTargetAtTime( raspDb, t, 0.06 );

		this.wobbleDepth.gain.setTargetAtTime( 0.004 * ( 1 - 0.8 * rpmNorm ) * ( 1 - 0.5 * load ), t, 0.1 );

		const atLimiter = state.rpm >= state.redline - 60 && load > 0.5;
		this.limiterDepth.gain.setTargetAtTime( atLimiter ? baseGain * 0.55 : 0, t, 0.02 );

	}

}
