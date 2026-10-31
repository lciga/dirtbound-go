// Sound-only turbo state: it observes the cosmetic gearbox, never the
// vehicle's driving equations. Pressure needs time under load to build.
export class TurboState {

	constructor() {

		this.pressure = 0;
		this.charged = false;
		this.cooldown = 0;

	}

	update( dt, state ) {

		dt = Math.max( 0, Math.min( dt, 0.1 ) );
		this.cooldown = Math.max( 0, this.cooldown - dt );
		const load = state.shifting ? 0 : state.load;
		const rpm = Math.max( 0, Math.min( 1, state.rpm / state.redline ) );
		const target = load * Math.max( 0, ( rpm - 0.3 ) / 0.7 );
		const before = this.pressure;
		this.pressure += ( target - this.pressure ) * ( 1 - Math.exp( - dt / ( target > this.pressure ? 0.65 : 0.22 ) ) );
		if ( this.pressure > 0.38 && load > 0.5 ) this.charged = true;
		let release = 0;
		if ( load < 0.2 && this.charged && ! this.cooldown ) {

			release = before;
			this.pressure *= 0.3;
			this.charged = false;
			this.cooldown = 0.55;

		}
		return release;

	}

}

// A reusable noise loop and a short valve burst; no per-frame buffers.
const FLUTTER_PULSES = [ 0, 0.048, 0.108, 0.184, 0.276, 0.388 ];

export function turboNoise( rate, seconds, valve = false ) {

	const data = new Float32Array( Math.ceil( rate * seconds ) );
	let seed = 0x715b3;
	for ( let i = 0; i < data.length; i ++ ) {

		seed = ( Math.imul( seed, 1664525 ) + 1013904223 ) >>> 0;
		const t = i / rate;
		const fade = Math.min( 1, t / 0.004, ( data.length - 1 - i ) / ( rate * 0.012 ) );
		let envelope = valve ? 0 : 1, tone = 0;
		if ( valve ) {

			// Compressor flutter: distinct "stu-tu-tu", weakening and slowing
			// as stored pressure escapes. One buffer, not six live players.
			const pulses = FLUTTER_PULSES;
			for ( let n = 0; n < pulses.length; n ++ ) {

				const age = t - pulses[ n ];
				if ( age < 0 ) break;
				const strength = Math.min( 1, age / 0.002 ) * Math.exp( - age / 0.012 ) * Math.pow( 0.83, n );
				if ( strength > envelope ) {

					envelope = strength;
					const frequency = 2100 * Math.pow( 0.9, n );
					tone = Math.sin( 2 * Math.PI * frequency * ( 1 - Math.exp( - age * 8 ) ) / 8 );

				}

			}

		}
		data[ i ] = ( ( seed / 2147483648 - 1 ) * ( valve ? 0.75 : 1 ) + tone * 0.2 ) * fade * envelope;

	}
	return data;

}

export class TurboSound {

	constructor( ctx, output ) {

		this.ctx = ctx;
		this.output = output;
		this.state = new TurboState();
		this.whistle = ctx.createOscillator();
		this.whistle.type = 'sine';
		this.whistle.frequency.value = 1200;
		this.whistleGain = ctx.createGain();
		this.whistleGain.gain.value = 0;
		this.whistle.connect( this.whistleGain ).connect( output );
		this.whistle.start();

		this.air = ctx.createBufferSource();
		this.air.buffer = this.buffer( turboNoise( ctx.sampleRate, 0.7 ) );
		this.air.loop = true;
		this.airFilter = ctx.createBiquadFilter();
		this.airFilter.type = 'bandpass';
		this.airFilter.Q.value = 0.8;
		this.airGain = ctx.createGain();
		this.airGain.gain.value = 0;
		this.air.connect( this.airFilter ).connect( this.airGain ).connect( output );
		this.air.start();
		this.valve = this.buffer( turboNoise( ctx.sampleRate, 0.56, true ) );

	}

	buffer( samples ) {

		const buffer = this.ctx.createBuffer( 1, samples.length, this.ctx.sampleRate );
		buffer.copyToChannel( samples, 0 );
		return buffer;

	}

	update( dt, gearbox ) {

		if ( this.ctx.state !== 'running' ) return;
		const now = this.ctx.currentTime;
		const release = this.state.update( dt, gearbox );
		const pressure = this.state.pressure;
		const intensity = Math.pow( pressure, 1.7 );
		this.whistle.frequency.setTargetAtTime( 1100 + 3100 * pressure, now, 0.08 );
		this.whistleGain.gain.setTargetAtTime( intensity * 0.05, now, 0.06 );
		this.airFilter.frequency.setTargetAtTime( 1500 + 3000 * pressure, now, 0.08 );
		this.airGain.gain.setTargetAtTime( intensity * 0.045, now, 0.06 );
		if ( ! release ) return;

		const source = this.ctx.createBufferSource();
		source.buffer = this.valve;
		source.playbackRate.value = 0.92 + Math.random() * 0.12;
		const filter = this.ctx.createBiquadFilter();
		filter.type = 'bandpass';
		filter.frequency.setValueAtTime( 1100 + release * 1500, now );
		filter.frequency.exponentialRampToValueAtTime( 800, now + 0.5 );
		filter.Q.value = 1.1;
		const gain = this.ctx.createGain();
		gain.gain.value = release * 0.55;
		source.connect( filter ).connect( gain ).connect( this.output );
		source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
		source.start();

	}

}
