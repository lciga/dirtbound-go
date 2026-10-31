import * as THREE from 'three';

// The Ultra sky's clouds, adapted from Beyond the Clouds (src/world/clouds.js,
// cloud-shapes.js, cloud-material.js): every cloud is a cluster of low-poly
// puffs (bumpy icosahedra; facets buried in another puff dropped, the base
// flattened cartoon style), shaded in three tones by the sun with a lavender
// underside, a warm rim on the edges facing the sun, and the puffs breathing.
// Beyond the Clouds places and drifts its instances in the vertex shader
// (WebGPU, TSL); here the clouds are baked once into one geometry around the
// camera (Sky.js moves the group with it): the Ultra AO and depth of field
// draw the scene with their own materials, which only see real positions.
// The drift is the group turning slowly.

const RING = [ 92, 124 ];        // m from the camera (inside the sky dome, under the rally far plane)
const PUFF = 0.04;               // breathing, share of a puff's radius
const MORPH = 0.07;              // lobes morphing, same unit
const DRIFT = 0.004;             // rad/s, the whole sky turning

// Beyond the Clouds' palette brought to DirtBound's daylight: white tops,
// blue-grey shadows, lavender undersides
export const CLOUD_COLORS = { lit: 0xffffff, mid: 0xe6ebf4, dark: 0xa3b2d6 };

// What fills the sky: archetype, count, scale (m), ring elevation (deg)
const LAYERS = [
	{ type: 'cumulus', count: 16, scale: [ 3.2, 6.0 ], elevation: [ 7, 24 ] },
	{ type: 'cotton', count: 20, scale: [ 1.6, 3.2 ], elevation: [ 6, 34 ] },
	{ type: 'stratus', count: 7, scale: [ 3.5, 6.5 ], elevation: [ 3, 9 ], flat: 0.7, tall: 1.0 },
	{ type: 'cirrus', count: 8, scale: [ 3.5, 7.0 ], elevation: [ 30, 55 ] },
	{ type: 'cb', count: 2, scale: [ 4.5, 6.0 ], elevation: [ 1, 3 ] },
];

const FLATTEN = { cotton: 0.24, cumulus: 0.22, cb: 0.10, stratus: 0.30, cirrus: 0.0 };
const RATE = { cotton: 1.0, cumulus: 0.55, cb: 0.28, stratus: 0.42, cirrus: 0.7 };

