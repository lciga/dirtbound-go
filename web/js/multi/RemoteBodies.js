// The other racers' cars as solid obstacles in this player's physics
// (multiplayer with collisions): one kinematic box per car, moved each physics
// step towards where that car is now (moveKinematic gives it the matching
// velocity, so a crash pushes this player's car realistically). A ghost box is
// parked far below the world. Only this player's car reacts: kinematic bodies
// have an infinite mass, and each player computes their own car.

import { rigidBody, box, MotionType } from 'crashcat';
import { COLLISION, clampTarget, alignQuat, limitVelocity } from './Collisions.js';

const PARKED = [ 0, - 1000, 0 ];
const IDENTITY = [ 0, 0, 0, 1 ];

export class RemoteBodies {

	constructor( world ) {

		this.world = world;
		this.bodies = new Map(); // id → { body, active }
		this._pos = [ 0, 0, 0 ];
		this._quat = [ 0, 0, 0, 1 ];

	}

	add( id ) {

		const body = rigidBody.create( this.world, {
			shape: box.create( { halfExtents: [ ...COLLISION.halfExtents ] } ),
			motionType: MotionType.KINEMATIC,
			objectLayer: this.world._OL_MOVING,
			position: [ ...PARKED ],
			friction: 0.0, // like the walls: the car is a sphere spun by its wheels, grip would make it climb
			restitution: 0.1,
			allowSleeping: false, // moveKinematic does not wake a sleeping body
		} );

		this.bodies.set( id, { body, active: false } );

	}

	isActive( id ) {

		return this.bodies.get( id )?.active === true;

	}

	// state: { x, y, z, qx, qy, qz, qw } (car base, as sent), null = no news;
	// velocity: [ x, y, z ] m/s of that car (its real motion)
	update( id, state, velocity, active, dt ) {

		const entry = this.bodies.get( id );
		if ( ! entry ) return;

		if ( ! active || ! state ) {

			if ( entry.active ) this.park( entry.body );
			entry.active = false;
			return;

		}

		// Box centre: centerHeight above the car base, along the car's up axis
		const { qx, qy, qz, qw } = state;
		const h = COLLISION.centerHeight;
		this._pos[ 0 ] = state.x + 2 * ( qx * qy - qw * qz ) * h;
		this._pos[ 1 ] = state.y + ( 1 - 2 * ( qx * qx + qz * qz ) ) * h;
		this._pos[ 2 ] = state.z + 2 * ( qy * qz + qw * qx ) * h;
		this._quat[ 0 ] = qx; this._quat[ 1 ] = qy; this._quat[ 2 ] = qz; this._quat[ 3 ] = qw;

		if ( ! entry.active ) {

			// Turning solid: appear in place (no sweep from the parking spot)
			rigidBody.setTransform( this.world, entry.body, this._pos, this._quat, true );
			rigidBody.setLinearVelocity( this.world, entry.body, [ 0, 0, 0 ] );
			entry.active = true;
			return;

		}

		// Follow the car's real motion; a corrected prediction is caught up at most
		// correctionSpeed beyond it (a crash pushes at the car's speed, not at correction / dt)
		const p = entry.body.position;
		const expected = [ p[ 0 ] + velocity[ 0 ] * dt, p[ 1 ] + velocity[ 1 ] * dt, p[ 2 ] + velocity[ 2 ] * dt ];
		const target = clampTarget( expected, this._pos, COLLISION.correctionSpeed * dt );
		rigidBody.moveKinematic( entry.body, target, alignQuat( this._quat, entry.body.quaternion ), dt );

	}

	remove( id ) {

		const entry = this.bodies.get( id );
		if ( entry ) this.park( entry.body );
		this.bodies.delete( id );

	}

	// Scales a body's horizontal velocity down to maxSpeed (the player's car after a crash)
	limitSpeed( body, maxSpeed ) {

		const v = body.motionProperties.linearVelocity;
		const limited = limitVelocity( v, maxSpeed );
		if ( limited[ 0 ] === v[ 0 ] && limited[ 1 ] === v[ 1 ] && limited[ 2 ] === v[ 2 ] ) return false;
		rigidBody.setLinearVelocity( this.world, body, limited );
		return true;

	}

	// setTransform keeps the velocity: zero it, or the box would drift away
	park( body ) {

		rigidBody.setTransform( this.world, body, PARKED, IDENTITY, false );
		rigidBody.setLinearVelocity( this.world, body, [ 0, 0, 0 ] );
		rigidBody.setAngularVelocity( this.world, body, [ 0, 0, 0 ] );

	}

}
