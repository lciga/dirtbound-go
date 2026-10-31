// Boost pads of a bonus race (Trackmania style): glowing strips with arrows
// over part of the road (Layout.js boostPads, the same for every racer).
// Driving onto one kicks the car to PAD_KICK × its usual top speed at once,
// then PAD_BOOST s of turbo (the accelerator's top speed and punch, Boost.js),
// throttle held. It adds up with a turbo (Boost.js boostedSpeed: two boosts at
// once go faster than one). Each player only boosts their own car.

import * as THREE from 'three';
import { ROAD_Y } from '../SplineTrack.js';
import { MAX_SPEED } from '../Vehicle.js';
import { onPad } from './Layout.js';

export const PAD_BOOST = 1.5; // s of turbo after a pad
export const PAD_KICK = 1.35; // × the usual top speed, straight away (the turbo's top is 1.5 ×)
export const PAD_STACK_KICK = 1.12; // × the speed the car already has (a pad taken under a turbo still kicks)
const LIFT = 0.03; // m above the road (no z-fighting)
const SLICES = 6; // along a pad: it follows the road's bend and grade
const SCROLL = 1.6; // arrows per second running down the pad

function arrowTexture() {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 128;
	canvas.height = 256;
	const g = canvas.getContext( '2d' );
	const glow = g.createLinearGradient( 0, 0, 128, 0 );
	glow.addColorStop( 0, '#ff3d1f' );
	glow.addColorStop( 0.5, '#ffb000' );
	glow.addColorStop( 1, '#ff3d1f' );
	g.fillStyle = glow;
	g.fillRect( 0, 0, 128, 256 );
	g.fillStyle = 'rgba(255, 255, 255, 0.92)';

	// Two chevrons pointing up the texture (= the race direction)
	for ( const y of [ 20, 148 ] ) {

		g.beginPath();
		g.moveTo( 64, y );
		g.lineTo( 116, y + 56 );
		g.lineTo( 116, y + 92 );
		g.lineTo( 64, y + 40 );
		g.lineTo( 12, y + 92 );
		g.lineTo( 12, y + 56 );
		g.closePath();
		g.fill();

	}

	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapT = THREE.RepeatWrapping;
	return texture;

}

export class BoostPads {

	// pads: Layout.js boostPads; finishS / ahead: the start line and the race direction
	constructor( { scene, path, pads, finishS, ahead, vehicle, shake = null } ) {

		this.scene = scene;
		this.path = path;
		this.ahead = ahead;
		this.vehicle = vehicle;
		this.shake = shake;
		this.until = - Infinity; // race time the current boost ends
		this.texture = arrowTexture();
		// both sides: the strip's winding flips with the race direction
		this.material = new THREE.MeshBasicMaterial( { map: this.texture, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 2 } );
		const L = path.length;
		this.pads = pads.map( ( pad ) => {

			const s = ( ( finishS + ahead * pad.d ) % L + L ) % L;
			const frame = path.frameAt( s, {} );
			const mesh = new THREE.Mesh( this.strip( pad, s ), this.material );
			mesh.renderOrder = 1;
			scene.add( mesh );
			return { ...pad, s, frame, mesh, inside: false };

		} );

	}

	// The pad as a strip laid on the road from one end to the other
	strip( pad, s ) {

		const positions = [], uvs = [], index = [];
		const f = {};
		const L = this.path.length;

		for ( let i = 0; i <= SLICES; i ++ ) {

			const t = i / SLICES; // 0 = back of the pad, 1 = front (race direction)
			this.path.frameAt( ( ( s + this.ahead * ( t - 0.5 ) * pad.length ) % L + L ) % L, f );

			for ( const k of [ - 1, 1 ] ) {

				const lat = ( pad.lateral + k * pad.width / 2 ) * this.ahead; // + = left of the race direction
				positions.push( f.x + f.tz * lat, f.y + ROAD_Y + LIFT, f.z - f.tx * lat );
				uvs.push( k < 0 ? 0 : 1, t * pad.length / pad.width );

			}

			if ( i > 0 ) {

				const a = ( i - 1 ) * 2;
				index.push( a, a + 1, a + 2, a + 1, a + 3, a + 2 );

			}

		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
		geometry.setIndex( index );
		return geometry;

	}

	// Arrows running down the pads; a pad driven onto starts a boost
	frame( dt, now ) {

		this.texture.offset.y -= SCROLL * dt * 0.5;
		if ( now === null ) return;
		const me = this.vehicle.spherePos;

		for ( const pad of this.pads ) {

			const inside = onPad( pad, pad.frame, this.ahead, me.x, me.z );

			if ( inside && ! pad.inside ) {

				this.until = now + PAD_BOOST;
				const v = this.vehicle;
				if ( v.linearSpeed >= 0 ) v.linearSpeed = Math.max( v.linearSpeed * PAD_STACK_KICK, MAX_SPEED * v.speedFactor * PAD_KICK );
				this.shake?.( 0.12 );

			}

			pad.inside = inside;

		}

	}

	boosting( now ) {

		return now !== null && now < this.until;

	}

	// Input while boosted: the accelerator on, throttle held
	gate( input, now ) {

		return this.boosting( now ) ? { ...input, boost: ( Number( input.boost ) || 0 ) + 1, z: Math.max( input.z, 1 ) } : input;

	}

	dispose() {

		for ( const pad of this.pads ) {

			this.scene.remove( pad.mesh );
			pad.mesh.geometry.dispose();

		}

		this.material.dispose();
		this.texture.dispose();

	}

}
