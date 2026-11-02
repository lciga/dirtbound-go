// Cosmetic automatic gearbox, ported from Overtake (js/physics/gearbox.js).
//
// It only OBSERVES the car's speed and throttle and derives engine rpm, the
// engaged gear and engine load for the sound. Nothing flows back into
// Vehicle.js: the physics is untouched.
//
// Kept from Overtake: shift thresholds as fractions of the redline, a short
// clutch-open shift (rpm interpolated old -> new gear, throttle cut), downshift
// straight to the best gear for the current speed, launch clutch slip (rpm jumps
// into the clean sample range instead of crawling with the car), limiter flag.
//
// Not kept: the tyre-spin model and the power curve feeding thrust (they drive
// cannon physics there). Gear spacing is re-fitted: this car reaches top speed in
// ~1.5 s, Overtake's six gears would shift every 0.15 s here.

// Acura NSX GT3 (Overtake ENGINES): V6 3.5 biturbo. Idle = the pitch of the
// lowest sample loop (audio/nsx/2100.wav), so it plays natively at rest.
export const REDLINE_RPM = 7500;
export const IDLE_RPM = 2100;

// Overtake thresholds, calibrated on its 9250 rpm reference redline and kept as
// fractions so they follow the NSX redline.
const REF_REDLINE = 9250;
const SHIFT_UP = ( 8600 / REF_REDLINE ) * REDLINE_RPM;
const SHIFT_DOWN = 0.6 * SHIFT_UP;
const DOWNSHIFT_LAND = ( 8200 / REF_REDLINE ) * REDLINE_RPM;
const CLUTCH_LAUNCH = ( 5800 / REF_REDLINE ) * REDLINE_RPM;

const SHIFT_TIME = 0.22; // s, clutch open: rpm interpolated, throttle cut
const MIN_SHIFT_INTERVAL = 0.45; // s between two automatic shifts
const CLUTCH_ENGAGE_RATE = 6; // 1/s

// Normalized speed (|linearSpeed| / MAX_SPEED) at which each gear reaches
// SHIFT_UP. Full throttle levels off at ~0.94; the taller final gear keeps
// cruising below a continuous limiter. This changes sound only; ordinary
// acceleration still comes from Vehicle.js / Go Advance.
const GEAR_TOP_SPEED = [ 0.3, 0.5, 0.72, 1.10 ];

// The gearbox reads a lagged copy of the speed: the car itself levels off in
// ~1.5 s, far too short to hear four gears. Rising follows slowly (each gear
// holds ~1 s, like the old synth's gentle rise rate); falling follows fast so
// braking still drops the revs and downshifts right away.
const SPEED_RISE_RATE = 0.9; // 1/s
const SPEED_FALL_RATE = 5; // 1/s

function clamp( v, lo, hi ) {

	return Math.max( lo, Math.min( hi, v ) );

}

export class Gearbox {

	constructor() {

		this.gear = 1;
		this.gearLabel = '1';
		this.rpm = IDLE_RPM;
		this.load = 0;
		this.shifting = false;
		this.revLimit = false;
		this.redline = REDLINE_RPM;

		this.shiftTimer = 0;
		this.shiftFromRpm = 0;
		this.sinceShift = Infinity;
		this.clutchSlip = 0;
		this.speed = 0;

	}

	rpmInGear( speed, gear ) {

		return ( speed / GEAR_TOP_SPEED[ gear - 1 ] ) * SHIFT_UP;

	}

	beginShift( target, fromRpm ) {

		this.shiftFromRpm = fromRpm;
		this.gear = target;
		this.gearLabel = String( target );
		this.shiftTimer = SHIFT_TIME;
		this.sinceShift = 0;
		this.shifting = true;
		this.rpm = fromRpm;

	}

	// `speed`: signed normalized speed (linearSpeed / MAX_SPEED).
	// `throttle`: -1..1 (input.z).
	update( dt, speed, throttle ) {

		const reversing = speed < - 0.02;

		// Reverse is a single gear, no lag needed
		if ( reversing ) this.speed = speed;
		const rate = Math.abs( speed ) > Math.abs( this.speed ) ? SPEED_RISE_RATE : SPEED_FALL_RATE;
		this.speed += ( speed - this.speed ) * Math.min( 1, rate * dt );
		speed = this.speed;

		const absSpeed = Math.abs( speed );

		// Same rule as Vehicle.js: "back" while rolling forward brakes, it is
		// not throttle (and vice versa in reverse).
		throttle = clamp( throttle, - 1, 1 );
		const braking = ( throttle < - 0.05 && speed > 0.01 ) || ( throttle > 0.05 && speed < - 0.01 );
		this.load = braking ? 0 : Math.abs( throttle );
		this.revLimit = false;

		if ( reversing ) {

			this.gear = 1;
			this.gearLabel = 'R';
			this.shifting = false;
			this.shiftTimer = 0;
			this.rpm = Math.max( IDLE_RPM, Math.min( this.rpmInGear( absSpeed, 1 ), REDLINE_RPM ) );
			return this;

		}

		this.gearLabel = String( this.gear );
		this.sinceShift += dt;

		let rpm = Math.max( IDLE_RPM, this.rpmInGear( absSpeed, this.gear ) );

		// Launch: in 1st on the throttle, the clutch slips and the engine jumps
		// to CLUTCH_LAUNCH, then follows the wheel as soon as it catches up.
		const clutchOpen = this.load > 0.5 && this.gear === 1 && rpm < CLUTCH_LAUNCH;
		this.clutchSlip += ( ( clutchOpen ? 1 : 0 ) - this.clutchSlip ) * Math.min( 1, CLUTCH_ENGAGE_RATE * dt );
		rpm = Math.max( rpm, CLUTCH_LAUNCH * this.clutchSlip );

		if ( this.shiftTimer > 0 ) {

			// Shift in progress: rpm drops on upshifts, blips on downshifts.
			this.shiftTimer -= dt;
			const progress = clamp( 1 - this.shiftTimer / SHIFT_TIME, 0, 1 );
			this.rpm = this.shiftFromRpm + ( Math.min( rpm, REDLINE_RPM ) - this.shiftFromRpm ) * progress;
			this.shifting = this.shiftTimer > 0;
			return this;

		}

		this.shifting = false;

		if ( this.sinceShift >= MIN_SHIFT_INTERVAL ) {

			// Decisions on the speed-bound rpm, not the clutch-slipped one.
			const groundRpm = Math.max( IDLE_RPM, this.rpmInGear( absSpeed, this.gear ) );

			if ( groundRpm > SHIFT_UP && this.gear < GEAR_TOP_SPEED.length && this.load > 0.1 ) {

				this.beginShift( this.gear + 1, Math.min( rpm, REDLINE_RPM ) );
				return this;

			}

			if ( groundRpm < SHIFT_DOWN && this.gear > 1 ) {

				// Lowest gear that still lands under DOWNSHIFT_LAND: 4 -> 2
				// under hard braking, not 4 -> 3 -> 2.
				let target = this.gear;

				for ( let g = this.gear - 1; g >= 1; g -- ) {

					if ( this.rpmInGear( absSpeed, g ) <= DOWNSHIFT_LAND ) target = g;
					else break;

				}

				if ( target < this.gear ) {

					this.beginShift( target, rpm );
					return this;

				}

			}

		}

		this.revLimit = rpm >= REDLINE_RPM;
		this.rpm = Math.min( rpm, REDLINE_RPM );
		return this;

	}

}
