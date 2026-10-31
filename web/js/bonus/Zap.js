// The lightning bonus on screen (Lightning.js has the rules): jagged bolts
// from the sky, the level 1 ball of lightning, the warning ring under a car
// about to be struck, and the maluses of a car struck:
//   - reverse: electrified wheels, left and right swapped (sparks at the wheels)
//   - shrink: the car at half size and half speed (seen small by everyone)
//   - vision: a flashbang, the screen white then fading back over 2 s (mine only)
// Bolt segments are two pooled InstancedMeshes (core + glow), built once so
// no shader compiles mid-race. The host (BonusRace) lends its sparks, flash,
// lights and camera shake.

import * as THREE from 'three';
import { LIGHTNING, malusLength, flashOpacity } from './Lightning.js';

export const ELECTRIC_COLORS = [ 0xffffff, 0xd8ecff, 0x8cc8ff, 0x4a7dff, 0x1c2a7a ]; // a spark's life
const SEGMENTS = 900; // bolt segments drawn at once
const SKY = 30; // m above the car: where a strike starts
const REJAG = 0.045; // s: a bolt redraws its zigzag this often (the flicker)
const RING_COLOR = 0x6fb6ff;
const GROW = 6; // per s: how fast a car shrinks or grows back
const _up = new THREE.Vector3( 0, 1, 0 );
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

// A zigzag from a to b: `count` points, pushed sideways up to `jitter`
// (most in the middle), plus a few short forks
function zigzag( a, b, count, jitter, forks ) {

	const dir = new THREE.Vector3().subVectors( b, a );
	const total = dir.length();
	const points = [ a.clone() ];

	for ( let i = 1; i < count; i ++ ) {

		const t = i / count;
		const sway = jitter * Math.sin( Math.PI * t );
		points.push( new THREE.Vector3( ( Math.random() - 0.5 ) * 2 * sway, ( Math.random() - 0.5 ) * sway * 0.5, ( Math.random() - 0.5 ) * 2 * sway ).addScaledVector( dir, t ).add( a ) );

	}

	points.push( b.clone() );
	const lines = [ points ];

	for ( let f = 0; f < forks; f ++ ) {

		const from = points[ 1 + Math.floor( Math.random() * ( points.length - 2 ) ) ];
		const end = new THREE.Vector3( Math.random() - 0.5, - 0.6 - Math.random() * 0.4, Math.random() - 0.5 ).normalize().multiplyScalar( total * ( 0.12 + Math.random() * 0.18 ) ).add( from );
		lines.push( zigzag( from, end, 4, jitter * 0.4, 0 )[ 0 ] );

	}

	return lines;

}

export class Zaps {

	constructor( { scene, host } ) {

		this.scene = scene;
		this.host = host;
		this.bolts = []; // { a, b, age, life, width, jitter, forks, lines, jagAt }
		this.rings = []; // { id, until, mesh }
		this.maluses = new Map(); // car id → { malus, left }
		this.reverse = false;

		const box = new THREE.BoxGeometry( 1, 1, 1 );
		const pool = ( material ) => {

			const mesh = new THREE.InstancedMesh( box, material, SEGMENTS );
			mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
			mesh.frustumCulled = false;
			mesh.count = 0;
			scene.add( mesh );
			return mesh;

		};

		this.core = pool( new THREE.MeshBasicMaterial( { color: 0xf2f8ff, toneMapped: false } ) );
		this.glow = pool( new THREE.MeshBasicMaterial( { color: 0x5a9bff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false } ) );
		this.ringGeometry = new THREE.RingGeometry( 0.9, 1.15, 40 );
		this.ringGeometry.rotateX( - Math.PI / 2 );
		this.ringMaterial = new THREE.MeshBasicMaterial( { color: RING_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false } );
		this.buildVision();

	}

	// ─── Bolts ───

	bolt( a, b, { life = 0.32, width = 0.09, jitter = 2.2, forks = 3, count = 14 } = {} ) {

		this.bolts.push( { a: a.clone(), b: b.clone(), age: 0, life, width, jitter, forks, count, lines: null, jagAt: - 1 } );

	}

	// A strike from the sky onto a car (centre `at`, any { x, y, z })
	strike( where ) {

		const host = this.host;
		const at = new THREE.Vector3( where.x, where.y, where.z );
		_a.set( at.x + ( Math.random() - 0.5 ) * 8, at.y + SKY, at.z + ( Math.random() - 0.5 ) * 8 );
		_b.set( at.x, at.y - 0.3, at.z );
		this.bolt( _a, _b, { life: 0.36, width: 0.13, jitter: 2.6, forks: 4, count: 18 } );
		this.bolt( _a, _b, { life: 0.2, width: 0.06, jitter: 3.2, forks: 2, count: 16 } );
		this.burst( at, 34, 7 );
		host.flash( at, 0xbfe0ff );
		host.light( at, 1.2, 0x8cc8ff );
		host.shakeFrom( at, 0.6 );

	}

