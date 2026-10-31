import * as THREE from 'three';
import { buildSkyClouds, updateSkyClouds } from './SkyClouds.js';

// The sky of the third-person view (Camera.js 'chase'): the view from above
// never shows it. Kept cheap: one low-poly dome coloured per vertex (the fog
// colour at the horizon, so the fogged ground melts into it, blue overhead)
// and a few cloud sprites sharing one small canvas texture. It follows the
// camera's position and is drawn first, behind everything (no depth written).
// Ultra: real low-poly clouds instead of the sprites (SkyClouds.js, adapted
// from Beyond the Clouds), lit by the sun.

const RADIUS = 140; // m: inside the shortest far plane (rally, 150 m)
const ZENITH = 0x4a8fe0; // blue overhead
const HORIZON_BAND = 0.35; // share of the way up where the sky is fully blue (^0.6)
const CLOUDS = 7;
const CLOUD_SEED = 7;
const _sun = new THREE.Vector3();
const _warm = new THREE.Color( 0xffc98d ); // the rim's warmth (Beyond the Clouds' sunGlow)

function mulberry( seed ) {

	let t = seed >>> 0;

	return () => {

		t = ( t + 0x6D2B79F5 ) >>> 0;
		let r = Math.imul( t ^ ( t >>> 15 ), 1 | t );
		r = ( r + Math.imul( r ^ ( r >>> 7 ), 61 | r ) ) ^ r;
		return ( ( r ^ ( r >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// A soft white cloud: a few overlapping round puffs
function cloudTexture() {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 128;
	canvas.height = 64;
	const g = canvas.getContext( '2d' );

	for ( const [ x, y, r ] of [ [ 34, 40, 20 ], [ 58, 30, 25 ], [ 84, 36, 21 ], [ 102, 42, 15 ], [ 22, 46, 13 ] ] ) {

		const puff = g.createRadialGradient( x, y, 0, x, y, r );
		puff.addColorStop( 0, 'rgba(255, 255, 255, 0.95)' );
		puff.addColorStop( 0.6, 'rgba(255, 255, 255, 0.75)' );
		puff.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
		g.fillStyle = puff;
		g.fillRect( 0, 0, 128, 64 );

	}

	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;

}

export class Sky {

	// horizon: the fog colour (THREE.Color); options.puffy: the Ultra clouds,
	// options.sun: the DirectionalLight that shades them; options.scale: the
	// sky pushed back with the view distance (main.js, Ultra: 2)
	constructor( scene, horizon, { puffy = false, sun = null, scale = 1 } = {} ) {

		this.sun = sun;
		this.clouds = null;

		this.group = new THREE.Group();
		this.group.userData.skipProbeBake = true; // main.js: not in the light probes
		this.group.visible = false;

		// Dome: a sphere seen from inside, blue fading down to the fog colour
		const radius = RADIUS * scale;
		const geometry = new THREE.SphereGeometry( radius, 16, 10 );
		const position = geometry.attributes.position;
		const colors = new Float32Array( position.count * 3 );
		const top = new THREE.Color( ZENITH ), c = new THREE.Color();

		for ( let i = 0; i < position.count; i ++ ) {

			const up = Math.max( 0, position.getY( i ) / radius ); // 0 at the horizon (and below), 1 overhead
			c.copy( horizon ).lerp( top, Math.min( 1, Math.pow( up / HORIZON_BAND, 0.6 ) ) );
			colors.set( [ c.r, c.g, c.b ], i * 3 );

		}

		geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );
		this.dome = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial( { vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false } ) );
		this.dome.renderOrder = - 1;
		this.dome.frustumCulled = false;
		this.group.add( this.dome );

		if ( puffy ) {

			this.clouds = buildSkyClouds( horizon, { scale } );
			this.group.add( this.clouds );
			scene.add( this.group );
			return;

		}

		// A few clouds low over the horizon, all around
		this.cloudMaterial = new THREE.SpriteMaterial( { map: cloudTexture(), fog: false, depthWrite: false, transparent: true, opacity: 0.9 } );
		const rand = mulberry( CLOUD_SEED );

		for ( let i = 0; i < CLOUDS; i ++ ) {

			const angle = ( i + rand() * 0.7 ) / CLOUDS * Math.PI * 2;
			const elevation = THREE.MathUtils.degToRad( 8 + rand() * 22 );
			const d = radius * 0.9;
			const cloud = new THREE.Sprite( this.cloudMaterial );
			cloud.position.set( Math.cos( angle ) * Math.cos( elevation ) * d, Math.sin( elevation ) * d, Math.sin( angle ) * Math.cos( elevation ) * d );
			const size = ( 28 + rand() * 26 ) * scale;
			cloud.scale.set( size, size * 0.45, 1 );
			cloud.renderOrder = - 1;
			this.group.add( cloud );

		}

		scene.add( this.group );

	}

	set visible( on ) {

		this.group.visible = on;

	}

	follow( camera ) {

		if ( ! this.group.visible ) return;
		this.group.position.copy( camera.position );

		if ( this.clouds ) {

			let sunDir = null;

			if ( this.sun ) {

				sunDir = _sun.copy( this.sun.position ).sub( this.sun.target.position ).normalize();
				this.clouds.material.uniforms.uSunColor.value.copy( this.sun.color ).lerp( _warm, 0.5 );

			}

			updateSkyClouds( this.clouds, performance.now() / 1000, sunDir );

		}

	}

}
