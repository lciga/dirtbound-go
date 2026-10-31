// The turbo bonus: level 1 a 3 s turbo (flames out of the back), level 2 a
// 5 s turbo in a shield bubble (rockets burst on it, lightning does nothing),
// level 3 a rift: a portal opens ahead, swallows the car, and a second one
// spits it out WARP m further along the road, at the same speed.
// Every screen draws the flames, the shield and the portals of every racer
// from the `fire` message; each player only moves their own car.

import * as THREE from 'three';
import { ROAD_Y } from '../SplineTrack.js';
import { WARP_ROAD } from '../multi/Protocol.js';

export const TURBO = Object.freeze( {
	time: [ 0, 3, 5, 0 ], // s of turbo per level
	shieldLevel: 2, // this level and above: shielded while it lasts
	warp: WARP_ROAD, // m along the road the rift carries the car
	warpMin: 20, // m: never a shorter jump (the end of an open road)
	swallow: 0.3, // s: the entry portal opens, then the car is pulled in…
	shrink: 0.12, // s: …shrinking into it…
	hidden: 0.1, // s: …gone, then out of the exit portal
	grow: 0.15, // s
	portal: 1.1, // s a portal stays open
} );

export const FLAME_COLORS = [ 0xffffff, 0xfff2a8, 0xffb03d, 0xff5a1f, 0x6a2a6a ];
export const RIFT_COLORS = [ 0xffffff, 0xe6c8ff, 0xb46bff, 0x5a3dff, 0x1a0f4a ];
const _a = new THREE.Vector3();
const _v = new THREE.Vector3();

// Where a rift starting at arc length s carries the car: `ahead` (+1 / -1) the
// race direction along the closed path, `dist` m. { s, x, y (car centre), z, angle }
export function warpTarget( path, s, ahead, dist = TURBO.warp ) {

	const L = path.length;
	const to = ( ( ( s + ahead * dist ) % L ) + L ) % L;
	const f = path.frameAt( to );
	return { s: to, x: f.x, y: f.y + ROAD_Y + 0.5, z: f.z, angle: Math.atan2( f.tx * ahead, f.tz * ahead ) };

}

// The swirl inside a portal
function swirlTexture() {

	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = 256;
	const g = canvas.getContext( '2d' );
	const glow = g.createRadialGradient( 128, 128, 0, 128, 128, 128 );
	glow.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	glow.addColorStop( 0.25, 'rgba(200, 150, 255, 0.9)' );
	glow.addColorStop( 0.7, 'rgba(90, 50, 255, 0.55)' );
	glow.addColorStop( 1, 'rgba(20, 10, 80, 0)' );
	g.fillStyle = glow;
	g.fillRect( 0, 0, 256, 256 );
	g.lineCap = 'round';

	for ( let arm = 0; arm < 5; arm ++ ) {

		g.beginPath();

		for ( let t = 0; t <= 1; t += 0.02 ) {

			const angle = arm / 5 * Math.PI * 2 + t * 5;
			const r = 10 + t * 112;
			const x = 128 + Math.cos( angle ) * r, y = 128 + Math.sin( angle ) * r;
			if ( t === 0 ) g.moveTo( x, y );
			else g.lineTo( x, y );

		}

		g.strokeStyle = 'rgba(255, 240, 255, 0.7)';
		g.lineWidth = 5;
		g.stroke();

	}

	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;

}

export class Turbos {

	constructor( { scene, host } ) {

		this.scene = scene;
		this.host = host;
		this.active = new Map(); // car id → { until (race time), shield }
		this.portals = []; // { group, age, x, y, z, angle }
		this.warp = null; // my rift: { age, exit, done }
		this.flameAt = new Map(); // car id → last flame emission (s)

		this.swirl = new THREE.MeshBasicMaterial( { map: swirlTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false } );
		this.rim = new THREE.MeshBasicMaterial( { color: 0xc89bff, toneMapped: false } );
		this.discGeometry = new THREE.CircleGeometry( 1.35, 40 );
		this.rimGeometry = new THREE.TorusGeometry( 1.4, 0.09, 8, 48 );
		this.bubbleMaterial = new THREE.MeshBasicMaterial( { color: 0x66e0ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false } );
		this.bubbleGeometry = new THREE.IcosahedronGeometry( 1.25, 2 );
		this.bubbles = new Map(); // car id → mesh

	}

	// A turbo shot heard of (mine or another racer's): rt = its race time
	start( id, level, rt ) {

		if ( level >= 3 ) return;
		this.active.set( id, { until: rt + TURBO.time[ level ], shield: level >= TURBO.shieldLevel } );

	}

	boosting( id, now ) {

		const a = this.active.get( id );
		return !! a && now !== null && now < a.until;

	}

	shielded( id, now ) {

		const a = this.active.get( id );
		return !! a && a.shield && now !== null && now < a.until;

	}

	// My controls while my turbo burns: full throttle, the accelerator on
	gate( input, now ) {

		if ( ! this.boosting( this.host.sync.you, now ) ) return input;
		return { ...input, boost: ( Number( input.boost ) || 0 ) + 1, z: Math.max( input.z, 1 ) };

	}

	// ─── Rift ───