	// The level 1 ball reaching a car or a barrier
	zap( where, big = true ) {

		const host = this.host;
		const at = new THREE.Vector3( where.x, where.y, where.z );
		for ( let i = 0; i < ( big ? 6 : 3 ); i ++ ) this.bolt( at, _b.set( at.x + ( Math.random() - 0.5 ) * 4, at.y - 0.5 + Math.random() * 2, at.z + ( Math.random() - 0.5 ) * 4 ), { life: 0.18, width: 0.05, jitter: 0.6, forks: 0, count: 5 } );
		this.burst( at, big ? 26 : 12, big ? 6 : 4 );
		host.flash( at, 0xbfe0ff );
		host.light( at, big ? 0.8 : 0.4, 0x8cc8ff );
		host.shakeFrom( at, big ? 0.45 : 0.2 );

	}

	burst( at, count, speed ) {

		for ( let i = 0; i < count; i ++ ) {

			_dir.set( Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5 ).normalize().multiplyScalar( speed * ( 0.3 + Math.random() * 0.7 ) );
			this.host.firePuff( at, _dir, 0.12 + Math.random() * 0.18, 0.2 + Math.random() * 0.3, ELECTRIC_COLORS );

		}

	}

	// The flying level 1 bolt: a white core in a blue halo, crackling
	ballMesh() {

		this.ballParts ??= {
			core: new THREE.MeshBasicMaterial( { color: 0xffffff, toneMapped: false } ),
			halo: new THREE.MeshBasicMaterial( { color: 0x5a9bff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false } ),
			geometry: new THREE.IcosahedronGeometry( 1, 1 ),
		};
		const group = new THREE.Group();
		const core = new THREE.Mesh( this.ballParts.geometry, this.ballParts.core );
		core.scale.setScalar( 0.22 );
		const halo = new THREE.Mesh( this.ballParts.geometry, this.ballParts.halo );
		halo.scale.setScalar( 0.5 );
		group.add( core, halo );
		group.userData.halo = halo;
		return group;

	}

	// Every frame of its flight: the halo pulses, arcs crackle off it, sparks trail
	crackle( mesh, at ) {

		mesh.userData.halo.scale.setScalar( 0.42 + Math.random() * 0.2 );
		if ( Math.random() < 0.6 ) this.bolt( at, _b.set( at.x + ( Math.random() - 0.5 ) * 1.6, at.y + ( Math.random() - 0.5 ) * 1.2, at.z + ( Math.random() - 0.5 ) * 1.6 ), { life: 0.06, width: 0.035, jitter: 0.25, forks: 0, count: 4 } );
		if ( Math.random() < 0.7 ) this.host.firePuff( at, null, 0.1 + Math.random() * 0.1, 0.25, ELECTRIC_COLORS );

	}

	// ─── Warning ring (a sky strike on its way) ───

	warn( id, until ) {

		const mesh = new THREE.Mesh( this.ringGeometry, this.ringMaterial );
		mesh.visible = false;
		this.scene.add( mesh );
		this.rings.push( { id, until, mesh } );

	}

	// ─── Maluses ───

	apply( id, malus ) {

		this.maluses.set( id, { malus, left: malusLength( malus ), scale: this.maluses.get( id )?.scale ?? 1 } );

	}

	malusOf( id ) {

		return this.maluses.get( id )?.malus ?? null;

	}

	// My controls: left and right swapped while my wheels are electrified
	gate( input ) {

		return this.malusOf( this.host.sync.you ) === 'reverse' ? { ...input, x: - input.x } : input;

	}

	// ─── Vision (flashbang) ───

	buildVision() {

		this.flashEl = document.createElement( 'div' );
		this.flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:18;background:#fff;opacity:0;display:none';
		document.body.appendChild( this.flashEl );

	}

	// ─── Every frame ───

