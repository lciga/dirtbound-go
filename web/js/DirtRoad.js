import * as THREE from 'three';
import { ROAD_Y } from './SplineTrack.js';
import { season, SEASONS, SNOW_VERTEX, SNOW_FRAGMENT } from './Seasons.js';

// The rally stage's road: a rough dirt track instead of the Kenney asphalt
// tiles and barriers. One ribbon per chunk along the path — a ragged edge
// (width noise along the route) and a skirt that drops to the grass — with a
// painted texture: pale dirt, dark wandering ruts where the wheels go,
// pebbles, puddles, grass eating into the edges. The texture runs along the
// route's arc length, so chunks join without a seam.

export const DIRT_HALF = 2.9; // m, centreline → dirt edge (the drivable road, before noise)
const EDGE_NOISE = 0.5; // m of width variation along the road
const SKIRT = 0.8; // m of verge between the dirt and the grass
const TEX_LENGTH = 24; // m of road per texture repeat
const TERRAIN_SINK = - 0.15; // same as RallyStage: the grass sits a bit under the road

// Half-width of the dirt at route arc length s, side -1 (left) / +1 (right),
// × the biome's width factor (RallyRoute.widthAt). Smooth pseudo-noise (a
// few sines), same everywhere for a given s.
export function dirtHalfAt( s, side, width = 1 ) {

	const k = side > 0 ? 1.7 : 0.3;
	const n = Math.sin( s * 0.21 + k ) * 0.5 + Math.sin( s * 0.057 + k * 3 ) * 0.35 + Math.sin( s * 0.73 + k * 7 ) * 0.15;
	return ( DIRT_HALF + n * EDGE_NOISE ) * width;

}

// Cross-section: [ lateral fraction of the dirt half-width (0 = centre), u ]
// for the columns from left skirt to right skirt
const COLUMNS = [ - 1, - 0.66, - 0.33, 0, 0.33, 0.66, 1 ];

