import * as THREE from 'three';
import { GHOST_RATE, GHOST_MAX_TIME, encodeGhost, sampleGhost, keyCode } from './GhostCodec.js';
import { stretchYaris } from './YarisMode.js';

// Ghost of the record lap, Trackmania style: the lap being driven is recorded
// (GhostRecorder), and the record lap is replayed as a see-through car
// (GhostCar) running on the same lap clock as the player.

const GHOST_OPACITY = 0.4;
const _frame = new Array( 8 );
const _quat = new THREE.Quaternion();

export class GhostRecorder {

	constructor() {

		this.frames = [];
		this.clearKeys();

	}

	// The keys of the lap (see GhostCodec.js): run-length encoded, from the moment the lap clock starts
	clearKeys() {

		this.started = false;
		this.start = null;
		this.runs = [];

	}

	// Every physics step, right after Vehicle.update, with the input it was given
	input( input ) {

		if ( ! this.started ) return;
		const code = keyCode( input ), n = this.runs.length;
		if ( n > 0 && this.runs[ n - 2 ] === code ) this.runs[ n - 1 ] ++;
		else this.runs.push( code, 1 );

	}

	// Called every frame while the lap runs, with the lap time so far
	sample( lapTime, vehicle ) {

		if ( lapTime > GHOST_MAX_TIME ) return;

		if ( ! this.started && typeof vehicle.saveState === 'function' ) {

			this.started = true;
			const state = new Float64Array( 18 ); // Vehicle.STATE_SIZE
			vehicle.saveState( state, 0 );
			this.start = Array.from( state );

		}

		while ( this.frames.length <= lapTime * GHOST_RATE ) {

			const p = vehicle.container.position;
			const q = vehicle.container.quaternion;
			const steer = vehicle.wheelFL ? vehicle.wheelFL.rotation.y : 0;
			this.frames.push( [ p.x, p.y, p.z, q.x, q.y, q.z, q.w, steer ] );

		}

	}

	// The lap was dropped (quick restart): nothing recorded
	reset() {

		this.frames = [];
		this.clearKeys();

	}

	// The lap just ended at `time`: returns its encoded ghost (null when too
	// long to keep) and starts recording the next lap
	finish( time, vehicle ) {

		this.sample( time, vehicle );
		const frames = this.frames;
		const keys = this.started ? { runs: this.runs, start: this.start } : null;
		this.frames = [];
		this.clearKeys();
		return time <= GHOST_MAX_TIME && frames.length > 1 ? { frames, encoded: encodeGhost( frames, keys ) } : null;

	}

}

// Makes a car model see-through: cloned materials, no shadows, drawn after the road
function ghostMaterial( m ) {

	const ghost = m.clone();
	ghost.transparent = true;
	ghost.opacity = GHOST_OPACITY * ( m.opacity ?? 1 );
	ghost.depthWrite = false;
	return ghost;

}

// Each mesh with its solid and see-through materials: [ mesh, solid, ghost ]
function materialSets( model ) {

	const sets = [];

	model.traverse( ( child ) => {

		if ( ! child.isMesh ) return;
		const solid = child.material;
		const ghost = Array.isArray( solid ) ? solid.map( ghostMaterial ) : ghostMaterial( solid );
		sets.push( [ child, solid, ghost ] );

	} );

	return sets;

}

export class GhostCar {

	// model: a car model as given by loadCar (cloned here); seeThrough: false
	// for solid remote cars (multiplayer with collisions)
	constructor( model, { seeThrough = true } = {} ) {

		this.frames = null;
		this.container = new THREE.Group();
		this.container.visible = false;

		const car = model.clone();
		this.visual = car;
		this.materials = materialSets( car );
		this.seeThrough = null;
		this.setSeeThrough( seeThrough );
		this.container.add( car );

		this.frontWheels = [];
		car.traverse( ( child ) => {

			const name = child.name.toLowerCase();
			if ( name.includes( 'wheel' ) && name.includes( 'front' ) ) {

				child.rotation.order = 'YXZ';
				this.frontWheels.push( child );

			}

		} );

	}

	// See-through: no shadows, drawn after the road (record ghost, or a remote car you can drive through)
	setSeeThrough( seeThrough ) {

		if ( this.seeThrough === seeThrough ) return;
		this.seeThrough = seeThrough;

		for ( const [ mesh, solid, ghost ] of this.materials ) {

			mesh.material = seeThrough ? ghost : solid;
			mesh.castShadow = ! seeThrough;
			mesh.receiveShadow = ! seeThrough;
			mesh.renderOrder = seeThrough ? 1 : 0;

		}

	}

	setFrames( frames ) {

		this.frames = frames;

	}

	// lapTime: the player's lap clock; null hides the ghost (lap not started)
	update( lapTime ) {

		const frame = this.frames && lapTime !== null ? sampleGhost( this.frames, lapTime, _frame ) : null;
		this.container.visible = frame !== null;
		if ( ! frame ) return;

		this.container.position.set( frame[ 0 ], frame[ 1 ], frame[ 2 ] );
		_quat.set( frame[ 3 ], frame[ 4 ], frame[ 5 ], frame[ 6 ] ).normalize();
		this.container.quaternion.copy( _quat );
		for ( const wheel of this.frontWheels ) wheel.rotation.y = frame[ 7 ];
		stretchYaris( this.visual, lapTime );

	}

	// A remote car of a multiplayer race: state = { x, y, z, qx, qy, qz, qw, st }, null hides it
	place( state ) {

		this.container.visible = state !== null;
		if ( ! state ) return;

		this.container.position.set( state.x, state.y, state.z );
		_quat.set( state.qx, state.qy, state.qz, state.qw ).normalize();
		this.container.quaternion.copy( _quat );
		for ( const wheel of this.frontWheels ) wheel.rotation.y = state.st;

	}

}