	frame( dt, time ) {

		const host = this.host;
		const you = host.sync.you;

		// Maluses: count down, shrink / grow the cars, sparks at electrified wheels
		for ( const [ id, m ] of this.maluses ) {

			m.left -= dt;
			const target = m.malus === 'shrink' && m.left > 0 ? LIGHTNING.shrinkScale : 1;
			m.scale += Math.sign( target - m.scale ) * Math.min( Math.abs( target - m.scale ), GROW * dt );
			const car = id === you ? host.vehicle.container : host.sync.remotes.get( id )?.ghost.container;
			if ( car ) car.scale.setScalar( m.scale );
			if ( id === you ) host.vehicle.speedFactor = m.malus === 'shrink' && m.left > 0 ? LIGHTNING.shrinkSpeed : 1;

			if ( m.malus === 'reverse' && m.left > 0 && car && car.visible ) {

				for ( let i = 0; i < 2; i ++ ) {

					_a.set( ( Math.random() < 0.5 ? - 1 : 1 ) * 0.35, 0.15, ( Math.random() < 0.5 ? - 1 : 1 ) * 0.55 ).applyQuaternion( car.quaternion ).add( car.position );
					host.firePuff( _a, _dir.set( ( Math.random() - 0.5 ) * 2, 1 + Math.random() * 2, ( Math.random() - 0.5 ) * 2 ), 0.06 + Math.random() * 0.08, 0.18, ELECTRIC_COLORS );

				}

				if ( Math.random() < 0.25 ) {

					_a.set( ( Math.random() - 0.5 ) * 0.8, 0.2, ( Math.random() - 0.5 ) * 1.2 ).applyQuaternion( car.quaternion ).add( car.position );
					_b.set( ( Math.random() - 0.5 ) * 0.8, 0.2, ( Math.random() - 0.5 ) * 1.2 ).applyQuaternion( car.quaternion ).add( car.position );
					this.bolt( _a, _b, { life: 0.06, width: 0.03, jitter: 0.2, forks: 0, count: 4 } );

				}

			}

			if ( m.left <= 0 && m.scale === 1 ) this.maluses.delete( id );

		}

		// Flashbang: white at once, then fading back (Lightning.js flashOpacity)
		const mine = this.maluses.get( you );
		const flash = mine?.malus === 'vision' && mine.left > 0 ? flashOpacity( LIGHTNING.vision - mine.left ) : 0;

		if ( flash > 0.005 ) {

			this.flashEl.style.display = 'block';
			this.flashEl.style.opacity = flash.toFixed( 3 );

		} else if ( this.flashEl.style.display !== 'none' ) this.flashEl.style.display = 'none';

		// Warning rings: pulse under the car until the strike
		this.rings = this.rings.filter( ( ring ) => {

			const at = ring.id === you ? host.myCar() : host.remoteCar( ring.id );
			if ( time === null || time >= ring.until || ! at ) {

				this.scene.remove( ring.mesh );
				return false;

			}

			const left = ring.until - time;
			ring.mesh.visible = true;
			ring.mesh.position.set( at.x, at.y - 0.45, at.z );
			ring.mesh.scale.setScalar( 0.8 + 1.4 * left / LIGHTNING.strikeDelay + Math.sin( time * 40 ) * 0.05 );
			return true;

		} );

		this.drawBolts( dt );

	}

	drawBolts( dt ) {

		let n = 0;
		this.bolts = this.bolts.filter( ( b ) => ( b.age += dt ) < b.life );

		for ( const b of this.bolts ) {

			if ( ! b.lines || b.age - b.jagAt >= REJAG ) {

				b.lines = zigzag( b.a, b.b, b.count, b.jitter, b.forks );
				b.jagAt = b.age;

			}

			const fade = 1 - b.age / b.life;
			if ( Math.random() < 0.15 ) continue; // flicker: a frame off now and then

			for ( let l = 0; l < b.lines.length; l ++ ) {

				const line = b.lines[ l ];
				const width = b.width * ( l === 0 ? 1 : 0.55 ) * ( 0.6 + 0.4 * fade );

				for ( let i = 0; i + 1 < line.length && n < SEGMENTS; i ++ ) {

					_dir.subVectors( line[ i + 1 ], line[ i ] );
					const length = _dir.length();
					if ( length < 1e-4 ) continue;
					_q.setFromUnitVectors( _up, _dir.multiplyScalar( 1 / length ) );
					_a.addVectors( line[ i ], line[ i + 1 ] ).multiplyScalar( 0.5 );
					_m.compose( _a, _q, _s.set( width, length + width, width ) );
					this.core.setMatrixAt( n, _m );
					_m.compose( _a, _q, _s.set( width * 4, length + width * 4, width * 4 ) );
					this.glow.setMatrixAt( n, _m );
					n ++;

				}

			}

		}

		this.core.count = this.glow.count = n;
		this.core.instanceMatrix.needsUpdate = true;
		this.glow.instanceMatrix.needsUpdate = true;

	}

}
