import * as THREE from 'three';

// Drift smoke as white low-poly puffs: a few faceted solids (one InstancedMesh
// each) that pop in, swell while rising and tumbling, then shrink away.

const PER_SHAPE = 160;
const EMIT_RATE = 22;          // puffs per second per rear wheel at full drift
const EMIT_JITTER = 0.2;
const LIFE_MIN = 0.7;
const LIFE_MAX = 1.5;
const SIZE_MIN = 0.22;
const SIZE_MAX = 0.55;
const BIG_CHANCE = 0.12;       // occasional larger puff
const BIG_SIZE = 0.8;

const _color = new THREE.Color();
const _blPos = new THREE.Vector3();
const _brPos = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _axis = new THREE.Vector3();
const _spin = new THREE.Quaternion();
const _zero = new THREE.Matrix4().makeScale( 0, 0, 0 );

function makeShapes() {

	const squashed = new THREE.IcosahedronGeometry( 0.5, 0 );
	squashed.scale( 1.25, 0.8, 1 );

	return [
		new THREE.IcosahedronGeometry( 0.5, 0 ),
		new THREE.DodecahedronGeometry( 0.5, 0 ),
		new THREE.OctahedronGeometry( 0.55, 0 ),
		squashed,
	];

}

// Scale over normalized life t: quick overshooting pop, slow swell, shrink out
function puffScale( t ) {

	if ( t < 0.15 ) {

		const k = t / 0.15;
		const c = 1.7;
		return 1 + ( c + 1 ) * Math.pow( k - 1, 3 ) + c * Math.pow( k - 1, 2 ); // easeOutBack

	}

	if ( t < 0.65 ) return 1 + ( t - 0.15 ) * 0.6;

	const k = ( t - 0.65 ) / 0.35;
	return 1.3 * ( 1 - k * k );

}

export class SmokeTrails {

	// color: white tyre smoke, or dust on the rally dirt. colorAt( x, y, z ):
	// optional, the colour of a puff raised there (powder snow up high), null = color.
	// perShape: puffs per shape in the pool; rate / size / life: scales of the
	// emission, the puffs' size and their life (lab/studio.html's dust clouds)
	constructor( scene, color = 0xffffff, { perShape = PER_SHAPE } = {} ) {

		this.color = new THREE.Color( color );
		this.colorAt = null;
		this.perShape = perShape;
		this.rate = 1;
		this.size = 1;
		this.life = 1;
		this.wind = new THREE.Vector3(); // m/s the puffs are carried by once they rise (lab/studio.html)
		const material = new THREE.MeshStandardMaterial( {
			color: 0xffffff, // each puff's colour is its instance colour
			emissive: 0x2a2a2a,
			roughness: 0.85,
			metalness: 0,
			flatShading: true,
		} );

		this.meshes = makeShapes().map( ( geometry ) => {

			const mesh = new THREE.InstancedMesh( geometry, material, perShape );
			mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
			mesh.frustumCulled = false;
			mesh.castShadow = true;
			for ( let i = 0; i < perShape; i ++ ) {

				mesh.setMatrixAt( i, _zero );
				mesh.setColorAt( i, this.color );

			}

			scene.add( mesh );
			return mesh;

		} );

		this.particles = [];

		for ( let s = 0; s < this.meshes.length; s ++ ) {

			for ( let i = 0; i < perShape; i ++ ) {

				this.particles.push( {
					shape: s,
					slot: i,
					life: 0,
					maxLife: 1,
					size: 0,
					position: new THREE.Vector3(),
					velocity: new THREE.Vector3(),
					rotation: new THREE.Quaternion(),
					spinAxis: new THREE.Vector3(),
					spinSpeed: 0,
				} );

			}

		}

		this.emitIndex = 0;
		this.emitCarry = 0;

	}

	update( dt, vehicle, burnout = 0 ) {

		const drift = Math.max( vehicle.driftIntensity, burnout * 2 );
		const shouldEmit = drift > 0.7;

		if ( shouldEmit ) {

			// Time-based emission, a bit denser the harder the drift
			this.emitCarry += dt * EMIT_RATE * this.rate * Math.min( 1.5, drift );
			const count = Math.floor( this.emitCarry );
			this.emitCarry -= count;

			const roadY = vehicle.container.position.y + 0.1;
			const bl = vehicle.wheelBL ? vehicle.wheelBL.getWorldPosition( _blPos ) : null;
			const br = vehicle.wheelBR ? vehicle.wheelBR.getWorldPosition( _brPos ) : null;

			for ( let i = 0; i < count; i ++ ) {

				if ( bl ) this.emitAt( bl.x, roadY, bl.z );
				if ( br ) this.emitAt( br.x, roadY, br.z );

			}

		} else {

			this.emitCarry = 0;

		}

		const damping = Math.max( 0, 1 - 1.8 * dt );
		const dirty = new Set();

		for ( const p of this.particles ) {

			if ( p.life <= 0 ) continue;

			const mesh = this.meshes[ p.shape ];
			dirty.add( mesh );
			p.life -= dt;

			if ( p.life <= 0 ) {

				mesh.setMatrixAt( p.slot, _zero );
				continue;

			}

			const t = 1 - p.life / p.maxLife;

			p.velocity.multiplyScalar( damping );
			p.velocity.y += 0.35 * dt; // keeps drifting upwards
			p.position.addScaledVector( p.velocity, dt );
			if ( this.wind.x || this.wind.z ) p.position.addScaledVector( this.wind, dt * Math.min( 1, t * 4 ) );

			_spin.setFromAxisAngle( p.spinAxis, p.spinSpeed * dt );
			p.rotation.premultiply( _spin );

			_dummy.position.copy( p.position );
			_dummy.quaternion.copy( p.rotation );
			_dummy.scale.setScalar( Math.max( 0, p.size * puffScale( t ) ) );
			_dummy.updateMatrix();
			mesh.setMatrixAt( p.slot, _dummy.matrix );

		}

		for ( const mesh of dirty ) mesh.instanceMatrix.needsUpdate = true;

	}

	emitAt( x, y, z ) {

		const p = this.particles[ this.emitIndex ];
		// Stride through the pool so consecutive puffs use different shapes
		this.emitIndex = ( this.emitIndex + this.perShape + 1 ) % this.particles.length;

		p.position.set(
			x + ( Math.random() - 0.5 ) * EMIT_JITTER,
			y + Math.random() * EMIT_JITTER,
			z + ( Math.random() - 0.5 ) * EMIT_JITTER
		);

		p.velocity.set(
			( Math.random() - 0.5 ) * 0.9,
			0.6 + Math.random() * 0.9,
			( Math.random() - 0.5 ) * 0.9
		);

		p.size = this.size * ( Math.random() < BIG_CHANCE
			? BIG_SIZE * ( 0.85 + Math.random() * 0.35 )
			: SIZE_MIN + Math.random() * ( SIZE_MAX - SIZE_MIN ) );

		p.rotation.setFromAxisAngle( _axis.randomDirection(), Math.random() * Math.PI * 2 );
		p.spinAxis.randomDirection();
		p.spinSpeed = ( Math.random() - 0.5 ) * 6;

		p.maxLife = this.life * ( LIFE_MIN + Math.random() * ( LIFE_MAX - LIFE_MIN ) );
		p.life = p.maxLife;

		const mesh = this.meshes[ p.shape ];
		mesh.setColorAt( p.slot, _color.set( this.colorAt?.( x, y, z ) ?? this.color ) );
		mesh.instanceColor.needsUpdate = true;

	}

}
