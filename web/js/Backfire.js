// Cosmetic limiter events use the audio clock: a slow frame never queues
// a burst of missed pops. No events at idle, while braking or during shifts.
export class BackfireGate {

	constructor( random = Math.random ) {

		this.random = random;
		this.next = 0;
		this.nextBurst = 0;
		this.remaining = 0;
		this.burstEnd = 0;
		this.count = 0;
		this.level = 1;

	}

	update( state, now ) {

		const active = ! state.shifting && state.load > 0.5 && state.rpm >= state.redline - 60;
		if ( ! active ) { this.remaining = 0; return false; }
		if ( now > this.burstEnd ) this.remaining = 0; // drop missed pops after a stall
		if ( ! this.remaining ) {

			if ( now < this.nextBurst ) return false;
			this.count = 4 + Math.floor( this.random() * 4 );
			this.remaining = this.count;
			this.next = now;
			this.burstEnd = now + 1.2;
			this.nextBurst = now + 6 + this.random() * 6;

		}
		if ( now < this.next ) return false;
		this.remaining --;
		this.level = 0.7 + 0.3 * this.remaining / ( this.count - 1 );
		this.next = now + 0.065 + this.random() * 0.07;
		return true;

	}

}

export class ExhaustBackfire {

	constructor( ctx, output ) {

		this.ctx = ctx;
		this.output = output;
		this.gate = new BackfireGate();
		this.buffers = [];
		this.body = ctx.createBiquadFilter();
		this.body.type = 'lowshelf';
		this.body.frequency.value = 450;
		this.body.gain.value = 6;
		this.body.connect( output );

	}

	async load() {

		// Real exhaust backfires, not the old collision synthesizer.
		// Jonas Jocys, Audi R8 recording, CC BY 4.0; attribution in NOTICE.md.
		this.buffers = await Promise.all( [ 1, 2, 3 ].map( async ( index ) => {

			const res = await fetch( `audio/backfire/${ index }.wav` );
			if ( ! res.ok ) throw new Error( `Backfire ${ index }: HTTP ${ res.status }` );
			return this.ctx.decodeAudioData( await res.arrayBuffer() );

		} ) );

	}

	update( state ) {

		if ( ! this.buffers.length || this.ctx.state !== 'running' || ! this.gate.update( state, this.ctx.currentTime ) ) return;
		const source = this.ctx.createBufferSource();
		source.buffer = this.buffers[ Math.floor( Math.random() * this.buffers.length ) ];
		source.playbackRate.value = 0.97 + Math.random() * 0.06;
		const gain = this.ctx.createGain();
		gain.gain.value = this.gate.level * ( 0.9 + Math.random() * 0.1 );
		source.connect( gain ).connect( this.body );
		source.onended = () => { source.disconnect(); gain.disconnect(); };
		source.start();

	}

}
