import * as THREE from 'three';
import { ROAD_Y } from '../SplineTrack.js';

// The menu backdrop's driver: no physics, the car is laid on the rally route
// (RallyStage chunks) and driven flat out like a player would — braking for
// the corners, cutting to the inside, sliding sideways through them with
// counter-steer, smoke from the rear wheels — all in extreme slow motion.
//
// rig = the car's frame for the camera: on the road under the car, turned to
// where it is going (not where its nose points), so the drift angle shows.

const SLOWMO = 0.12; // time scale of everything the car does
const V_MAX = 18; // u/s flat out (real time)
const GRIP = 13; // u/s² of lateral acceleration it carries through corners
const ACCEL = 7, BRAKE = 16; // u/s²
const JERK = 25; // u/s³: how fast the pedals move
const LOOK = 28; // m of road checked ahead for the braking speed
const LINE = 1.4; // m max off the centreline (cutting to the inside)
const LINE_SPAN = 12; // m each side the curvature is averaged over for the line
const SLIP_GAIN = 0.05; // rad of drift per u/s² of lateral acceleration
const SLIP_MAX = 0.75; // rad
const WHEEL_RADIUS = 0.14; // world units
const GAP = 6.5; // m kept behind the car ahead

const _f = {};
const _g = {};
const _c = {}; // curvature's own scratch: never clobbers _f / _g

export class MenuDrive {

	constructor( stage, start = 40 ) {

		this.stage = stage;
		this.s = start; // arc length along the route
		this.speed = 9;
		this.parked = false; // standing still (the home screen, a scene change): nothing moves but the settling
		this.lane = 0; // m added to the racing line (the other cars of the multiplayer backdrop)
		this.leader = null; // a MenuDrive ahead: kept `gap` behind it
		this.gap = GAP; // m (the studio packs the cars tighter)
		// How it drives (lab/studio.html sets them per car): top speed u/s, lateral grip u/s²,
		// drift per u/s² of lateral load and its cap (rad), m off the centreline at most
		this.tune = { vmax: V_MAX, grip: GRIP, slipGain: SLIP_GAIN, slipMax: SLIP_MAX, line: LINE };
		this.yaw = 0; // heading + slip: where the nose points
		this.slip = 0;
		this.accel = 0;
		this.time = 0;
		this.model = null;
		this.wheels = [];
		this.front = [];
		this.position = new THREE.Vector3();
		this.rig = new THREE.Object3D(); // camera frame
		this.driftIntensity = 0; // SmokeTrails reads these three
		this.container = { position: this.position };
		this.wheelBL = null;
		this.wheelBR = null;

	}

	setModel( model ) {

		this.model = model;
		this.wheels = [];
		this.front = [];
		this.wheelBL = this.wheelBR = null;
		this.body = null;
		model.rotation.order = 'YXZ';

		model.traverse( ( c ) => {

			const name = c.name.toLowerCase();

			if ( name === 'body' ) {

				c.rotation.order = 'YXZ';
				this.body = c;

			} else if ( name.includes( 'wheel' ) ) {

				c.rotation.order = 'YXZ';
				this.wheels.push( c );
				if ( name.includes( 'front' ) ) this.front.push( c );
				if ( name.includes( 'back' ) && name.includes( 'left' ) ) this.wheelBL = c;
				if ( name.includes( 'back' ) && name.includes( 'right' ) ) this.wheelBR = c;

			}

		} );

	}

	// Road centre frame at route arc length s (among the built chunks)
	frame( s, out ) {

		const chunks = this.stage.chunks;
		let chunk = chunks[ chunks.length - 1 ];

		for ( const c of chunks ) {

			if ( s <= c.startS + c.length ) {

				chunk = c;
				break;

			}

		}

		chunk.path.frameAt( ( s - chunk.startS ) / chunk.scale, out );
		return out;

	}

	// Signed curvature (1/m, > 0 = turning left) at s
	curvature( s ) {

		this.frame( s - 1.5, _c );
		const a0 = Math.atan2( _c.tx, _c.tz );
		this.frame( s + 1.5, _c );
		let d = Math.atan2( _c.tx, _c.tz ) - a0;
		d = Math.atan2( Math.sin( d ), Math.cos( d ) );
		return d / 3;

	}

	// Racing line: off the centreline towards the inside of the coming bend
	lineAt( s, out ) {

		let k = 0;
		for ( let d = - LINE_SPAN; d <= LINE_SPAN; d += 3 ) k += this.curvature( s + d );
		k /= 2 * LINE_SPAN / 3 + 1;

		const offset = THREE.MathUtils.clamp( k * 12, - this.tune.line, this.tune.line ) + this.lane;
		this.frame( s, out );
		out.x += out.tz * offset; // left = tangent turned +90°
		out.z -= out.tx * offset;
		return out;

	}

	// Stops dead at arc length s (default: where it is), on the racing line
	park( s = this.s ) {

		this.s = s;
		this.speed = 0;
		this.accel = 0;
		this.parked = true;
		this.place( 0 );

	}

	// Off again from a standstill
	launch() {

		this.parked = false;

	}

