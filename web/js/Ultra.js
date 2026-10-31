import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

// Ultra graphics (menu Paramètres → Graphismes): two post effects on top of
// the normal look, shared by the game and the menu showroom.
//
//   - Sun shafts: for every pixel the view ray is marched through the air up
//     to the surface, and each step asks the sun's shadow map whether that
//     point of air is lit. Lit air scatters sunlight towards the camera
//     (forward-scattering phase), shadowed air doesn't: beams between the
//     trees, the car's shadow cutting the haze. Works with the sun off
//     screen, unlike screen-space god rays.
//   - Ambient occlusion (three's GTAO): contact shadows under the car, at the
//     foot of trees and rocks, in the folds of the relief.
//
// Both run inside renderer.setEffects() (HDR, before tone mapping).

const SHAFT_STEPS = 32;

// Tuning per scene: strength of the in-scattered light, air density, how far
// the march goes (beyond the shadow box every step would be lit anyway)
export const SHAFTS = {
	game: { intensity: 0.12, density: 0.03, maxDistance: 45, anisotropy: 0.55 },
	menu: { intensity: 0.03, density: 0.15, maxDistance: 14, anisotropy: 0.6 },
};

export const AO = {
	game: { radius: 0.9, blendIntensity: 1 },
	menu: { radius: 0.35, blendIntensity: 1 },
};

