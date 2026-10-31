import * as THREE from 'three';

const _desired = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _lookPoint = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

// Two views: 'iso' (the fixed 45° view from above, Godot's) and 'chase' (third
// person behind the car, Trackmania style: lags the car's heading a little,
// widens with speed, never under the ground)
export const VIEWS = [ 'iso', 'chase' ];
const ISO_FOV = 40;
const CHASE = Object.freeze( {
	distance: 4.6, // m behind the car
	height: 1.8, // m above it
	lookAhead: 4, // m ahead of the car where it looks…
	lookUp: 0.7, // …this high
	fov: 62, // degrees at rest…
	fovFast: 76, // …at top speed
	turn: 5, // how fast it swings round behind the car (1/s)
	follow: 12, // how fast it follows the car's position (1/s)
	clearance: 0.5, // m above the ground, at least
} );

// Shake (explosions): "trauma" 0..1 added by shake(), worn off over time; the
// offset grows with its square, so small knocks stay small
const SHAKE_MOVE = 0.4; // m at full trauma
const SHAKE_ROLL = 0.035; // rad at full trauma
const SHAKE_DECAY = 1.5; // trauma lost per s
const SHAKE_SPEED = 26; // how fast it jitters

export class Camera {

	constructor() {

		this.camera = new THREE.PerspectiveCamera( 40, window.innerWidth / window.innerHeight, 0.1, 60 );

		// Matches Godot View: 45° azimuth, 35° elevation, distance 16
		this.offset = new THREE.Vector3( 9.27, 9.18, 9.27 );

		this.camera.position.copy( this.offset );
		this.camera.lookAt( 0, 0, 0 );

		// Camera-aligned ground basis (XZ plane), derived from offset.
		// camRightXZ: screen-right projected to ground.
		// camForwardXZ: screen-up (away from camera) projected to ground.
		this.camRightXZ = new THREE.Vector3( this.offset.z, 0, - this.offset.x ).normalize();
		this.camForwardXZ = new THREE.Vector3( - this.offset.x, 0, - this.offset.z ).normalize();

		this.leadFactor = 3.0;
		this.cameraSmoothing = 2.0;
		this.deadzoneRadius = 5.0;
		this.screenShiftUp = 1.0;

		this.smoothedDesired = new THREE.Vector3();
		this.view = 'iso';
		this.chaseYaw = null; // heading the chase view swings towards the car's
		this.chasePos = new THREE.Vector3();
		this.trauma = 0;
		this.shakeTime = 0;
		this.initialized = false;

		const segments = 64;
		const points = [];
		for ( let i = 0; i <= segments; i ++ ) {

			const a = ( i / segments ) * Math.PI * 2;
			points.push( new THREE.Vector3( Math.cos( a ), 0, Math.sin( a ) ) );

		}
		const dzGeom = new THREE.BufferGeometry().setFromPoints( points );
		this.debug = new THREE.Line( dzGeom, new THREE.LineBasicMaterial( { color: 0xff00ff, depthTest: false } ) );
		this.debug.visible = false;
		this.debug.renderOrder = 999;
		this.debug.quaternion.setFromRotationMatrix(
			new THREE.Matrix4().makeBasis( this.camRightXZ, new THREE.Vector3( 0, 1, 0 ), this.camForwardXZ )
		);

		window.addEventListener( 'resize', () => {

			this.camera.aspect = window.innerWidth / window.innerHeight;
			this.camera.updateProjectionMatrix();

		} );

	}

	// 'iso' or 'chase'
	setView( view ) {

		this.view = VIEWS.includes( view ) ? view : 'iso';
		this.camera.fov = this.view === 'chase' ? CHASE.fov : ISO_FOV;
		this.camera.updateProjectionMatrix();
		this.chaseYaw = null;
		this.initialized = false;

	}

	// amount 0..1 (stacks, capped)
	shake( amount ) {

		this.trauma = Math.min( 1, this.trauma + amount );

	}

	applyShake( dt ) {

		if ( this.trauma <= 0 ) return;
		this.shakeTime += dt * SHAKE_SPEED;
		const k = this.trauma * this.trauma;
		const n = ( a, b ) => Math.sin( this.shakeTime * a + b ) * 0.6 + Math.sin( this.shakeTime * a * 2.3 + b * 3 ) * 0.4;
		const right = this.view === 'chase' ? _right.set( 1, 0, 0 ).applyQuaternion( this.camera.quaternion ) : this.camRightXZ;
		this.camera.position.addScaledVector( right, n( 1, 0 ) * SHAKE_MOVE * k );
		this.camera.position.y += n( 1.3, 2 ) * SHAKE_MOVE * k;
		this.camera.rotateZ( n( 0.9, 4 ) * SHAKE_ROLL * k );
		this.trauma = Math.max( 0, this.trauma - SHAKE_DECAY * dt );

	}

