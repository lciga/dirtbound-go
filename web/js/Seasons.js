import * as THREE from 'three';
import { SNOW_EDGE } from './RallyTerrain.js';
import { rockShader } from './RockEdge.js';

// The four seasons of a rally stage (menu Spéciale → Saison, ?season=).
// Same road, same times: only the look changes.
//
//   - grass / leaves: the Kenney colormap's greens (terrain grass, tree
//     foliage) are recoloured in the shader (seasonMaterial): anything green
//     takes the season's colour, keeping its own shading (darker foliage stays
//     darker); trunks, rocks and tents are untouched. Trees pick their colour
//     in a palette by their position (autumn: reds, oranges, yellows).
//   - road: the colours DirtRoad paints the track with (dark orange dirt in
//     spring, packed snow in winter, fallen leaves in autumn).
//   - bushes / flowers: Roadside's colours; spring scatters flowers.
//   - light: winter's sky light is a strong blue, so shadows turn blue.

const hex = ( h ) => new THREE.Color( h );

export const SEASONS = {

	summer: {
		label: 'Été',
		grass: 0x4f9a52,
		leaves: [ 0x4f9a4c, 0x5e9e45, 0x6aa24a, 0x4a8f55 ],
		bushes: [ 0x5e9a44, 0x6ea24a, 0x4f8a45, 0x7aa84e ],
		road: { base: '#b3a283', mid: '#c4b495', edge: '#a4957a', rut: 'rgba(96, 82, 64, 0.55)', ridge: 'rgba(226, 216, 194, 0.35)', dry: 'rgba(225, 214, 190, 0.10)', damp: 'rgba(120, 104, 80, 0.10)', mud: 'rgba(122, 108, 88, 0.35)', pebbles: [ 'rgba(110, 98, 82, 0.7)', 'rgba(235, 228, 212, 0.7)' ] },
		dust: 0xd2c3a3,
	},

	spring: {
		label: 'Printemps',
		grass: 0x3fa648,
		leaves: [ 0x3fa84a, 0x52b34a, 0x46a05a, 0x5aae3f ],
		bushes: [ 0x44a845, 0x57b54a, 0x3c9a4e, 0x62b84f ],
		moreBushes: true, // twice the bushes on the verges
		flowers: [ 0xffffff, 0xf7d64a, 0xf28cb1, 0xa98cf2, 0xff7a4a ],
		road: { base: '#95684a', mid: '#a5754f', edge: '#86603f', rut: 'rgba(70, 42, 24, 0.6)', ridge: 'rgba(190, 150, 110, 0.35)', dry: 'rgba(190, 140, 95, 0.12)', damp: 'rgba(80, 50, 30, 0.14)', mud: 'rgba(78, 52, 34, 0.5)', pebbles: [ 'rgba(62, 40, 26, 0.55)', 'rgba(92, 62, 40, 0.55)' ],
			stones: [ [ 92, 64, 44 ], [ 78, 54, 36 ], [ 104, 74, 50 ] ], tread: 'rgba(60, 36, 20, 0.25)' }, // dark gravel only
		dust: 0xb08a66,
	},

	autumn: {
		label: 'Automne',
		grass: 0xc9a043,
		leaves: [ 0xc23b22, 0xe0762a, 0xe8a531, 0x9c4a26, 0xd65a1f ],
		bushes: [ 0xc8642a, 0xd9982f, 0xa8452a, 0xb8862e ],
		fallen: [ '#c23b22', '#e0762a', '#e8a531', '#9c4a26' ],
		road: { base: '#b09a74', mid: '#bfa982', edge: '#a28a62', rut: 'rgba(96, 76, 52, 0.55)', ridge: 'rgba(222, 205, 170, 0.35)', dry: 'rgba(222, 204, 170, 0.10)', damp: 'rgba(120, 96, 64, 0.12)', mud: 'rgba(110, 88, 60, 0.4)', pebbles: [ 'rgba(106, 88, 66, 0.7)', 'rgba(232, 220, 196, 0.7)' ] },
		dust: 0xcfb58a,
	},

	winter: {
		label: 'Hiver',
		grass: 0xdde5f0,
		leaves: [ 0xe2e9f3, 0xd3dded, 0xeaf0f7 ],
		bushes: [ 0xdfe6f1, 0xd2dcec, 0xe8eef6 ],
		// Dark, washed-out frozen dirt; the bands along the road are snow left
		// between and beside the wheel tracks
		road: { base: '#6c6862', mid: '#76716a', edge: '#646059', rut: 'rgba(236, 240, 247, 0.92)', ridge: 'rgba(60, 57, 53, 0.3)', dry: 'rgba(205, 210, 218, 0.08)', damp: 'rgba(40, 38, 36, 0.15)', mud: 'rgba(48, 45, 42, 0.45)', pebbles: [ 'rgba(52, 50, 48, 0.6)', 'rgba(140, 140, 144, 0.5)' ],
			stones: [ [ 90, 88, 86 ], [ 110, 108, 106 ], [ 72, 70, 68 ] ], tread: 'rgba(160, 172, 190, 0.35)' },
		dust: 0xf4f7fb, // powder snow
		minShade: 0.85, // snow stays white even on the darker foliage
		light: { sky: 0x6f9dff, ground: 0x5a80d4, ambientScale: 1.3, sun: 0xfff0dc, sunScale: 0.8 },
	},

};