const ShaftShader = {

	uniforms: {
		tColor: { value: null },
		tDepth: { value: null },
		shadowMap: { value: null },
		shadowMatrix: { value: new THREE.Matrix4() },
		projectionInverse: { value: new THREE.Matrix4() },
		cameraWorld: { value: new THREE.Matrix4() },
		cameraPosition2: { value: new THREE.Vector3() },
		sunDirection: { value: new THREE.Vector3() },
		sunColor: { value: new THREE.Color() },
		intensity: { value: 1 },
		density: { value: 0.05 },
		maxDistance: { value: 40 },
		anisotropy: { value: 0.5 },
		hasShadow: { value: 0 },
		baseline: { value: 0.97 },
	},

	vertexShader: /* glsl */`
		out vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,

	fragmentShader: /* glsl */`
		precision highp float;
		precision highp sampler2DShadow;

		uniform sampler2D tColor;
		uniform sampler2D tDepth;
		uniform sampler2DShadow shadowMap;
		uniform mat4 shadowMatrix;
		uniform mat4 projectionInverse;
		uniform mat4 cameraWorld;
		uniform vec3 cameraPosition2;
		uniform vec3 sunDirection; // towards the sun
		uniform vec3 sunColor;
		uniform float intensity;
		uniform float density;
		uniform float maxDistance;
		uniform float anisotropy;
		uniform float hasShadow;
		uniform float baseline; // share of lit air that adds nothing (the normal look)

		in vec2 vUv;
		out vec4 outColor;

		#define STEPS ${ SHAFT_STEPS }
		#define PI 3.14159265

		// Henyey-Greenstein: most light scatters on forward, towards the sun
		float phase( float cosTheta ) {
			float g = anisotropy;
			float g2 = g * g;
			return ( 1.0 - g2 ) / ( 4.0 * PI * pow( 1.0 + g2 - 2.0 * g * cosTheta, 1.5 ) );
		}

		// NaN or infinity in any channel: all exponent bits set
		bool notFinite( vec4 c ) {
			uvec4 e = floatBitsToUint( c ) & 0x7f800000u;
			return any( equal( e, uvec4( 0x7f800000u ) ) );
		}

		// Per-pixel jitter of the march start: banding becomes fine noise
		float ign( vec2 p ) {
			return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
		}

		void main() {

			vec4 color = texture( tColor, vUv );
			// The first effect of the chain: a NaN or infinite pixel from any
			// material stops here (black) instead of reaching the depth of
			// field and the bloom, which spread it into big black rectangles,
			// up to the whole screen. Tested on the bits: isnan() / isinf() are
			// optimised away by some compilers (ANGLE)
			if ( notFinite( color ) ) color = vec4( 0.0, 0.0, 0.0, 1.0 );
			float depth = texture( tDepth, vUv ).r;

			vec4 view = projectionInverse * vec4( vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
			view /= view.w;
			vec3 world = ( cameraWorld * view ).xyz;

			vec3 ray = world - cameraPosition2;
			float dist = min( length( ray ), maxDistance );
			vec3 dir = normalize( ray );

			float stepLen = dist / float( STEPS );
			float jitter = ign( gl_FragCoord.xy );
			float lit = 0.0;

			for ( int i = 0; i < STEPS; i ++ ) {

				vec3 p = cameraPosition2 + dir * ( ( float( i ) + jitter ) * stepLen );
				vec4 sc = shadowMatrix * vec4( p, 1.0 );
				sc.xyz /= sc.w;

				bool inside = sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0;
				lit += inside && hasShadow > 0.5 ? texture( shadowMap, vec3( sc.xy, sc.z - 0.0015 ) ) : 1.0;

			}

			// Share of the air in front of the surface that is lit, against the
			// usual share: only the difference shows, so the picture keeps the
			// normal colours on average — brighter where sun pours through a
			// gap, darker in the shadow a tree casts in the air. Times how much
			// of the light that much air scatters (saturates with distance) and
			// the phase (1 = isotropic).
			float contrast = lit / float( STEPS ) - baseline;
			float scatter = contrast * ( 1.0 - exp( - dist * density ) ) * phase( dot( dir, sunDirection ) ) * 4.0 * PI;
			outColor = vec4( max( color.rgb + sunColor * intensity * scatter, color.rgb * 0.7 ), color.a );

		}`,

};

class ShaftPass {

	constructor( camera, sun, params ) {

		this.camera = camera;
		this.sun = sun;
		this.enabled = true;
		this.needsSwap = true;

		this.material = new THREE.ShaderMaterial( {
			uniforms: THREE.UniformsUtils.clone( ShaftShader.uniforms ),
			vertexShader: ShaftShader.vertexShader,
			fragmentShader: ShaftShader.fragmentShader,
			glslVersion: THREE.GLSL3,
			depthTest: false,
			depthWrite: false,
		} );

		this.set( params );
		this.quad = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), this.material );
		this.quadCamera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

	}

	set( params ) {

		for ( const k in params ) this.material.uniforms[ k ].value = params[ k ];

	}

	setSize() {}

	render( renderer, writeBuffer, readBuffer ) {

		const u = this.material.uniforms;
		const cam = this.camera;
		const sun = this.sun;

		u.tColor.value = readBuffer.texture;
		u.tDepth.value = readBuffer.depthTexture;
		u.projectionInverse.value.copy( cam.projectionMatrixInverse );
		u.cameraWorld.value.copy( cam.matrixWorld );
		u.cameraPosition2.value.setFromMatrixPosition( cam.matrixWorld );
		u.sunDirection.value.subVectors( sun.position, sun.target.position ).normalize();
		u.sunColor.value.copy( sun.color ).multiplyScalar( sun.intensity );

		const map = sun.castShadow && sun.shadow.map ? sun.shadow.map.depthTexture : null;
		u.hasShadow.value = map ? 1 : 0;
		u.shadowMap.value = map;
		u.shadowMatrix.value.copy( sun.shadow.matrix );

		renderer.setRenderTarget( writeBuffer );
		renderer.render( this.quad, this.quadCamera );

	}

	dispose() {

		this.material.dispose();
		this.quad.geometry.dispose();

	}

}

// The ultra effects for a scene: [ shafts, ao ], to put before the bloom in
// renderer.setEffects(). kind: 'game' | 'menu' (tuning above).
export function createUltraEffects( scene, camera, sun, kind = 'game' ) {

	const shafts = new ShaftPass( camera, sun, SHAFTS[ kind ] );

	const ao = new GTAOPass( scene, camera, window.innerWidth, window.innerHeight );
	ao.output = GTAOPass.OUTPUT.Default;
	ao.blendIntensity = AO[ kind ].blendIntensity;
	ao.updateGtaoMaterial( { radius: AO[ kind ].radius, distanceExponent: 1, thickness: 1, scale: 1, samples: 16 } );
	ao.updatePdMaterial( { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 16 } );

	// See-through decals (tyre marks: transparent, no depth write, lifted by a
	// polygon offset) stay out of the AO's normal/depth pass: drawn opaque
	// there they read as a crease and came out solid black. So do the sky's
	// clouds (userData.skipAO): alone against the empty sky, they came out black
	const hideForAO = ao._overrideVisibility.bind( ao );
	ao._overrideVisibility = () => {

		hideForAO();
		ao.scene.traverse( ( o ) => {

			if ( o.isMesh && o.visible && ( o.userData.skipAO || ( o.material && o.material.transparent && o.material.depthWrite === false ) ) ) {

				o.visible = false;
				ao._visibilityCache.push( o );

			}

		} );

	};

	return [ shafts, ao ];

}

// ─── Depth of field (Ultra, menu Paramètres → Graphismes) ──
// three's BokehPass, a plain depth of field: everything at the car's depth
// (along the view) is sharp, left and right alike, and blurs with the
// distance in depth from it. The blur is patched to keep a sharp band `range`
// metres deep around the car's depth, so the car itself never blurs (the menu
// camera is right next to it). blur = depth beyond the band × aperture,
// capped at maxblur; strength 0..100 scales aperture and cap.

export const DOF = {
	game: { aperture: 0.0009, maxblur: 0.009, range: 1.6 },
	menu: { aperture: 0.0025, maxblur: 0.012, range: 1.2 },
};

export function createDofPass( scene, camera, kind = 'game' ) {

	const k = DOF[ kind ];
	const pass = new BokehPass( scene, camera, { focus: 10, aperture: k.aperture, maxblur: k.maxblur } );
	pass.kind = kind;

	const m = pass.materialBokeh;
	m.uniforms.focusRange = { value: k.range };
	m.fragmentShader = m.fragmentShader
		.replace( 'uniform float focus;', 'uniform float focus;\nuniform float focusRange;' )
		.replace( /float factor = \( focus \+ viewZ \);[^\n]*\n\s*vec2 dofblur = vec2 \( clamp\( factor \* aperture, -maxblur, maxblur \) \);/, `float factor = focus + viewZ;
			factor = sign( factor ) * max( 0.0, abs( factor ) - focusRange );
			vec2 dofblur = vec2( clamp( factor * aperture, - maxblur, maxblur ) );` );
	m.needsUpdate = true;
	pass.uniforms = m.uniforms;
	if ( ! m.fragmentShader.includes( 'focusRange )' ) ) console.warn( 'Ultra: depth of field shader not patched (three changed?)' );

	return pass;

}

// settings: { on, strength } (Settings.js dof)
export function setDof( pass, { on = true, strength = 50 } = {} ) {

	const k = DOF[ pass.kind ], s = Math.max( 0, strength ) / 100;
	pass.enabled = on && s > 0;
	pass.uniforms.aperture.value = k.aperture * 2 * s;
	pass.uniforms.maxblur.value = k.maxblur * ( 0.4 + 1.2 * s );

}

// Focus on a world point (the car): its depth along the view, which is what
// the bokeh compares (not the straight-line distance)
const _p = new THREE.Vector3();

export function setFocus( pass, camera, target ) {

	camera.updateMatrixWorld();
	_p.copy( target ).applyMatrix4( camera.matrixWorldInverse );
	pass.uniforms.focus.value = - _p.z;

}
