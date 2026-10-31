// A single launch window for this race, armed by the countdown's GO only.
// Lap crossings and quick restarts must never re-arm it.
export class LaunchBurnout {

	constructor( duration = 1.5 ) {

		this.duration = duration;
		this.remaining = 0;
		this.consumed = false;

	}

	update( dt, started, throttle, raceAge = null ) {

		if ( started && ! this.consumed ) {

			this.consumed = true;
			this.remaining = Math.max( 0, this.duration - ( raceAge ?? 0 ) );

		}
		if ( ! started || this.remaining <= 0 ) return 0;
		const fade = Math.min( 1, this.remaining / 0.5 );
		const intensity = Math.max( 0, Math.min( 1, ( throttle - 0.2 ) / 0.8 ) ) * fade;
		this.remaining = Math.max( 0, this.remaining - Math.max( 0, dt ) );
		return intensity;

	}

	cancel() {

		this.consumed = true;
		this.remaining = 0;

	}

}
