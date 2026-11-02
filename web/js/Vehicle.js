import * as THREE from 'three';
import { rigidBody, contacts } from 'crashcat';
import { physics } from './GoPhysics.js';

const _tmpVec = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _zAxis = new THREE.Vector3();
const _newZ = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3( 0, 1, 0 );
const _groundUp = new THREE.Vector3();
const _groundVelocity = new THREE.Vector3();
const ZERO3 = [ 0, 0, 0 ];

export const STATE_SIZE = 18; // numbers of saveState

export const MAX_SPEED = 1.5;

function lerpAngle(a, b, t) { return physics.angle(a, b, t); }

export class Vehicle {

	constructor( { beta = false } = {} ) {
 this.beta=beta;
 this.transmission={gear:1,gearLabel:"1",rpm:1800,redline:7500,shift:0,hold:0,shifting:false,load:0};

		this.linearSpeed = 0;
		this.angularSpeed = 0;
		this.acceleration = 0;

		this.spherePos = new THREE.Vector3( 3.5, 0.5, 5 );
		this.sphereVel = new THREE.Vector3();

		this.rigidBody = null;
		this.physicsWorld = null;
		this.groundBody = null;

		this.modelVelocity = new THREE.Vector3();
		this.prevModelPos = new THREE.Vector3( 3.5, 0, 5 );

		this.spawnPosition = new THREE.Vector3( 3.5, 0.5, 5 );
		this.spawnAngle = 0;

		// Optional ( x, z, out ) => out ground normal, for tracks with relief
		this.getGroundNormal = null;
		this.fallY = - 10;
		this.speedFactor = 1; // top speed multiplier: < 1 off the road (rally grass)

		this.container = new THREE.Group();
		this.bodyNode = null;
		this.bodyRestY = 0.3; // body height it springs back to (model units)
		this.wheels = [];
		this.wheelFL = null;
		this.wheelFR = null;
		this.wheelBL = null;
		this.wheelBR = null;

		this.inputX = 0;
		this.inputZ = 0;
		this.handbrake = false;
		this.boost = false;
		this.boostUsed = false; // set when the boost pushed the car; main.js reads and clears it

		this.driftIntensity = 0;

	}

	init( model ) {

		const vehicleModel = model.clone();
		this.visualModel = vehicleModel;

		// Models can declare their own body rest height (rally cars: 0)
		if ( model.userData.bodyY !== undefined ) this.bodyRestY = model.userData.bodyY;

		this.container.add( vehicleModel );

		// Find body and wheel nodes
		vehicleModel.traverse( ( child ) => {

			const name = child.name.toLowerCase();

			if ( name === 'body' ) {

				child.rotation.order = 'YXZ';
				this.bodyNode = child;

			} else if ( name.includes( 'wheel' ) ) {

				child.rotation.order = 'YXZ';
				this.wheels.push( child );

				if ( name.includes( 'front' ) && name.includes( 'left' ) ) this.wheelFL = child;
				if ( name.includes( 'front' ) && name.includes( 'right' ) ) this.wheelFR = child;
				if ( name.includes( 'back' ) && name.includes( 'left' ) ) this.wheelBL = child;
				if ( name.includes( 'back' ) && name.includes( 'right' ) ) this.wheelBR = child;

			}

			if ( child.isMesh ) {

				child.castShadow = true;
				child.receiveShadow = true;

			}

		} );

		return this.container;

	}