// Ribbon for a chunk: path samples (with heights in path.py), startS = route
// arc length at the path start, scale = route metres per path metre.
// leadIn / runOut: metres of track carried on straight before the start (the
// first chunk) / past the end (a limited stage's last chunk), full width then
// narrowing out, so the stage doesn't begin or end on a hard edge.
// heightAt( s ): route elevation for the run-out; widthAt( s ): the biome's width factor.
// snowField( x, y, z ): the terrain's snow field (RallyTerrain.snowField) for
// an `aSnow` attribute (createDirtMaterial's snow), or null
export function buildDirtRoadGeometry( path, startS, scale, leadIn = 0, runOut = 0, heightAt = null, widthAt = () => 1, snowField = null ) {

	if ( leadIn > 0 || runOut > 0 ) path = withExtensions( path, startS, scale, leadIn, runOut, heightAt );
	const n = path.sampleCount ?? path.px.length;
	const cols = COLUMNS.length + 2; // + the two skirt edges
	const positions = new Float32Array( n * cols * 3 );
	const uvs = new Float32Array( n * cols * 2 );
	const snow = snowField ? new Float32Array( n * cols ) : null;
	let p = 0, q = 0, r = 0;

	for ( let i = 0; i < n; i ++ ) {

		const x = path.px[ i ], z = path.pz[ i ], y = path.py[ i ] + ROAD_Y;
		const lx = path.tz[ i ], lz = - path.tx[ i ]; // left of the tangent
		const s = startS + path.s[ i ] * scale;
		const narrow = path.narrow ? path.narrow[ i ] : 1;
		const w = widthAt( s );
		const left = dirtHalfAt( s, - 1, w ) * narrow, right = dirtHalfAt( s, 1, w ) * narrow;
		const v = s / TEX_LENGTH;

		const push = ( lat, height, u ) => {

			positions[ p ++ ] = x + lx * lat;
			positions[ p ++ ] = height;
			positions[ p ++ ] = z + lz * lat;
			if ( snow ) snow[ r ++ ] = snowField( x + lx * lat, path.py[ i ], z + lz * lat );
			uvs[ q ++ ] = u;
			uvs[ q ++ ] = v;

		};

		// Left skirt edge down at grass level, the dirt columns, right skirt edge
		const skirtL = left + SKIRT * ( 0.7 + 0.3 * Math.sin( s * 0.9 ) );
		const skirtR = right + SKIRT * ( 0.7 + 0.3 * Math.sin( s * 1.1 + 2 ) );
		push( skirtL, y + TERRAIN_SINK - 0.02, 0 );

		for ( const c of COLUMNS ) {

			const half = c < 0 ? left : right;
			push( - c * half, y, 0.1 + ( c + 1 ) * 0.4 );

		}

		push( - skirtR, y + TERRAIN_SINK - 0.02, 1 );

	}

	const index = [];

	for ( let i = 0; i < n - 1; i ++ ) {

		for ( let c = 0; c < cols - 1; c ++ ) {

			const a = i * cols + c, b = a + 1, d = a + cols, e = d + 1;
			index.push( a, b, d, b, e, d ); // counter-clockwise seen from above (columns run left → right)

		}

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
	if ( snow ) geometry.setAttribute( 'aSnow', new THREE.BufferAttribute( snow, 1 ) );
	geometry.setIndex( index );
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	return geometry;

}

const FADE = 10; // m over which an extension narrows out at its far end

// The path's samples with straight stretches added before its start (flat, at
// the start height) and after its end (on the route's elevation), full width
// then narrowing to 40 % over the last FADE metres
function withExtensions( path, startS, scale, leadIn, runOut, heightAt ) {

	const out = { px: [], pz: [], py: [], tx: [], tz: [], s: [], narrow: [] };
	const n = path.sampleCount;
	const narrow = ( d, len ) => 1 - 0.6 * Math.max( 0, ( d - ( len - FADE ) ) / FADE );

	for ( let d = leadIn; d >= 1; d -= 2 ) {

		out.px.push( path.px[ 0 ] - path.tx[ 0 ] * d );
		out.pz.push( path.pz[ 0 ] - path.tz[ 0 ] * d );
		out.py.push( path.py[ 0 ] );
		out.tx.push( path.tx[ 0 ] );
		out.tz.push( path.tz[ 0 ] );
		out.s.push( - d );
		out.narrow.push( narrow( d, leadIn ) );

	}

	for ( let i = 0; i < n; i ++ ) {

		for ( const key of [ 'px', 'pz', 'py', 'tx', 'tz', 's' ] ) out[ key ].push( path[ key ][ i ] );
		out.narrow.push( 1 );

	}

	const L = path.s[ n - 1 ], endS = startS + L * scale;

	for ( let d = 1; d <= runOut; d += 2 ) {

		out.px.push( path.px[ n - 1 ] + path.tx[ n - 1 ] * d );
		out.pz.push( path.pz[ n - 1 ] + path.tz[ n - 1 ] * d );
		out.py.push( heightAt ? heightAt( endS + d ) : path.py[ n - 1 ] );
		out.tx.push( path.tx[ n - 1 ] );
		out.tz.push( path.tz[ n - 1 ] );
		out.s.push( L + d / scale );
		out.narrow.push( narrow( d, runOut ) );

	}

	out.sampleCount = out.px.length;
	return out;

}

// ─── Texture ──────────────────────────────────────────────

function mulberry( seed ) {

	let t = seed >>> 0;

	return () => {

		t = ( t + 0x6D2B79F5 ) >>> 0;
		let r = Math.imul( t ^ ( t >>> 15 ), 1 | t );
		r = ( r + Math.imul( r ^ ( r >>> 7 ), 61 | r ) ) ^ r;
		return ( ( r ^ ( r >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

const W = 256, H = 1024; // u across (skirt to skirt), v along TEX_LENGTH

// grass: [ colour, darker, lighter ] (CSS) of the terrain's grass, painted
// opaque so the verge is exactly the terrain's green (blended over the sand
// it turned olive).
// k: resolution factor (1, or 4 in Ultra): the same painting, drawn in base
// units through a scale, plus fine detail only a big texture can hold.
// road: the season's colours (Seasons.js); fallen / flowers: its extras
function paintDirt( greens, k = 1, sea = season( 'summer' ) ) {

	const grass = greens[ 0 ];
	const road = sea.road;

	const canvas = document.createElement( 'canvas' );
	canvas.width = W * k;
	canvas.height = H * k;
	const g = canvas.getContext( '2d', { willReadFrequently: k > 1 } );
	g.scale( k, k );
	const rand = mulberry( 1234 );

	// Dirt, lighter in the middle where the dust settles
	const base = g.createLinearGradient( 0, 0, W, 0 );
	base.addColorStop( 0, grass );
	base.addColorStop( 0.065, grass );
	base.addColorStop( 0.11, road.edge );
	base.addColorStop( 0.16, road.base );
	base.addColorStop( 0.5, road.mid );
	base.addColorStop( 0.84, road.base );
	base.addColorStop( 0.89, road.edge );
	base.addColorStop( 0.935, grass );
	base.addColorStop( 1, grass );
	g.fillStyle = base;
	g.fillRect( 0, 0, W, H );

	// Blotches of damp and dry dirt
	for ( let k = 0; k < 160; k ++ ) {

		const x = 0.12 * W + rand() * 0.76 * W, y = rand() * H, r = 6 + rand() * 26;
		g.fillStyle = rand() < 0.5 ? road.damp : road.dry;
		g.beginPath();
		g.ellipse( x, y, r * 0.6, r * 1.8, 0, 0, Math.PI * 2 );
		g.fill();
		g.beginPath(); // tile vertically
		g.ellipse( x, y + ( y < H / 2 ? H : - H ), r * 0.6, r * 1.8, 0, 0, Math.PI * 2 );
		g.fill();

	}

	// Ruts: dark wandering bands where the wheels run, a pale ridge beside
	// each (u of a lateral offset: centre 0.5, dirt edges 0.1 / 0.9)
	const ruts = [ - 0.62, - 0.3, 0.3, 0.62 ];
	const rutLines = []; // { x( y ), width } in base units, for the fine detail

	for ( const r of ruts ) {

		const phase = rand() * Math.PI * 2, amp = 3 + rand() * 4, width = 7 + rand() * 5;
		const cx = ( 0.5 + r * 0.4 ) * W;
		rutLines.push( { width, x: ( y ) => cx + Math.sin( y / H * Math.PI * 2 * 2 + phase ) * amp + Math.sin( y / H * Math.PI * 2 * 5 + phase * 2 ) * amp * 0.4 } );

		for ( let pass = 0; pass < 2; pass ++ ) {

			g.strokeStyle = pass === 0 ? road.ridge : road.rut;
			g.lineWidth = pass === 0 ? width + 6 : width;
			g.beginPath();

			for ( let y = 0; y <= H; y += 8 ) {

				// Whole periods over H so the texture tiles along the road
				const x = cx + Math.sin( y / H * Math.PI * 2 * 2 + phase ) * amp + Math.sin( y / H * Math.PI * 2 * 5 + phase * 2 ) * amp * 0.4;
				if ( y === 0 ) g.moveTo( x, y );
				else g.lineTo( x, y );

			}

			g.stroke();

		}

	}

	// Muddy patches in the ruts now and then: a few overlapping blobs, dark
	// wet centre, a sheen of sky on it
	for ( let k = 0; k < 4; k ++ ) {

		const r = ruts[ Math.floor( rand() * ruts.length ) ];
		const x = ( 0.5 + r * 0.4 ) * W, y = 80 + rand() * ( H - 160 );

		for ( let b = 0; b < 4; b ++ ) {

			g.fillStyle = road.mud;
			g.beginPath();
			g.ellipse( x + ( rand() - 0.5 ) * 10, y + ( rand() - 0.5 ) * 40, 6 + rand() * 6, 14 + rand() * 18, ( rand() - 0.5 ) * 0.3, 0, Math.PI * 2 );
			g.fill();

		}

		g.fillStyle = 'rgba(104, 98, 90, 0.45)';
		g.beginPath();
		g.ellipse( x, y, 5 + rand() * 3, 12 + rand() * 10, 0, 0, Math.PI * 2 );
		g.fill();
		g.fillStyle = 'rgba(190, 200, 205, 0.25)';
		g.beginPath();
		g.ellipse( x - 1.5, y - 4, 2.5, 6, 0, 0, Math.PI * 2 );
		g.fill();

	}

	// Pebbles (Ultra draws real little stones instead, in paintFine)
	for ( let p = 0; p < 900; p ++ ) {

		const x = 0.1 * W + rand() * 0.8 * W, y = rand() * H;
		const light = rand() < 0.5, w = 1 + rand() * 2.5, h = 1 + rand() * 2.5;
		if ( k > 1 ) continue;
		g.fillStyle = road.pebbles[ light ? 0 : 1 ];
		g.fillRect( x, y, w, h );

	}

	// Grass tufts eating the edges
	for ( let k = 0; k < 260; k ++ ) {

		const side = rand() < 0.5;
		const x = side ? rand() * 0.16 * W : W - rand() * 0.16 * W, y = rand() * H;
		g.fillStyle = greens[ Math.floor( rand() * 3 ) ];
		rand();
		g.beginPath();
		g.ellipse( x, y, 2 + rand() * 5, 4 + rand() * 12, 0, 0, Math.PI * 2 );
		g.fill();

	}

	// Autumn: fallen leaves, thicker on the verges; spring: flowers in the grass
	if ( sea.fallen ) {

		for ( let l = 0; l < 700; l ++ ) {

			const edge = rand() < 0.6;
			const x = edge ? ( rand() < 0.5 ? rand() * 0.22 : 1 - rand() * 0.22 ) * W : ( 0.15 + rand() * 0.7 ) * W;
			g.fillStyle = sea.fallen[ Math.floor( rand() * sea.fallen.length ) ];
			g.beginPath();
			g.ellipse( x, 4 + rand() * ( H - 8 ), 1.2 + rand() * 1.4, 2 + rand() * 1.5, rand() * 3, 0, Math.PI * 2 );
			g.fill();

		}

	}

	if ( sea.flowers ) {

		for ( let f = 0; f < 420; f ++ ) {

			const x = ( rand() < 0.5 ? rand() * 0.075 : 1 - rand() * 0.075 ) * W;
			g.fillStyle = '#' + new THREE.Color( sea.flowers[ Math.floor( rand() * sea.flowers.length ) ] ).getHexString();
			g.beginPath();
			g.arc( x, 3 + rand() * ( H - 6 ), 0.9 + rand() * 0.9, 0, Math.PI * 2 );
			g.fill();

		}

	}

	if ( k > 1 ) paintFine( g, k, greens, rutLines, road );
	return canvas;

}

// Ultra: detail at the texture's own resolution (pixel space): grain in the
// dirt, small stones with a lit and a shaded side, tread prints in the ruts,
// dry cracks, grass blades at the edges
function paintFine( g, k, greens, rutLines, road = {} ) {

	const PW = W * k, PH = H * k;
	const rand = mulberry( 99 );
	g.setTransform( 1, 0, 0, 1, 0, 0 );

	// Grain: every dirt pixel a little lighter or darker
	const img = g.getImageData( 0, 0, PW, PH );
	const d = img.data;
	const x0 = Math.floor( 0.09 * PW ), x1 = Math.ceil( 0.91 * PW );

	for ( let y = 0; y < PH; y ++ ) {

		for ( let x = x0; x < x1; x ++ ) {

			const i = ( y * PW + x ) * 4;
			const n = ( rand() - 0.5 ) * 16;
			d[ i ] += n;
			d[ i + 1 ] += n;
			d[ i + 2 ] += n * 0.9;

		}

	}

	g.putImageData( img, 0, 0 );

	// Tread prints: short dashes across each rut
	for ( const rut of rutLines ) {

		g.strokeStyle = road.tread || 'rgba(80, 68, 52, 0.22)';
		g.lineWidth = 1.2;

		for ( let y = 2; y < PH - 2; y += 5 + rand() * 3 ) {

			const cx = rut.x( y / k ) * k, half = rut.width * k * 0.35;
			const tilt = ( rand() - 0.5 ) * 3;
			g.beginPath();
			g.moveTo( cx - half, y - tilt );
			g.lineTo( cx + half, y + tilt );
			g.stroke();

		}

	}

	// Dry cracks in the crown of the road
	g.strokeStyle = 'rgba(92, 80, 62, 0.28)';
	g.lineWidth = 1;

	for ( let c = 0; c < 70; c ++ ) {

		let x = ( 0.2 + rand() * 0.6 ) * PW, y = 20 + rand() * ( PH - 40 );
		g.beginPath();
		g.moveTo( x, y );

		for ( let s = 0; s < 6; s ++ ) {

			x += ( rand() - 0.5 ) * 14;
			y += ( rand() - 0.5 ) * 14;
			g.lineTo( x, y );

		}

		g.stroke();

	}

	// Small stones: body, lit top-left, shade bottom-right
	const stones = road.stones || [ [ 150, 138, 120 ], [ 176, 168, 152 ], [ 120, 110, 96 ], [ 200, 194, 180 ] ];

	for ( let s = 0; s < 7000; s ++ ) {

		const r = 0.8 + rand() * rand() * 3.5;
		const x = ( 0.1 + rand() * 0.8 ) * PW, y = r + 1 + rand() * ( PH - 2 * r - 2 );
		const [ R, G, B ] = stones[ Math.floor( rand() * stones.length ) ];
		g.fillStyle = `rgba(70, 60, 48, 0.35)`;
		g.beginPath();
		g.ellipse( x + r * 0.35, y + r * 0.35, r, r * 0.8, 0, 0, Math.PI * 2 );
		g.fill();
		g.fillStyle = `rgb(${ R }, ${ G }, ${ B })`;
		g.beginPath();
		g.ellipse( x, y, r, r * 0.8, rand() * 3, 0, Math.PI * 2 );
		g.fill();
		g.fillStyle = 'rgba(255, 250, 240, 0.45)';
		g.fillRect( x - r * 0.45, y - r * 0.45, Math.max( 1, r * 0.5 ), Math.max( 1, r * 0.4 ) );

	}

	// Grass blades along the edges
	for ( let b = 0; b < 9000; b ++ ) {

		const side = rand() < 0.5;
		const u = side ? rand() * rand() * 0.2 : 1 - rand() * rand() * 0.2;
		const x = u * PW, y = 10 + rand() * ( PH - 20 );
		const len = 4 + rand() * 9;
		g.strokeStyle = greens[ Math.floor( rand() * 3 ) ];
		g.lineWidth = 1 + rand();
		g.beginPath();
		g.moveTo( x, y );
		g.lineTo( x + ( rand() - 0.5 ) * 5, y - len );
		g.stroke();
		g.strokeStyle = greens[ 1 ];
		g.beginPath();
		g.moveTo( x + 1, y );
		g.lineTo( x + 1 + ( rand() - 0.5 ) * 4, y - len * 0.7 );
		g.stroke();

	}

}

// Material for the dirt road; grassColor: THREE.Color of the terrain grass.
// ultra: the texture at 4× the resolution each way, with fine detail.
// snow: the geometry carries the snow field (`aSnow`): where the terrain
// beside it is white, the road takes the winter painting (packed snow), cut
// as sharp as the terrain's snow (Seasons.js SNOW_FRAGMENT); `snowMap` = that
// second texture (dispose it with the material's map)
export function createDirtMaterial( grassColor, ultra = false, seasonId = 'summer', { snow = false } = {} ) {

	const texture = dirtTexture( grassColor, ultra, season( seasonId ) );
	const material = new THREE.MeshStandardMaterial( { map: texture, roughness: 1, metalness: 0 } );
	if ( ! snow ) return material;

	const snowMap = dirtTexture( new THREE.Color( SEASONS.winter.grass ), ultra, SEASONS.winter );
	material.userData.snowMap = snowMap;

	material.onBeforeCompile = ( shader ) => {

		shader.uniforms.uSnowMap = { value: snowMap };
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>' + SNOW_VERTEX.head )
			.replace( '#include <begin_vertex>', '#include <begin_vertex>' + SNOW_VERTEX.body );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', '#include <common>' + SNOW_FRAGMENT + '\nuniform sampler2D uSnowMap;' )
			.replace( '#include <map_fragment>', `#include <map_fragment>
				diffuseColor.rgb = mix( diffuseColor.rgb, texture2D( uSnowMap, vMapUv ).rgb, snowCover() );` );

	};

	material.customProgramCacheKey = () => 'dirt-snow';
	return material;

}

function dirtTexture( grassColor, ultra, sea ) {

	const greens = [ grassColor, grassColor.clone().offsetHSL( 0, 0, - 0.045 ), grassColor.clone().offsetHSL( 0, 0, 0.035 ) ].map( ( c ) => '#' + c.getHexString() );
	const texture = new THREE.CanvasTexture( paintDirt( greens, ultra ? 4 : 1, sea ) );
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.anisotropy = ultra ? 16 : 8;
	return texture;

}

// The colour of a texel of an image-backed texture (the Kenney colormap)
export function texelColor( texture, uv ) {

	const img = texture.image;
	const canvas = document.createElement( 'canvas' );
	canvas.width = img.width;
	canvas.height = img.height;
	const g = canvas.getContext( '2d' );
	g.drawImage( img, 0, 0 );
	const x = Math.min( img.width - 1, Math.floor( uv[ 0 ] * img.width ) );
	const y = Math.min( img.height - 1, Math.floor( ( texture.flipY ? 1 - uv[ 1 ] : uv[ 1 ] ) * img.height ) );
	const d = g.getImageData( x, y, 1, 1 ).data;
	return new THREE.Color().setRGB( d[ 0 ] / 255, d[ 1 ] / 255, d[ 2 ] / 255, THREE.SRGBColorSpace );

}

// ─── Start / finish gantry: two poles and a banner across the road ────

export function bannerTexture( text ) {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 512;
	canvas.height = 96;
	const g = canvas.getContext( '2d' );

	// Checkered ends, orange middle with the word
	g.fillStyle = '#e8590c';
	g.fillRect( 0, 0, 512, 96 );

	for ( let side = 0; side < 2; side ++ ) {

		for ( let i = 0; i < 4; i ++ ) for ( let j = 0; j < 3; j ++ ) {

			g.fillStyle = ( i + j ) % 2 ? '#1f2430' : '#ffffff';
			g.fillRect( side * 416 + i * 24, j * 32, 24, 32 );

		}

	}

	g.fillStyle = '#ffffff';
	g.font = 'italic 900 58px system-ui, sans-serif';
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.fillText( text, 256, 50 );
	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;

}

// A gantry across the road at path frame f (x, y, z, tx, tz), `text` on it
export function buildGantry( f, text ) {

	const group = new THREE.Group();
	const wood = new THREE.MeshStandardMaterial( { color: 0x6b4a2f, roughness: 1 } );
	const half = DIRT_HALF + 1.0;
	const height = 2.1;

	for ( const side of [ - 1, 1 ] ) {

		const pole = new THREE.Mesh( new THREE.BoxGeometry( 0.14, height + 0.35, 0.14 ), wood );
		pole.position.set( side * half, ( height + 0.35 ) / 2, 0 );
		pole.castShadow = true;
		group.add( pole );

	}

	const map = bannerTexture( text );
	const banner = new THREE.Mesh( new THREE.BoxGeometry( half * 2, 0.5, 0.04 ), [
		wood, wood, wood, wood,
		new THREE.MeshStandardMaterial( { map, roughness: 0.9 } ),
		new THREE.MeshStandardMaterial( { map, roughness: 0.9 } ),
	] );
	banner.position.y = height;
	banner.castShadow = true;
	group.add( banner );

	group.position.set( f.x, f.y + ROAD_Y, f.z );
	group.rotation.y = Math.atan2( f.tx, f.tz );
	return group;

}