	// target: the car's centre; velocity: its lead (iso); car: { quaternion,
	// speed 0..1, groundAt( x, z ) → height } for the chase view
	update( dt, target, velocity, car = null ) {

		if ( this.view === 'chase' && car ) {

			this.chase( dt, target, car );
			return;

		}

		const radius = this.deadzoneRadius;
		const radiusSq = radius * radius;

		// Lead = velocity projected onto camera-aligned ground basis, scaled, clamped to the deadzone disk.
		// Becomes the camera's offset from the car: car settles at the trailing edge of the circle.
		let leadX = velocity.dot( this.camRightXZ ) * this.leadFactor;
		let leadY = velocity.dot( this.camForwardXZ ) * this.leadFactor;
		const leadLenSq = leadX * leadX + leadY * leadY;
		if ( leadLenSq > radiusSq ) {

			const k = radius / Math.sqrt( leadLenSq );
			leadX *= k;
			leadY *= k;

		}

		_desired.copy( target )
			.addScaledVector( this.camRightXZ, leadX )
			.addScaledVector( this.camForwardXZ, leadY );

		const alpha = this.initialized ? 1 - Math.exp( - dt * this.cameraSmoothing ) : 1;
		this.smoothedDesired.lerp( _desired, alpha );
		this.initialized = true;

		// Hard-clamp: car must not escape the deadzone, even if the lerp lags at high speed.
		_delta.subVectors( target, this.smoothedDesired );
		const offsetX = _delta.dot( this.camRightXZ );
		const offsetY = _delta.dot( this.camForwardXZ );
		const offsetLenSq = offsetX * offsetX + offsetY * offsetY;
		if ( offsetLenSq > radiusSq ) {

			const offsetLen = Math.sqrt( offsetLenSq );
			const k = ( offsetLen - radius ) / offsetLen;
			this.smoothedDesired
				.addScaledVector( this.camRightXZ, offsetX * k )
				.addScaledVector( this.camForwardXZ, offsetY * k );

		}

		// Shift the entire view (camera + lookAt) so smoothedDesired sits higher on screen.
		_lookPoint.copy( this.smoothedDesired ).addScaledVector( this.camForwardXZ, - this.screenShiftUp );

		this.camera.position.copy( _lookPoint ).add( this.offset );
		this.camera.lookAt( _lookPoint );
		this.applyShake( dt );

		this.debug.position.copy( this.smoothedDesired );
		this.debug.position.y += 0.05;
		this.debug.scale.set( radius, 1, radius );

	}

	// Third person: behind the car's heading, eased
	chase( dt, target, { quaternion, speed = 0, groundAt = null } ) {

		_forward.set( 0, 0, 1 ).applyQuaternion( quaternion );
		const yaw = Math.atan2( _forward.x, _forward.z );

		if ( this.chaseYaw === null ) this.chaseYaw = yaw;
		else {

			const d = Math.atan2( Math.sin( yaw - this.chaseYaw ), Math.cos( yaw - this.chaseYaw ) ); // the short way round
			this.chaseYaw += d * ( 1 - Math.exp( - dt * CHASE.turn ) );

		}

		const fx = Math.sin( this.chaseYaw ), fz = Math.cos( this.chaseYaw );
		_desired.set( target.x - fx * CHASE.distance, target.y + CHASE.height, target.z - fz * CHASE.distance );
		if ( groundAt ) _desired.y = Math.max( _desired.y, groundAt( _desired.x, _desired.z ) + CHASE.clearance );

		if ( this.initialized ) this.chasePos.lerp( _desired, 1 - Math.exp( - dt * CHASE.follow ) );
		else this.chasePos.copy( _desired );
		this.initialized = true;

		this.camera.position.copy( this.chasePos );
		_lookPoint.set( target.x + fx * CHASE.lookAhead, target.y + CHASE.lookUp, target.z + fz * CHASE.lookAhead );
		this.camera.lookAt( _lookPoint );

		const fov = CHASE.fov + ( CHASE.fovFast - CHASE.fov ) * Math.min( 1, Math.max( 0, speed ) );

		if ( Math.abs( fov - this.camera.fov ) > 0.05 ) {

			this.camera.fov += ( fov - this.camera.fov ) * ( 1 - Math.exp( - dt * 3 ) );
			this.camera.updateProjectionMatrix();

		}

		this.applyShake( dt );

	}

}