	update( dt, controlsInput ) {

		this.inputX = controlsInput.x;
		this.inputZ = controlsInput.z;
		this.handbrake = !! controlsInput.handbrake;
		this.boost = Number( controlsInput.boost ) || 0; // boosts at once (true = 1; bonus races stack them, Boost.js)

		const touch = !!controlsInput.touchActive && (this.inputX !== 0 || this.inputZ !== 0);
		if (touch) {
			_quat.setFromAxisAngle(_up, Math.atan2(this.inputX, this.inputZ));
			this.container.quaternion.slerp(_quat, 1 - Math.exp(-3 * dt));
		}
		_forward.set(0, 0, 1).applyQuaternion(this.container.quaternion);
		const previousAngular = this.angularSpeed;
		const step = physics.advance(this.linearSpeed, this.angularSpeed, this.acceleration,
			dt, this.inputX, this.inputZ, this.handbrake, this.boost, touch,
			this.speedFactor, _forward.x, _forward.z);
		this.linearSpeed = step[0];
		this.angularSpeed = step[1];
		this.inputX = step[3];
		// The touch stick chooses a compass heading, not forward/reverse pedal.
		if (this.beta && touch) this.inputZ = 1;
		if (!touch) {
			if(this.beta && this.rigidBody){
				const v=this.rigidBody.motionProperties.linearVelocity;
				this.angularSpeed=physics.steering(previousAngular,v[0]*_forward.x+v[1]*_forward.y+v[2]*_forward.z,this.inputX,dt);
				this.container.rotateY(this.angularSpeed*dt);
			} else this.container.rotateY(step[4]);
		}
		if (step[6]) this.boostUsed = true;

		_tmpVec.set( 0, 1, 0 ).applyQuaternion( this.container.quaternion );

		if ( _tmpVec.y > 0.5 ) {

			const up = this.getGroundNormal ? this.getGroundNormal( this.spherePos.x, this.spherePos.z, _groundUp ) : _up;
			const targetQuat = this.alignWithY( this.container.quaternion, up );
			this.container.quaternion.slerp( targetQuat, 0.2 );

		}


		if ( this.rigidBody ) {

			_forward.set( 0, 0, 1 ).applyQuaternion( this.container.quaternion );
			_forward.y = 0;
			_forward.normalize();

			_right.set( 1, 0, 0 ).applyQuaternion( this.container.quaternion );
			_right.y = 0;
			_right.normalize();

			const angvel = this.rigidBody.motionProperties.angularVelocity;
			let drive = step[5];
   if(this.beta){
    const v=this.rigidBody.motionProperties.linearVelocity;
    const grounded=!!this.groundBody&&contacts.hasContactsBetweenBodies(this.physicsWorld.contacts,this.rigidBody,this.groundBody);
    const up=this.getGroundNormal?this.getGroundNormal(this.rigidBody.position[0],this.rigidBody.position[2],_groundUp):_up;
    // Drive along the road plane. Horizontal force and wheel spin cancel each
    // other on a slope; neither should overwrite the vertical contact response.
    _forward.addScaledVector(up,-_forward.dot(up)).normalize();
    _right.crossVectors(up,_forward).normalize();
    _groundVelocity.fromArray(v).addScaledVector(up,-(v[0]*up.x+v[1]*up.y+v[2]*up.z));
    const groundSpeed=_groundVelocity.length();
    const speed=v[0]*_forward.x+v[1]*_forward.y+v[2]*_forward.z,t=this.transmission;
    const r=physics.transmission(t.gear,t.rpm,t.shift,t.hold,dt,speed,this.inputZ,this.speedFactor,this.handbrake,groundSpeed);
    Object.assign(t,{gear:r[0],rpm:r[1],shift:r[2],hold:r[3],load:r[5],redline:r[6],shifting:r[2]>0,gearLabel:r[0]<0?'R':String(r[0]),grounded});
    if(grounded){
     const dv=r[4]*dt,spin=angvel[0]*up.x+angvel[1]*up.y+angvel[2]*up.z;
     if(r[7]>0 && groundSpeed>1e-8){
      _groundVelocity.multiplyScalar(-Math.min(1,r[7]*dt/groundSpeed));
     } else _groundVelocity.copy(_forward).multiplyScalar(dv);
     // Explicit arcade tyre grip, independent of the rolling ground sphere.
     // Clamp lateral force, retain normal velocity and allow handbrake slides.
     const lateral=(v[0]+_groundVelocity.x)*_right.x+(v[1]+_groundVelocity.y)*_right.y+(v[2]+_groundVelocity.z)*_right.z;
     const grip=(this.handbrake?3:24)*Math.max(.15,this.speedFactor)/physics.worldMetres;
     const side=Math.max(-grip*dt,Math.min(grip*dt,-lateral*(1-Math.exp(-12*dt))));
     const vx=v[0]+_groundVelocity.x+_right.x*side,vy=v[1]+_groundVelocity.y+_right.y*side,vz=v[2]+_groundVelocity.z+_right.z*side;
     const rolling=vx*_forward.x+vy*_forward.y+vz*_forward.z;
     rigidBody.setLinearVelocity(this.physicsWorld,this.rigidBody,[vx,vy,vz]);
     rigidBody.setAngularVelocity(this.physicsWorld,this.rigidBody,[_right.x*rolling/.5+up.x*spin,_right.y*rolling/.5+up.y*spin,_right.z*rolling/.5+up.z*spin]);
    }
    this.linearSpeed=speed/20*MAX_SPEED;
   }

			if(!this.beta) rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [
				angvel[ 0 ] + _right.x * drive,
				angvel[ 1 ],
				angvel[ 2 ] + _right.z * drive
			] );

			const pos = this.rigidBody.position;
			this.spherePos.set( pos[ 0 ], pos[ 1 ], pos[ 2 ] );

			const vel = this.rigidBody.motionProperties.linearVelocity;
			this.sphereVel.set( vel[ 0 ], vel[ 1 ], vel[ 2 ] );

		}

		this.acceleration = step[2];

		if ( this.spherePos.y < this.fallY ) this.respawn( this.spawnPosition.toArray(), this.spawnAngle );

		this.container.position.set(
			this.spherePos.x,
			this.spherePos.y - 0.5,
			this.spherePos.z
		);