export const SEASON_IDS = [ 'summer', 'spring', 'autumn', 'winter' ];

export function season( id ) {

	return SEASONS[ id ] || SEASONS.summer;

}

// Winter light: a blue sky light (shadows go blue), a whiter sun
export function applySeasonLight( id, sun, ambient ) {

	const l = season( id ).light;
	if ( ! l ) return;
	ambient.color.set( l.sky );
	ambient.groundColor.set( l.ground );
	ambient.intensity *= l.ambientScale;
	sun.color.lerp( hex( l.sun ), 0.6 );
	sun.intensity *= l.sunScale ?? 1;

}

// Kenney grass texel (linear luminance): the reference the recolouring keeps
// relative shading against
const GRASS_REF = hex( 0x328260 );
const REF_LUMA = 0.2126 * GRASS_REF.r + 0.7152 * GRASS_REF.g + 0.0722 * GRASS_REF.b;

// Snow up high in the other seasons (RallyStage terrain tiles and road): the
// geometry carries the smooth snow field (`aSnow`, RallyTerrain.snowField),
// the fragment adds the edge noise (RallyTerrain.js snowNoise, same hash) and
// cuts it at 0, antialiased over a pixel: a sharp, ragged edge with flakes
// past it instead of a long fade. World positions: the meshes sit at the origin
export const SNOW_VERTEX = {
	head: '\nattribute float aSnow;\nvarying float vSnow;\nvarying vec2 vSnowXZ;',
	body: '\nvSnow = aSnow;\nvSnowXZ = position.xz;',
};

export const SNOW_FRAGMENT = `
	varying float vSnow;
	varying vec2 vSnowXZ;
	float snowMod( float v ) { return v - floor( v / 101.0 ) * 101.0; }
	float snowHash( vec2 c ) {
		float a = snowMod( c.x );
		a = snowMod( a * ( a * 13.0 + 7.0 ) ) + snowMod( c.y );
		return snowMod( a * ( a * 13.0 + 7.0 ) ) / 101.0;
	}
	float snowValue( vec2 p ) {
		vec2 i = floor( p ), f = p - i;
		f = f * f * ( 3.0 - 2.0 * f );
		float a = snowHash( i ), b = snowHash( i + vec2( 1.0, 0.0 ) ), c = snowHash( i + vec2( 0.0, 1.0 ) ), d = snowHash( i + 1.0 );
		return a + ( b - a ) * f.x + ( c - a ) * f.y + ( a - b - c + d ) * f.x * f.y;
	}
	// 0..1: how much of this pixel is snow
	float snowCover() {
		float e = vSnow + ( 0.5 * snowValue( vSnowXZ / 4.5 ) + 0.3 * snowValue( vSnowXZ / 1.8 + 31.0 ) + 0.2 * snowValue( vSnowXZ / 0.7 + 57.0 ) - 0.5 ) * ${ SNOW_EDGE.toFixed( 3 ) };
		float w = max( fwidth( e ) * 0.75, 1e-4 );
		return smoothstep( - w, w, e );
	}`;

