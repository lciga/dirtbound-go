import { ROCK_NORMAL_Y } from './SplineTrack.js';

// Steep ground is drawn as rock (circuits and rally stages) with a smooth,
// ragged edge, like the rally snow: each vertex of the ground carries a rock
// field from its smooth normal (`aRock`, > 0 = rock), the fragment adds a
// noise and cuts it at 0, antialiased over a pixel. It used to be whole
// facets: square grey triangles on the grass.
//
// The field lives on a heightmap grid: h( i, j ) = height of vertex (i, j),
// S metres apart, triangles split along (i, j+1) – (i+1, j) (both terrains).

export const ROCK_SOFT = 0.12; // normal y over which the field goes from 0 to 1
export const ROCK_EDGE = 0.8; // amplitude of the edge noise (field units)
const LEDGE_GRASS = 0.5; // share of a vertex's flattest triangle in its slope: a ledge's vertices stay grass

export function rockOf( ny ) {

	return ( ROCK_NORMAL_Y - ny ) / ROCK_SOFT;

}

// Rock field of grid vertex (i, j): from its smooth normal, the sum of its
// six triangles' face normals weighted by area (what three's
// computeVertexNormals gives the circuit mesh), leaned toward its flattest
// triangle (LEDGE_GRASS): a narrow ledge between two risers stays grass
export function vertexRock( h, i, j, S ) {

	let nx = 0, ny = 0, nz = 0, flattest = 0;

	// cross( C - B, A - B ) of a triangle A, B, C given as grid vertices
	const add = ( ia, ja, ib, jb, ic, jc ) => {

		const yb = h( ib, jb );
		const cx = ( ic - ib ) * S, cy = h( ic, jc ) - yb, cz = ( jc - jb ) * S;
		const ax = ( ia - ib ) * S, ay = h( ia, ja ) - yb, az = ( ja - jb ) * S;
		const fx = cy * az - cz * ay, fy = cz * ax - cx * az, fz = cx * ay - cy * ax;
		nx += fx;
		ny += fy;
		nz += fz;
		flattest = Math.max( flattest, fy / ( Math.hypot( fx, fy, fz ) || 1 ) );

	};

	add( i, j, i, j + 1, i + 1, j );
	add( i - 1, j, i - 1, j + 1, i, j );
	add( i, j, i - 1, j + 1, i, j + 1 );
	add( i, j - 1, i, j, i + 1, j - 1 );
	add( i + 1, j - 1, i, j, i + 1, j );
	add( i, j - 1, i - 1, j, i, j );

	const smooth = ny / ( Math.hypot( nx, ny, nz ) || 1 );
	return rockOf( smooth + ( flattest - smooth ) * LEDGE_GRASS );

}

// The rock field at (x, z), interpolated over the facet like the mesh's
// attribute; rock( i, j ) = vertexRock of that grid (cached by the caller)
export function rockField( rock, x, z, S ) {

	const fx = x / S, fz = z / S;
	const i = Math.floor( fx ), j = Math.floor( fz );
	const u = fx - i, v = fz - j;
	const f01 = rock( i, j + 1 ), f10 = rock( i + 1, j );

	if ( u + v <= 1 ) {

		const f00 = rock( i, j );
		return f00 + u * ( f10 - f00 ) + v * ( f01 - f00 );

	}

	const f11 = rock( i + 1, j + 1 );
	return f11 - ( 1 - u ) * ( f11 - f01 ) - ( 1 - v ) * ( f11 - f10 );

}

// Is the ground drawn as rock at (x, z) or within r of it (nothing grows
// there): anywhere the edge noise could make rock counts
export function onRockField( field, x, z, r = 0.6 ) {

	for ( const [ dx, dz ] of [ [ 0, 0 ], [ r, 0 ], [ - r, 0 ], [ 0, r ], [ 0, - r ] ] ) {

		if ( field( x + dx, z + dz ) + ROCK_EDGE * 0.5 > 0 ) return true;

	}

	return false;

}

// Shader patch for a colormap material (after onBeforeCompile's own): the
// rock texel `rockUV` wherever aRock + the noise is > 0. Call on the shader;
// returns the fragment code to put right after '#include <map_fragment>'
export function rockShader( shader, rockUV ) {

	shader.uniforms.uRockUV = { value: { x: rockUV[ 0 ], y: rockUV[ 1 ] } };
	shader.vertexShader = shader.vertexShader
		.replace( '#include <common>', '#include <common>\nattribute float aRock;\nvarying float vRock;\nvarying vec2 vRockXZ;\nvarying float vRockY;' )
		.replace( '#include <begin_vertex>', '#include <begin_vertex>\nvRock = aRock;\nvec4 rockWorld = modelMatrix * vec4( transformed, 1.0 );\nvRockXZ = rockWorld.xz;\nvRockY = rockWorld.y;' );
	shader.fragmentShader = shader.fragmentShader
		.replace( '#include <common>', `#include <common>
			varying float vRock;
			varying vec2 vRockXZ;
			varying float vRockY;
			uniform vec2 uRockUV;
			float rockMod( float v ) { return v - floor( v / 101.0 ) * 101.0; }
			float rockHash( vec2 c ) {
				float a = rockMod( c.x );
				a = rockMod( a * ( a * 13.0 + 7.0 ) ) + rockMod( c.y );
				return rockMod( a * ( a * 13.0 + 7.0 ) ) / 101.0;
			}
			float rockValue( vec2 p ) {
				vec2 i = floor( p ), f = p - i;
				f = f * f * ( 3.0 - 2.0 * f );
				float a = rockHash( i ), b = rockHash( i + vec2( 1.0, 0.0 ) ), c = rockHash( i + vec2( 0.0, 1.0 ) ), d = rockHash( i + 1.0 );
				return a + ( b - a ) * f.x + ( c - a ) * f.y + ( a - b - c + d ) * f.x * f.y;
			}` );

	return `
		{
			float e = vRock + ( 0.5 * rockValue( vRockXZ / 3.0 ) + 0.3 * rockValue( vRockXZ / 1.2 + 31.0 ) + 0.2 * rockValue( vRockXZ / 0.5 + 57.0 ) - 0.5 ) * ${ ROCK_EDGE.toFixed( 3 ) };
			float w = max( fwidth( e ) * 0.75, 1e-4 );
			// Strata: bands of shade about 2 m thick, waving along the face,
			// and now and then a warmer vein
			float y = vRockY + 2.5 * rockValue( vRockXZ / 11.0 + 13.0 );
			float layer = rockValue( vec2( y / 2.2, 5.0 ) );
			vec3 rock = diffuse * texture2D( map, uRockUV ).rgb * mix( 0.66, 1.2, layer );
			rock *= mix( vec3( 1.0 ), vec3( 1.1, 1.0, 0.86 ), smoothstep( 0.6, 0.7, rockValue( vec2( y / 7.0, 23.0 ) ) ) );
			diffuseColor.rgb = mix( diffuseColor.rgb, rock, smoothstep( - w, w, e ) );
		}`;

}