		if ( dt > 0 ) {

			this.modelVelocity.subVectors( this.container.position, this.prevModelPos ).divideScalar( dt );
			this.prevModelPos.copy( this.container.position );

		}

		this.updateBody( dt );
		this.updateWheels( dt );

		_forward.set(0, 0, 1).applyQuaternion(this.container.quaternion);
		const slide = physics.drift(this.linearSpeed, this.acceleration,
			this.sphereVel.x, this.sphereVel.z, _forward.x, _forward.z, this.handbrake);
		this.slipAngle = slide[0];
		this.driftIntensity = slide[1];

	}

	alignWithY( quaternion, newY ) {

		_zAxis.set( 0, 0, 1 ).applyQuaternion( quaternion );
		const xAxis = _tmpVec.crossVectors( _zAxis, newY ).negate().normalize();
		_newZ.crossVectors( xAxis, newY ).normalize();

		_mat4.makeBasis( xAxis, newY, _newZ );
		return _quat.setFromRotationMatrix( _mat4 );

	}

	// Put the car (sphere position) at `position`, facing `angle`, stopped
	respawn( position, angle ) {

		if ( this.rigidBody ) {

			rigidBody.setPosition( this.physicsWorld, this.rigidBody, position, false );
			rigidBody.setLinearVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
			rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );

		}

		this.spherePos.fromArray( position );
 if(this.beta) Object.assign(this.transmission,{gear:1,gearLabel:"1",rpm:1800,shift:0,hold:0,shifting:false,load:0});
		this.sphereVel.set( 0, 0, 0 );
		this.linearSpeed = 0;
		this.angularSpeed = 0;
		this.acceleration = 0;
		this.container.rotation.set( 0, angle, 0 );
		this.container.position.set( position[ 0 ], position[ 1 ] - 0.5, position[ 2 ] );
		if ( this.prevModelPos ) this.prevModelPos.copy( this.container.position );

	}

	// The car's motion in STATE_SIZE numbers at out[ at ] (FlyingStart.js keeps
	// the last seconds of them), and back: position, velocity and spin of the
	// sphere, heading, speeds and body lean
	saveState( out, at ) {

		const p = this.spherePos, v = this.sphereVel, q = this.container.quaternion;
		const spin = this.rigidBody ? this.rigidBody.motionProperties.angularVelocity : ZERO3;
		const body = this.bodyNode;
		out.set( [ p.x, p.y, p.z, v.x, v.y, v.z, spin[ 0 ], spin[ 1 ], spin[ 2 ], q.x, q.y, q.z, q.w,
			this.linearSpeed, this.angularSpeed, this.acceleration, body ? body.rotation.x : 0, body ? body.rotation.z : 0 ], at );

	}

	restoreState( s, at ) {

		const position = [ s[ at ], s[ at + 1 ], s[ at + 2 ] ];
		this.respawn( position, 0 );
		this.sphereVel.set( s[ at + 3 ], s[ at + 4 ], s[ at + 5 ] );

		if ( this.rigidBody ) {

			rigidBody.setLinearVelocity( this.physicsWorld, this.rigidBody, [ s[ at + 3 ], s[ at + 4 ], s[ at + 5 ] ] );
			rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [ s[ at + 6 ], s[ at + 7 ], s[ at + 8 ] ] );

		}

		this.container.quaternion.set( s[ at + 9 ], s[ at + 10 ], s[ at + 11 ], s[ at + 12 ] );
		this.linearSpeed = s[ at + 13 ];
		this.angularSpeed = s[ at + 14 ];
		this.acceleration = s[ at + 15 ];

		if ( this.bodyNode ) {

			this.bodyNode.rotation.x = s[ at + 16 ];
			this.bodyNode.rotation.z = s[ at + 17 ];

		}

	}

	updateBody( dt ) {

		if ( ! this.bodyNode ) return;

		this.bodyNode.rotation.x = lerpAngle(
			this.bodyNode.rotation.x,
			-( this.linearSpeed - this.acceleration ) / 6,
			dt * 10
		);

		this.bodyNode.rotation.z = lerpAngle(
			this.bodyNode.rotation.z,
			-( this.inputX / 5 ) * this.linearSpeed,
			dt * 5
		);

		this.bodyNode.position.y = THREE.MathUtils.lerp( this.bodyNode.position.y, this.bodyRestY, dt * 5 );

	}

	updateWheels( dt ) {

		for ( const wheel of this.wheels ) {

			wheel.rotation.x += this.acceleration;

		}

		if ( this.wheelFL ) {

			this.wheelFL.rotation.y = lerpAngle( this.wheelFL.rotation.y, -this.inputX / 1.5, dt * 10 );

		}

		if ( this.wheelFR ) {

			this.wheelFR.rotation.y = lerpAngle( this.wheelFR.rotation.y, -this.inputX / 1.5, dt * 10 );

		}

	}

}