	update( dtReal ) {

		const dt = dtReal * SLOWMO;

		// Parked: the slide and the body settle (in real time, a scene change is short)
		if ( this.parked ) {

			this.slip += ( 0 - this.slip ) * Math.min( 1, dtReal * 4 );
			this.place( dtReal, true );
			return;

		}

		this.time += dt;

		// Braking speed: the tightest bend in sight
		const { vmax, grip, slipGain, slipMax } = this.tune;
		let target = vmax;
		for ( let d = 0; d <= LOOK; d += 1.5 ) target = Math.min( target, Math.sqrt( grip / Math.max( 1e-3, Math.abs( this.curvature( this.s + d ) ) ) ) + d * 0.12 );

		// Behind another car: no closer than its gap
		if ( this.leader ) target = Math.max( 0, Math.min( target, this.leader.speed + ( this.leader.s - this.s - this.gap ) * 1.2 ) );

		// Pedals eased in and out: acceleration proportional to the speed gap,
		// and it can only change so fast (no flicking between throttle and
		// brake, which pitched the body back and forth)
		const wanted = THREE.MathUtils.clamp( ( target - this.speed ) * 1.5, - BRAKE, ACCEL );
		this.accel += THREE.MathUtils.clamp( wanted - this.accel, - JERK * dt, JERK * dt );
		this.speed = Math.max( this.leader ? 0 : Math.min( 2, this.speed + 1 ), this.speed + this.accel * dt ); // pulls away from a standstill
		this.s += this.speed * dt;

		// Drift: the nose swings into the bend with the lateral load, plus a
		// slow wobble so no two slides look alike
		const k = this.curvature( this.s + 2 );
		const lateral = this.speed * this.speed * k;
		const wobble = 0.06 * Math.sin( this.time * 1.7 ) * Math.min( 1, Math.abs( lateral ) / 4 );
		const slipTarget = THREE.MathUtils.clamp( lateral * slipGain, - slipMax, slipMax ) + wobble;
		this.slip += ( slipTarget - this.slip ) * Math.min( 1, dt * 2.5 );
		this.driftIntensity = Math.abs( this.slip ) / 0.45; // smoke past ~18° (SmokeTrails: > 0.7)
		this.place( dt );

	}

	// Everything that moves it, to go back to that moment (lab/studio.html scrubs its timeline)
	snapshot() {

		return {
			s: this.s, speed: this.speed, slip: this.slip, accel: this.accel, time: this.time, parked: this.parked, drift: this.driftIntensity,
			body: this.body ? [ this.body.rotation.x, this.body.rotation.z ] : null,
			wheels: this.wheels.map( ( w ) => [ w.rotation.x, w.rotation.y ] ),
		};

	}

	restore( o ) {

		Object.assign( this, { s: o.s, speed: o.speed, slip: o.slip, accel: o.accel, time: o.time, parked: o.parked, driftIntensity: o.drift } );
		if ( this.body && o.body ) this.body.rotation.set( o.body[ 0 ], this.body.rotation.y, o.body[ 1 ] );
		this.wheels.forEach( ( w, i ) => { if ( o.wheels[ i ] ) w.rotation.set( o.wheels[ i ][ 0 ], o.wheels[ i ][ 1 ], w.rotation.z ); } );
		this.place( 0 ); // dt 0: the body, wheels and steer stay as restored

	}

	// The car and the camera frame at the current s (dt = the body's easing step)
	place( dt, settle = false ) {

		// Position on the line and direction of travel
		this.lineAt( this.s + 0.5, _g );
		this.lineAt( this.s, _f );
		const heading = Math.atan2( _g.x - _f.x, _g.z - _f.z );
		const grade = _f.gy || 0;
		this.position.set( _f.x, _f.y + ROAD_Y, _f.z );
		this.yaw = heading + this.slip;
		if ( settle ) this.driftIntensity = 0;
		const k = settle ? 0 : this.curvature( this.s + 2 );

		// Camera frame: under the car, facing the way it travels
		this.rig.position.set( _f.x, _f.y, _f.z );
		this.rig.rotation.y = heading;
		this.rig.updateMatrixWorld();

		if ( ! this.model ) return;

		this.model.position.copy( this.position );
		this.model.rotation.set( - Math.atan( grade ), this.yaw, 0 );

		if ( this.body ) {

			this.body.rotation.z = - this.slip * 0.14; // leans out of the bend
			const pitch = THREE.MathUtils.clamp( - this.accel / 90, - 0.06, 0.06 ); // squats, dives
			this.body.rotation.x += ( pitch - this.body.rotation.x ) * Math.min( 1, dt * 4 );

		}

		for ( const w of this.wheels ) w.rotation.x += this.speed * dt / WHEEL_RADIUS;
		if ( settle ) return;

		// Front wheels point where the car goes: counter-steer in the slide
		const steer = THREE.MathUtils.clamp( - this.slip + k * 1.2, - 0.6, 0.6 );
		for ( const w of this.front ) w.rotation.y += ( steer - w.rotation.y ) * Math.min( 1, dt * 8 );

	}

}

export { SLOWMO };