	portal( x, y, z, angle ) {

		const group = new THREE.Group();
		const disc = new THREE.Mesh( this.discGeometry, this.swirl );
		const rim = new THREE.Mesh( this.rimGeometry, this.rim );
		group.add( disc, rim );
		group.userData.disc = disc;
		group.position.set( x, y + 1.35, z ); // the rim just above the road
		group.rotation.y = angle; // the disc faces along the road
		group.scale.setScalar( 0.01 );
		this.scene.add( group );
		this.portals.push( { group, age: 0, x, y, z } );
		this.host.light( group.position, 0.7, 0xb46bff );

	}

	// A rift opened by `id` at ( x, y, z ) heading ( dx, dz ), out at ( wx, wz )
	rift( id, shot, exit ) {

		const angle = Math.atan2( shot.dx, shot.dz );
		this.portal( shot.x + shot.dx * 2.2, shot.y, shot.z + shot.dz * 2.2, angle );
		this.portal( exit.x - Math.sin( exit.angle ) * 0.5, exit.y - 0.5, exit.z - Math.cos( exit.angle ) * 0.5, exit.angle );
		if ( id === this.host.sync.you ) this.warp = { age: 0, exit, done: false };

	}

	// ─── Every frame ───

	frame( dt, now ) {

		const host = this.host;
		const you = host.sync.you;

		// Flames out of the back of every car on turbo, and the shield bubbles
		for ( const [ id, a ] of this.active ) {

			const on = now !== null && now < a.until;
			const car = id === you ? host.vehicle.container : host.sync.remotes.get( id )?.ghost.container;
			let bubble = this.bubbles.get( id );

			if ( ! on || ! car ) {

				if ( bubble ) {

					this.scene.remove( bubble );
					this.bubbles.delete( id );

				}

				if ( ! on ) this.active.delete( id );
				continue;

			}

			if ( car.visible ) {

				_v.set( 0, 0, - 1 ).applyQuaternion( car.quaternion ); // backwards
				for ( const side of [ - 0.22, 0.22 ] ) {

					_a.set( side, 0.28, - 0.85 ).applyQuaternion( car.quaternion ).add( car.position );
					for ( let i = 0; i < 3; i ++ ) host.firePuff( _a, _v.clone().multiplyScalar( 4 + Math.random() * 3 ).add( new THREE.Vector3( ( Math.random() - 0.5 ) * 0.8, 0.4, ( Math.random() - 0.5 ) * 0.8 ) ), 0.24 + Math.random() * 0.22, 0.18 + Math.random() * 0.14, FLAME_COLORS );

				}

			}

			if ( a.shield ) {

				if ( ! bubble ) {

					bubble = new THREE.Mesh( this.bubbleGeometry, this.bubbleMaterial );
					this.scene.add( bubble );
					this.bubbles.set( id, bubble );

				}

				bubble.visible = car.visible;
				bubble.position.copy( car.position ).y += 0.45;
				bubble.scale.set( 1, 0.8, 1.25 ).multiplyScalar( car.scale.x * ( 1 + Math.sin( host.time * 9 ) * 0.04 ) );
				bubble.quaternion.copy( car.quaternion );

			}

		}

		// Portals: pop open, spin, shrink shut
		this.portals = this.portals.filter( ( p ) => {

			p.age += dt;

			if ( p.age >= TURBO.portal ) {

				this.scene.remove( p.group );
				return false;

			}

			const open = Math.min( 1, p.age / 0.15 ) * Math.min( 1, ( TURBO.portal - p.age ) / 0.25 );
			p.group.scale.setScalar( Math.max( 0.01, open * ( 1 + Math.sin( p.age * 30 ) * 0.03 ) ) );
			p.group.userData.disc.rotation.z -= dt * 7;
			if ( Math.random() < 0.8 ) {

				_a.set( ( Math.random() - 0.5 ) * 2.4, ( Math.random() - 0.5 ) * 2.4, 0 ).applyQuaternion( p.group.quaternion ).add( p.group.position );
				host.firePuff( _a, null, 0.08 + Math.random() * 0.1, 0.3, RIFT_COLORS );

			}

			return true;

		} );

		this.updateWarp( dt );

	}

	// My car through the rift: pulled in, gone, out of the exit (the jump
	// itself happens in a physics step: host.warpMe)
	updateWarp( dt ) {

		const w = this.warp;
		if ( ! w ) return;
		const host = this.host;
		w.age += dt;
		const t1 = TURBO.swallow, t2 = t1 + TURBO.shrink, t3 = t2 + TURBO.hidden, t4 = t3 + TURBO.grow;
		let k = 1;

		if ( w.age >= t1 && w.age < t2 ) k = 1 - ( w.age - t1 ) / TURBO.shrink;
		else if ( w.age >= t2 && w.age < t3 ) k = 0;
		else if ( w.age >= t3 && w.age < t4 ) k = ( w.age - t3 ) / TURBO.grow;

		if ( w.age >= t2 && ! w.done ) {

			w.done = true;
			host.warpMe( w.exit );
			host.shakeFrom( host.vehicle.spherePos, 0.5 );
			host.riftFlash();

		}

		host.setCarStretch( k, w.age >= t1 && w.age < t2 ? 1 + ( 1 - k ) * 1.5 : 1 );
		if ( w.age >= t4 ) {

			host.setCarStretch( 1, 1 );
			this.warp = null;

		}

	}

}
