import * as THREE from 'three';

// The home's 3D logo letters (HomeScene.buildLogo) knocked about by the
// mouse: a letter the pointer sweeps across gets a kick from the pointer's
// speed (a slow pass does nothing, a quick flick a good shake), along the
// pointer's direction and into the scene, and passes some on to its
// neighbours. A simple physics, never a fall: each letter rocks on its foot
// on damped springs back to standing, its lean capped; leaning letters push
// the next one (their tops meet) like soft dominoes.

const MIN_SPEED = 250; // px/s: slower, the pointer just slides over
const FULL_SPEED = 3000; // px/s: the strongest kick from there
const KICK = 5.5; // rad/s of lean speed at full kick, hit at the top
const SHOVE = 0.5; // m/s of slide at full kick
const NEIGHBOUR = 0.3; // share of a kick the letters on either side get
const COOLDOWN = 0.15; // s before the same letter can be kicked again
const STIFF = 34, DAMP = 3.6; // the lean's spring (1/s²) and damping (1/s): a few wobbles
const SLIDE_STIFF = 30, SLIDE_DAMP = 7; // the slide's
const MAX_LEAN = 0.42, MAX_SIDE = 0.24, MAX_TWIST = 0.3, MAX_SLIDE = 0.18; // rad, m
const TOUCH = 260; // 1/s²: how hard leaning tops push each other apart

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _local = new THREE.Vector3();

export class LogoPhysics {

	constructor( logo ) {

		this.logo = logo;
		this.gaps = logo.userData.gaps;
		this.letters = logo.userData.letters.map( ( mesh ) => {

			const box = mesh.geometry.boundingBox;
			return {
				mesh,
				rest: mesh.position.clone(),
				h: box.max.y, halfW: ( box.max.x - box.min.x ) / 2, halfD: ( box.max.z - box.min.z ) / 2,
				lean: new THREE.Vector3(), spin: new THREE.Vector3(), // x: to / from the camera, y: twist, z: sideways
				slide: new THREE.Vector3(), vel: new THREE.Vector3(),
				cool: 0,
			};

		} );

		// The mouse: where, and how fast (px/s, smoothed)
		this.pointer = null;
		this.speed = new THREE.Vector2();
		this.last = 0;
		addEventListener( 'pointermove', ( e ) => {

			if ( e.pointerType !== 'mouse' ) return;
			const now = performance.now();
			if ( this.pointer && now > this.last ) {

				const dt = ( now - this.last ) / 1000;
				const vx = ( e.clientX - this.pointer.x ) / dt, vy = ( e.clientY - this.pointer.y ) / dt;
				const k = Math.min( 1, dt * 30 );
				this.speed.x += ( vx - this.speed.x ) * k;
				this.speed.y += ( vy - this.speed.y ) * k;

			}

			this.pointer = { x: e.clientX, y: e.clientY };
			this.last = now;

		} );
		document.documentElement.addEventListener( 'pointerleave', () => { this.pointer = null; } );

	}

	update( dt, camera ) {

		dt = Math.min( dt, 1 / 20 );
		if ( performance.now() - this.last > 80 ) this.speed.set( 0, 0 ); // the mouse stopped
		for ( const l of this.letters ) l.cool -= dt;
		if ( this.pointer && camera ) this.hit( camera );

		// Two half steps: the springs stay steady at low frame rates
		for ( let s = 0; s < 2; s ++ ) this.step( dt / 2 );

		for ( const l of this.letters ) {

			// Rocking on the edge of its foot, not sinking through the ground
			const lift = l.halfW * Math.abs( Math.sin( l.lean.z ) ) + l.halfD * Math.abs( Math.sin( l.lean.x ) );
			l.mesh.position.copy( l.rest ).add( l.slide ).setY( l.rest.y + lift );
			l.mesh.rotation.set( l.lean.x, l.lean.y, l.lean.z );

		}

	}