// A clone of a colormap material whose greens take the season's colours:
// grass (not instanced: the terrain) or a leaf colour picked per instance
// snow: the geometry carries an `aSnow` attribute (the snow field, see
// SNOW_FRAGMENT) that whitens the ground like winter's grass; perObject: not
// instanced but leaves all the same (the home's props, one mesh each): the
// colour picked by the object's position; rock: the rock texel ([ u, v ]) the
// geometry's `aRock` field paints with a ragged edge (RockEdge.js), under
// the season's colours and the snow
export function seasonMaterial( material, id, { snow = false, perObject = false, rock = null } = {} ) {

	const s = season( id );
	const m = material.clone();
	// Up to 5 leaf colours and their cumulative weights (the palette pick)
	const n = Math.min( 5, s.leaves.length );
	const weights = s.leafWeights || s.leaves.map( () => 1 / n );
	const leaves = [], cdf = [];
	let acc = 0;

	for ( let i = 0; i < 5; i ++ ) {

		leaves.push( hex( s.leaves[ Math.min( i, n - 1 ) ] ) );
		acc += i < n ? weights[ i ] : 0;
		cdf.push( i >= n - 1 ? 1 : acc );

	}

	// Textured (the colormap): after the map; vertex-coloured (the Nature Kit,
	// Kit.js pieceGeometry): after the vertex colours, which come later
	const after = m.vertexColors ? '#include <color_fragment>' : '#include <map_fragment>';

	m.onBeforeCompile = ( shader ) => {

		shader.uniforms.uGrass = { value: hex( s.grass ) };
		shader.uniforms.uLeaves = { value: leaves };
		shader.uniforms.uLeafCdf = { value: cdf };
		shader.uniforms.uRefLuma = { value: REF_LUMA };
		shader.uniforms.uMinShade = { value: s.minShade ?? 0.55 };
		if ( snow ) shader.uniforms.uSnow = { value: hex( SEASONS.winter.grass ) };
		const rockCode = rock ? rockShader( shader, rock ) : '';

		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nvarying float vSeasonSeed;' + ( snow ? SNOW_VERTEX.head : '' ) )
			.replace( '#include <begin_vertex>', `#include <begin_vertex>
				#ifdef USE_INSTANCING
					vSeasonSeed = fract( sin( dot( instanceMatrix[ 3 ].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
				#elif defined( USE_BATCHING )
					vSeasonSeed = fract( sin( dot( batchingMatrix[ 3 ].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); // RallyStage's forest batches
				#else
					vSeasonSeed = ${ perObject ? 'fract( sin( dot( modelMatrix[ 3 ].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 )' : '- 1.0' };
				#endif` + ( snow ? SNOW_VERTEX.body : '' ) );

		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>
				varying float vSeasonSeed;
				uniform vec3 uGrass;
				uniform vec3 uLeaves[ 5 ];
				uniform float uLeafCdf[ 5 ];
				uniform float uRefLuma;
				uniform float uMinShade;` + ( snow ? SNOW_FRAGMENT + '\nuniform vec3 uSnow;' : '' ) )
			.replace( after, `${ after }${ rockCode }
				{
					vec3 c = diffuseColor.rgb;
					float green = clamp( ( c.g - max( c.r, c.b ) ) * 9.0, 0.0, 1.0 );
					vec3 tint = uGrass;
					if ( vSeasonSeed >= 0.0 ) {
						tint = uLeaves[ 4 ];
						for ( int i = 3; i >= 0; i -- ) if ( vSeasonSeed < uLeafCdf[ i ] ) tint = uLeaves[ i ];
					}
					float luma = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
					vec3 target = tint * clamp( luma / uRefLuma, uMinShade, 1.25 );
					diffuseColor.rgb = mix( c, target, green );
				}` + ( snow ? `
				{
					float l = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
					diffuseColor.rgb = mix( diffuseColor.rgb, uSnow * clamp( 0.75 + l, 0.85, 1.1 ), snowCover() );
				}` : '' ) );

	};

	m.customProgramCacheKey = () => 'season-' + id + ( m.vertexColors ? '-vc' : '' ) + ( snow ? '-snow' : '' ) + ( perObject ? '-obj' : '' ) + ( rock ? '-rock' : '' );
	return m;

}

// Circuit scenery shares materials across hundreds of meshes. Recolour
// once per source material, retaining batching and the original geometry.
export function seasonScenery( object, id ) {

	if ( id === 'summer' ) return object;
	const materials = new Map();
	const themed = ( m ) => {

		if ( ! m.isMeshStandardMaterial ) return m;
		if ( ! materials.has( m ) ) materials.set( m, seasonMaterial( m, id ) );
		return materials.get( m );

	};
	object.traverse( ( o ) => {

		if ( o.isMesh ) o.material = Array.isArray( o.material ) ? o.material.map( themed ) : themed( o.material );

	} );
	return object;

}