function mulberry( seed ) {

	let t = seed >>> 0;

	return () => {

		t = ( t + 0x6D2B79F5 ) >>> 0;
		let r = Math.imul( t ^ ( t >>> 15 ), 1 | t );
		r = ( r + Math.imul( r ^ ( r >>> 7 ), 61 | r ) ) ^ r;
		return ( ( r ^ ( r >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// Smooth deterministic noise: shared facet vertices stay welded
function wobble( x, y, z, s ) {

	return Math.sin( x * 1.73 + y * 2.11 + s ) * 0.55 +
		Math.sin( y * 2.47 + z * 1.31 - s * 1.7 ) * 0.30 +
		Math.sin( z * 3.19 + x * 1.87 + s * 0.6 ) * 0.15;

}

// A puff's radial bumps along its unit direction
const bumps = ( ux, uy, uz, seed ) => 1 +
	0.155 * wobble( ux * 2.1, uy * 2.1, uz * 2.1, seed * 21.7 ) +
	0.075 * wobble( ux * 4.6, uy * 4.6, uz * 4.6, seed * 8.3 );

// Unit icosahedra, non indexed, detail 0 and 1
const ICO = [ 0, 1 ].map( ( detail ) => {

	const g = new THREE.IcosahedronGeometry( 1, detail );
	const src = ( g.index ? g.toNonIndexed() : g ).attributes.position.array;
	const out = new Float32Array( src.length );

	for ( let i = 0; i < src.length; i += 3 ) {

		const l = Math.hypot( src[ i ], src[ i + 1 ], src[ i + 2 ] ) || 1;
		out[ i ] = src[ i ] / l; out[ i + 1 ] = src[ i + 1 ] / l; out[ i + 2 ] = src[ i + 2 ] / l;

	}

	return out;

} );

// ─── Archetypes (Beyond the Clouds' cloud-shapes.js) ──────

function archetypes( rng ) {

	const rand = ( a, b ) => a + ( b - a ) * rng();
	const lerp = ( a, b, t ) => a + ( b - a ) * t;
	const puff = ( cx, cy, cz, rad, sx, sy, sz, detail ) => ( { cx, cy, cz, rad, sx, sy, sz, detail, seed: rng() } );

	return {

		// small cotton flakes
		cotton() {

			const out = [];
			const n = 4 + Math.floor( rng() * 4 );

			for ( let i = 0; i < n; i ++ ) {

				const t = n > 1 ? i / ( n - 1 ) : 0.5;
				const bell = Math.sin( Math.PI * ( 0.18 + 0.64 * t ) );
				out.push( puff( ( t - 0.5 ) * 3.2 + rand( - 0.3, 0.3 ), rand( - 0.2, 0.2 ) + bell * 0.28, rand( - 0.6, 0.6 ),
					( 0.5 + 0.9 * bell ) * rand( 0.85, 1.25 ), rand( 1.0, 1.25 ), rand( 0.75, 1.0 ), rand( 1.0, 1.25 ), rng() < 0.4 ? 0 : 1 ) );

			}

			return out;

		},

		// cumulus: wide flat base, cauliflower on top
		cumulus() {

			const out = [];
			const baseN = 4 + Math.floor( rng() * 3 );
			for ( let i = 0; i < baseN; i ++ ) {

				const t = i / ( baseN - 1 );
				out.push( puff( ( t - 0.5 ) * 4.0, rand( - 0.15, 0.15 ), rand( - 0.7, 0.7 ), rand( 0.95, 1.35 ), rand( 1.0, 1.25 ), rand( 0.62, 0.8 ), rand( 1.0, 1.2 ), 1 ) );

			}

			const midN = 3 + Math.floor( rng() * 3 );
			for ( let i = 0; i < midN; i ++ ) {

				const t = i / Math.max( midN - 1, 1 );
				out.push( puff( ( t - 0.5 ) * 2.8 + rand( - 0.25, 0.25 ), rand( 0.7, 1.05 ), rand( - 0.5, 0.5 ), rand( 0.7, 1.05 ), rand( 0.95, 1.15 ), rand( 0.85, 1.05 ), rand( 0.95, 1.15 ), 1 ) );

			}

			const topN = 1 + Math.floor( rng() * 3 );
			for ( let i = 0; i < topN; i ++ ) out.push( puff( rand( - 0.9, 0.9 ), rand( 1.5, 2.0 ), rand( - 0.4, 0.4 ), rand( 0.5, 0.85 ), 1, rand( 0.9, 1.1 ), 1, rng() < 0.5 ? 0 : 1 ) );
			return out;

		},

		// cumulonimbus: a tower crowned with an anvil, far on the horizon
		cb() {

			const out = [];
			const H = rand( 6.5, 9.0 );

			for ( let i = 0; i < 6; i ++ ) {

				const a = ( i / 6 ) * Math.PI * 2 + rand( - 0.3, 0.3 );
				out.push( puff( Math.cos( a ) * rand( 0.4, 1.5 ), rand( - 0.1, 0.35 ), Math.sin( a ) * rand( 0.4, 1.5 ), rand( 1.1, 1.6 ), 1.1, rand( 0.6, 0.85 ), 1.1, 1 ) );

			}

			const steps = 7 + Math.floor( rng() * 4 );
			for ( let i = 0; i < steps; i ++ ) {

				const t = i / ( steps - 1 );
				const y = lerp( 0.9, H * 0.82, t );
				const r = lerp( 1.35, 0.85, t ) * rand( 0.85, 1.15 );
				for ( let b = 0; b < ( t > 0.55 ? 2 : 1 ); b ++ ) out.push( puff( rand( - 0.8, 0.8 ) + Math.sin( t * 4.0 ) * 0.5, y + rand( - 0.2, 0.2 ), rand( - 0.8, 0.8 ), r, rand( 1.0, 1.2 ), rand( 0.85, 1.1 ), rand( 1.0, 1.2 ), 1 ) );

			}

			const anvilN = 9 + Math.floor( rng() * 5 );
			for ( let i = 0; i < anvilN; i ++ ) {

				const a = ( i / anvilN ) * Math.PI * 2 + rand( - 0.2, 0.2 );
				const rr = rand( 0.6, 3.6 );
				out.push( puff( Math.cos( a ) * rr * rand( 0.9, 1.5 ), H + rand( - 0.35, 0.5 ) - rr * 0.10, Math.sin( a ) * rr,
					lerp( 1.25, 0.62, rr / 3.6 ), rand( 1.1, 1.5 ), rand( 0.24, 0.38 ), rand( 1.1, 1.5 ), rng() < 0.5 ? 0 : 1 ) );

			}

			return out;

		},

		// stratus: a long stretched sheet
		stratus() {

			const out = [];
			const n = 11 + Math.floor( rng() * 8 );
			const arc = rand( - 0.35, 0.35 );

			for ( let i = 0; i < n; i ++ ) {

				const t = i / ( n - 1 );
				out.push( puff( ( t - 0.5 ) * 11.0, Math.sin( t * Math.PI ) * 0.35 + arc * ( t - 0.5 ) * 4.0 + rand( - 0.12, 0.12 ), rand( - 1.3, 1.3 ),
					rand( 0.7, 1.25 ), rand( 1.2, 1.8 ), rand( 0.20, 0.34 ), rand( 1.0, 1.5 ), rng() < 0.55 ? 0 : 1 ) );

			}

			return out;

		},

		// cirrus: thin tapered wisps, high up
		cirrus() {

			const out = [];
			const n = 13 + Math.floor( rng() * 9 );
			const curl = rand( - 0.5, 0.5 );

			for ( let i = 0; i < n; i ++ ) {

				const t = i / ( n - 1 );
				const taper = Math.sin( Math.PI * ( 0.08 + 0.84 * t ) );
				out.push( puff( ( t - 0.5 ) * 13.0, curl * Math.pow( t, 1.7 ) * 3.0 + rand( - 0.1, 0.1 ), Math.sin( t * 3.1 + curl ) * 0.8,
					rand( 0.22, 0.5 ) * ( 0.4 + taper ), rand( 2.0, 3.2 ), rand( 0.16, 0.26 ), rand( 0.7, 1.1 ), 0 ) );

			}

			return out;

		},

	};

}

// Is a point inside another puff (its facets there are never seen)
function insidePuff( x, y, z, q, margin ) {

	const dx = ( x - q.cx ) / q.sx, dy = ( y - q.cy ) / q.sy, dz = ( z - q.cz ) / q.sz;
	const lim = q.rad * 1.26;
	if ( dx > lim || dx < - lim || dy > lim || dy < - lim || dz > lim || dz < - lim ) return false;
	const r = Math.hypot( dx, dy, dz );
	if ( r > lim || r < 1e-6 ) return r < 1e-6;
	return r < bumps( dx / r, dy / r, dz / r, q.seed ) * q.rad * margin;

}

// One cloud: { position, dir (unit, from its puff's centre) × length,
// phase, shade (0 underside → 1 top) } in cloud units
function cloudFromPuffs( puffs, flatten, rate ) {

	const vx = [], owner = [];

	for ( let pi = 0; pi < puffs.length; pi ++ ) {

		const p = puffs[ pi ];
		const tpl = ICO[ p.detail ];

		for ( let i = 0; i < tpl.length; i += 3 ) {

			const x = tpl[ i ], y = tpl[ i + 1 ], z = tpl[ i + 2 ];
			const k = bumps( x, y, z, p.seed );
			vx.push( p.cx + x * k * p.rad * p.sx, p.cy + y * k * p.rad * p.sy, p.cz + z * k * p.rad * p.sz );

		}

		for ( let t = tpl.length / 9; t > 0; t -- ) owner.push( pi );

	}

	const tris = [];

	for ( let t = 0; t < owner.length; t ++ ) {

		const o = owner[ t ], b = t * 9;
		let hidden = false;

		for ( let q = 0; q < puffs.length && ! hidden; q ++ ) {

			if ( q === o ) continue;
			const P = puffs[ q ];
			hidden = insidePuff( vx[ b ], vx[ b + 1 ], vx[ b + 2 ], P, 0.94 ) &&
				insidePuff( vx[ b + 3 ], vx[ b + 4 ], vx[ b + 5 ], P, 0.94 ) &&
				insidePuff( vx[ b + 6 ], vx[ b + 7 ], vx[ b + 8 ], P, 0.94 );

		}

		if ( ! hidden ) tris.push( t );

	}

	const n = tris.length * 3;
	const position = new Float32Array( n * 3 ), disp = new Float32Array( n * 3 ), phase = new Float32Array( n * 2 ), shade = new Float32Array( n );
	let w = 0;

	for ( const t of tris ) {

		const p = puffs[ owner[ t ] ];

		for ( let v = 0; v < 3; v ++ ) {

			const s = t * 9 + v * 3;
			const x = vx[ s ], y = vx[ s + 1 ], z = vx[ s + 2 ];
			position.set( [ x, y, z ], w * 3 );
			disp.set( [ x - p.cx, y - p.cy, z - p.cz ], w * 3 ); // dir × distance to the puff's centre
			phase.set( [ p.seed * 6.2831, rate * ( 0.75 + p.seed * 0.5 ) ], w * 2 );
			w ++;

		}

	}

	// Flat cartoon base, then the vertical gradient
	let minY = Infinity, maxY = - Infinity;

	for ( let i = 1; i < position.length; i += 3 ) {

		minY = Math.min( minY, position[ i ] );
		maxY = Math.max( maxY, position[ i ] );

	}

	if ( flatten > 0 ) {

		const cut = minY + ( maxY - minY ) * flatten;
		minY = Infinity;

		for ( let i = 1; i < position.length; i += 3 ) {

			if ( position[ i ] < cut ) position[ i ] = cut - ( cut - position[ i ] ) * 0.22;
			minY = Math.min( minY, position[ i ] );

		}

	}

	const span = Math.max( maxY - minY, 1e-4 );
	for ( let i = 0; i < shade.length; i ++ ) shade[ i ] = ( position[ i * 3 + 1 ] - minY ) / span;

	return { position, disp, phase, shade, count: n };

}

// ─── Material: the three-tone toon of cloud-material.js ──

const vertexShader = /* glsl */`
	attribute vec3 aDisp;
	attribute vec2 aPhase;
	attribute float aShade;
	uniform float uTime;
	varying vec3 vWorld;
	varying vec3 vSkyDir;
	varying float vShade;

	void main() {

		// breathing + lobes morphing (Beyond the Clouds), along the puff's radius
		vec3 dir = normalize( aDisp );
		float len = length( aDisp );
		float rate = aPhase.y, ph = aPhase.x;
		float breathe = sin( uTime * 0.55 * rate + ph ) * 0.5 + 0.5;
		float m = sin( dir.x * 2.3 + dir.y * 1.9 + uTime * 0.23 * rate + ph ) * cos( dir.z * 2.7 - uTime * 0.13 * rate + ph * 0.7 );
		vec3 pos = position + dir * len * ( ${ PUFF.toFixed( 3 ) } * breathe + ${ MORPH.toFixed( 3 ) } * m );

		vec4 world = modelMatrix * vec4( pos, 1.0 );
		vWorld = world.xyz;
		vSkyDir = normalize( world.xyz - cameraPosition );
		vShade = aShade;
		gl_Position = projectionMatrix * viewMatrix * world;

	}
`;

const fragmentShader = /* glsl */`
	uniform vec3 uLit;
	uniform vec3 uMid;
	uniform vec3 uDark;
	uniform vec3 uHorizon;
	uniform vec3 uSunColor;
	uniform vec3 uSunDir;
	varying vec3 vWorld;
	varying vec3 vSkyDir;
	varying float vShade;

	void main() {

		// the facets are the style: flat normal from the screen derivatives.
		// A facet seen edge on gives a null cross product: normalize() would
		// return NaN, which the Ultra bloom spreads into big black rectangles
		vec3 c = cross( dFdx( vWorld ), dFdy( vWorld ) );
		float cl = length( c );
		vec3 N = cl > 1e-10 ? c / cl : normalize( cameraPosition - vWorld );
		vec3 V = normalize( cameraPosition - vWorld );
		if ( dot( N, V ) < 0.0 ) N = - N;

		float nds = dot( N, uSunDir );
		float ndl = nds * 0.5 + 0.5;

		// three-step cartoon ramp
		vec3 col = mix( uDark, uMid, smoothstep( 0.43, 0.51, ndl ) );
		col = mix( col, uLit, smoothstep( 0.63, 0.71, ndl ) );

		// the underside falls back into the lavender
		col = mix( mix( uDark, col, 0.30 ), col, smoothstep( 0.0, 0.62, vShade ) );

		// warm rim on the outline facing the sun
		float rim = pow( 1.0 - max( dot( N, V ), 0.0 ), 2.6 );
		float sunSide = smoothstep( - 0.25, 0.85, nds );
		col += uSunColor * rim * ( 0.12 + sunSide * 0.45 );

		// low clouds melt into the horizon haze, like the sky dome
		float up = clamp( vSkyDir.y, 0.0, 1.0 );
		col = mix( uHorizon, col, smoothstep( 0.02, 0.32, up ) * 0.85 + 0.15 );

		gl_FragColor = vec4( max( col, 0.0 ), 1.0 );

		#include <tonemapping_fragment>
		#include <colorspace_fragment>

	}
`;

// The clouds as one mesh around (0, 0, 0): the caller keeps it on the camera.
// horizon: the fog colour (THREE.Color); scale: ring and clouds pushed back
// and grown alike (the same sky, further: the view distance doubled in Ultra)
export function buildSkyClouds( horizon, { scale = 1, seed = 11 } = {} ) {

	const rng = mulberry( seed );
	const rand = ( a, b ) => a + ( b - a ) * rng();
	const shapes = archetypes( rng );
	const parts = [];
	let total = 0;

	for ( const layer of LAYERS ) {

		for ( let i = 0; i < layer.count; i ++ ) {

			const cloud = cloudFromPuffs( shapes[ layer.type ](), FLATTEN[ layer.type ], RATE[ layer.type ] );
			const s = rand( layer.scale[ 0 ], layer.scale[ 1 ] ) * scale;
			const kx = rand( 0.9, 1.15 ), ky = rand( layer.flat ?? 0.85, layer.tall ?? 1.15 ), kz = rand( 0.9, 1.15 );
			const angle = rng() * Math.PI * 2;
			const elevation = THREE.MathUtils.degToRad( rand( layer.elevation[ 0 ], layer.elevation[ 1 ] ) );
			const d = rand( RING[ 0 ], RING[ 1 ] ) * scale;
			// broadside to the camera (the long axis across the view), a little turned
			const turn = angle + Math.PI / 2 + rand( - 0.5, 0.5 );
			parts.push( { cloud, s, kx, ky, kz, turn, x: Math.cos( angle ) * Math.cos( elevation ) * d, y: Math.sin( elevation ) * d, z: Math.sin( angle ) * Math.cos( elevation ) * d } );
			total += cloud.count;

		}

	}

	const position = new Float32Array( total * 3 ), disp = new Float32Array( total * 3 ), phase = new Float32Array( total * 2 ), shade = new Float32Array( total );
	// Each vertex's cloud: its centre and a rank 0..1 (lab/studio.html grows the clouds
	// in by rank for its cloud cover; the game doesn't read them)
	const centre = new Float32Array( total * 3 ), rank = new Float32Array( total );
	let o = 0, n = 0;

	for ( const { cloud, s, kx, ky, kz, turn, x, y, z } of parts ) {

		const r = ( ( n ++ * 0.6180339887 ) + 0.13 ) % 1;

		const c = Math.cos( turn ), sn = Math.sin( turn );

		for ( let i = 0; i < cloud.count; i ++ ) {

			const px = cloud.position[ i * 3 ] * s * kx, py = cloud.position[ i * 3 + 1 ] * s * ky, pz = cloud.position[ i * 3 + 2 ] * s * kz;
			const dx = cloud.disp[ i * 3 ] * s * kx, dy = cloud.disp[ i * 3 + 1 ] * s * ky, dz = cloud.disp[ i * 3 + 2 ] * s * kz;
			position.set( [ x + px * c + pz * sn, y + py, z + pz * c - px * sn ], o * 3 );
			disp.set( [ dx * c + dz * sn, dy, dz * c - dx * sn ], o * 3 );
			phase.set( [ cloud.phase[ i * 2 ], cloud.phase[ i * 2 + 1 ] ], o * 2 );
			shade[ o ] = cloud.shade[ i ];
			centre.set( [ x, y, z ], o * 3 );
			rank[ o ] = r;
			o ++;

		}

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( position, 3 ) );
	geometry.setAttribute( 'aDisp', new THREE.BufferAttribute( disp, 3 ) );
	geometry.setAttribute( 'aPhase', new THREE.BufferAttribute( phase, 2 ) );
	geometry.setAttribute( 'aShade', new THREE.BufferAttribute( shade, 1 ) );
	geometry.setAttribute( 'aCentre', new THREE.BufferAttribute( centre, 3 ) );
	geometry.setAttribute( 'aRank', new THREE.BufferAttribute( rank, 1 ) );
	geometry.computeBoundingSphere();

	const material = new THREE.ShaderMaterial( {
		vertexShader,
		fragmentShader,
		uniforms: {
			uTime: { value: 0 },
			uLit: { value: new THREE.Color( CLOUD_COLORS.lit ) },
			uMid: { value: new THREE.Color( CLOUD_COLORS.mid ) },
			uDark: { value: new THREE.Color( CLOUD_COLORS.dark ) },
			uHorizon: { value: horizon.clone() },
			uSunColor: { value: new THREE.Color( 0xffd2a8 ) },
			uSunDir: { value: new THREE.Vector3( 0.4, 0.8, 0.3 ).normalize() },
		},
		fog: false,
	} );

	const mesh = new THREE.Mesh( geometry, material );
	mesh.frustumCulled = false;
	mesh.userData.skipAO = true; // Ultra.js: out of the AO (alone against the sky it came out black)
	mesh.renderOrder = - 0.5; // after the sky dome (- 1), before the world
	return mesh;

}

// Every frame: time (s), the direction towards the sun, the drift
export function updateSkyClouds( mesh, time, sunDir ) {

	const u = mesh.material.uniforms;
	u.uTime.value = time;
	if ( sunDir ) u.uSunDir.value.copy( sunDir );
	mesh.rotation.y = time * DRIFT;

}