	// The letter under the pointer, kicked if the pointer moves fast enough
	hit( camera ) {

		const speed = this.speed.length();
		if ( speed < MIN_SPEED ) return;

		_ndc.set( this.pointer.x / innerWidth * 2 - 1, - ( this.pointer.y / innerHeight * 2 - 1 ) );
		_ray.setFromCamera( _ndc, camera );
		this.logo.updateMatrixWorld( true );
		const hit = _ray.intersectObjects( this.letters.map( ( l ) => l.mesh ), false )[ 0 ];
		if ( ! hit ) return;
		const i = this.letters.findIndex( ( l ) => l.mesh === hit.object );
		const letter = this.letters[ i ];
		if ( letter.cool > 0 ) return;

		// The push in the world: along the pointer on screen, and into the scene
		camera.matrixWorld.extractBasis( _right, _up, _fwd );
		const sx = this.speed.x / speed, sy = this.speed.y / speed;
		_dir.copy( _right ).multiplyScalar( sx ).addScaledVector( _up, - sy ).addScaledVector( _fwd, - 0.6 ).normalize();
		// …in the letters' frame
		this.logo.getWorldQuaternion( _q ).invert();
		_dir.applyQuaternion( _q );
		const strength = Math.min( 1, ( speed - MIN_SPEED ) / ( FULL_SPEED - MIN_SPEED ) );
		// Higher up, more lean (a lever): where the hit is on the letter
		hit.object.worldToLocal( _local.copy( hit.point ) );
		const height = THREE.MathUtils.clamp( _local.y / letter.h, 0.2, 1 );
		const across = THREE.MathUtils.clamp( _local.x / letter.halfW, - 1, 1 );

		this.kick( letter, _dir, strength, height, across );
		for ( const j of [ i - 1, i + 1 ] ) if ( this.letters[ j ] ) this.kick( this.letters[ j ], _dir, strength * NEIGHBOUR, height, 0 );
		letter.cool = COOLDOWN;

	}

	kick( l, dir, strength, height, across ) {

		const k = KICK * strength * height;
		// +x lean takes the top towards +z (the camera); +z lean takes it to -x
		l.spin.x += dir.z * k;
		l.spin.z -= dir.x * k;
		l.spin.y += across * dir.z * k * 0.5;
		l.vel.x += dir.x * SHOVE * strength;
		l.vel.z += dir.z * SHOVE * strength;

	}

	step( dt ) {

		const ls = this.letters;

		// Neighbours' tops meeting: pushed apart (soft dominoes)
		for ( let i = 0; i < ls.length - 1; i ++ ) {

			const a = ls[ i ], b = ls[ i + 1 ];
			const close = Math.min( a.h, b.h ) * ( Math.sin( b.lean.z ) - Math.sin( a.lean.z ) ) + ( a.slide.x - b.slide.x );
			const over = close - this.gaps[ i ];
			if ( over > 0 ) {

				a.spin.z += over * TOUCH * dt;
				b.spin.z -= over * TOUCH * dt;

			}

		}

		for ( const l of ls ) {

			l.spin.addScaledVector( l.lean, - STIFF * dt ).multiplyScalar( Math.max( 0, 1 - DAMP * dt ) );
			l.lean.addScaledVector( l.spin, dt );
			cap( l.lean, l.spin, 'x', MAX_LEAN );
			cap( l.lean, l.spin, 'z', MAX_SIDE );
			cap( l.lean, l.spin, 'y', MAX_TWIST );

			l.vel.addScaledVector( l.slide, - SLIDE_STIFF * dt ).multiplyScalar( Math.max( 0, 1 - SLIDE_DAMP * dt ) );
			l.slide.addScaledVector( l.vel, dt );
			l.slide.y = 0;
			if ( l.slide.length() > MAX_SLIDE ) {

				l.slide.setLength( MAX_SLIDE );
				l.vel.multiplyScalar( 0.5 );

			}

		}

	}

}

// At the cap: stopped there, bouncing back a little
function cap( lean, spin, axis, max ) {

	if ( Math.abs( lean[ axis ] ) <= max ) return;
	lean[ axis ] = Math.sign( lean[ axis ] ) * max;
	if ( Math.sign( spin[ axis ] ) === Math.sign( lean[ axis ] ) ) spin[ axis ] *= - 0.3;

}
