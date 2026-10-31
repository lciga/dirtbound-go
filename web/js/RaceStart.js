// A local race starts only after the loading curtain has fully opened.
// While blocked, physics and clocks stay frozen even if throttle is held.
export class RaceStart {
	constructor( seconds = 3 ) {
		this.remaining = seconds;
		this.ready = false;
	}
	begin() { this.ready = true; }
	get blocked() { return ! this.ready || this.remaining > 0; }
	get label() {
		if ( ! this.ready || this.remaining <= - 1 ) return '';
		return this.remaining > 0 ? String( Math.ceil( this.remaining - 1e-9 ) ) : 'go';
	}
	update( dt, { paused = false, visible = true } = {} ) {
		if ( this.ready && ! paused && visible && Number.isFinite( dt ) && dt > 0 ) {
			// A loading/visibility hitch must not skip the visible countdown.
			this.remaining = Math.max( - 1, this.remaining - Math.min( dt, 0.1 ) );
			if ( Math.abs( this.remaining ) < 1e-9 ) this.remaining = 0;
		}
	}
}
