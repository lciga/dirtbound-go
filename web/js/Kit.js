import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Pieces of the Kenney "Racing Kit" (CC0, models/kit/): arches, flags,
// marquees, grandstands and pit buildings that fit together like bricks,
// trees, billboards, lights, cones and low barriers.
//
// Every piece is loaded once, baked into plain triangles re-based on its
// footprint (centred in x / z, standing on y = 0, facing +Z, raw kit units:
// one road tile = 1) and merged by whoever places it into one mesh per chunk
// (vertex colours; the three textured materials — checkers, billboard logo —
// in a mesh of their own). Kenney authored the colour factors in sRGB: they
// are read as such, so the reds and greens look like the kit's previews.

export const KIT_NAMES = [
	'overhead', 'overheadLights', 'overheadRound', 'overheadRoundColored',
	'flagCheckers', 'flagGreen', 'flagRed', 'flagTankco', 'bannerTowerGreen', 'bannerTowerRed',
	'tent', 'tentLong', 'tentClosed', 'tentClosedLong', 'tentRoof', 'tentRoofDouble',
	'grandStand', 'grandStandAwning', 'grandStandCovered',
	'pitsGarage', 'pitsGarageClosed', 'pitsOffice', 'pitsOfficeRoof',
	'treeLarge', 'treeSmall',
	'billboard', 'billboardLow', 'billboardDouble',
	'lightRedDouble', 'lightPost', 'lightPostLarge', 'lightPostModern',
	'pylon', 'barrierRed', 'barrierWhite', 'barrierWall',
	'camera', 'radarEquipment',
];

export const KIT_SCALE = 1.5; // kit units → m for props: a marquee ≈ 1 m high next to our 0.75 m spectators
export const BUILDING_SCALE = 2; // grandstands and pit buildings

// Arches across the road: `keep` = half-width (raw) at the centre that is not
// stretched (the start lights of overheadLights)
export const ARCHES = {
	overhead: { flat: true, keep: 0 },
	overheadLights: { flat: true, keep: 0.16 },
	overheadRound: { flat: false },
	overheadRoundColored: { flat: false },
};

const ARCH_SCALE = 3.6; // flat arches: posts and beam, beam bottom ≈ 1.9 m up
const ROUND_HEIGHT = 3.4; // m, crown of the round arches

export const KIT_MATERIAL = new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true } );
let clubPoster;
function billboardPoster(){
 // Kit front faces use v=-1 at the top and v=0 at the bottom.
 if(!clubPoster){clubPoster=new THREE.TextureLoader().load('images/club-billboard.jpg');clubPoster.colorSpace=THREE.SRGBColorSpace;clubPoster.flipY=false;clubPoster.repeat.set(2,1);clubPoster.offset.set(-.5,1);}
 return clubPoster;
}
const texturedMaterials = new Map(); // texture → material

function texturedMaterial( map ) {

	let m = texturedMaterials.get( map );
	if ( ! m ) texturedMaterials.set( map, m = new THREE.MeshStandardMaterial( { map, roughness: 0.9, metalness: 0, flatShading: true } ) );
	return m;

}

// ─── Loading ──────────────────────────────────────────────

// { name, size: Vector3 (raw), inner: half-width of the opening at the
// ground (arches), crown: lowest point of the span, parts: [ { position,
// uv, color, map } ] }
// recolor: { materialName: hex } replacing a material's colour
function bake( name, scene, recolor = {} ) {

	scene.updateMatrixWorld( true );
	const byMaterial = new Map();

	scene.traverse( ( o ) => {

		if ( ! o.isMesh ) return;

		const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
		g.applyMatrix4( o.matrixWorld );
		const source=o.material;
 const m=name.startsWith('billboard') && source.name==='tankco' ? {...source,map:billboardPoster()} : source;
		const key = m.name + ( m.map ? '#map' : '' );
		let part = byMaterial.get( key );

		if ( ! part ) {

			// Factor read as sRGB (Kenney's), white under a texture
			const color = m.map ? new THREE.Color( 1, 1, 1 )
				: recolor[ m.name ] !== undefined ? new THREE.Color( recolor[ m.name ] )
				: new THREE.Color().setRGB( m.color.r, m.color.g, m.color.b, THREE.SRGBColorSpace );
			part = { material: m.name, color, map: m.map || null, positions: [], uvs: [] };
			byMaterial.set( key, part );

		}

		part.positions.push( g.attributes.position.array );
		if ( m.map && g.attributes.uv ) part.uvs.push( g.attributes.uv.array );
		g.dispose();

	} );

	const parts = [ ...byMaterial.values() ].map( ( p ) => ( { material: p.material, color: p.color, map: p.map, position: concat( p.positions ), uv: p.map ? concat( p.uvs ) : null } ) );

	// Re-base: footprint centred, standing on y = 0
	const box = new THREE.Box3();
	const v = new THREE.Vector3();

	for ( const p of parts ) for ( let i = 0; i < p.position.length; i += 3 ) box.expandByPoint( v.fromArray( p.position, i ) );

	const cx = ( box.min.x + box.max.x ) / 2, cz = ( box.min.z + box.max.z ) / 2, y0 = box.min.y;

	for ( const p of parts ) {

		for ( let i = 0; i < p.position.length; i += 3 ) {

			p.position[ i ] -= cx;
			p.position[ i + 1 ] -= y0;
			p.position[ i + 2 ] -= cz;

		}

	}

	const size = box.getSize( new THREE.Vector3() );

	// Arches: the opening at the ground, and the underside of the span
	let inner = Infinity, crown = Infinity;

	for ( const p of parts ) {

		for ( let i = 0; i < p.position.length; i += 3 ) {

			const x = Math.abs( p.position[ i ] ), y = p.position[ i + 1 ];
			if ( y < size.y * 0.05 ) inner = Math.min( inner, x );

		}

	}

	for ( const p of parts ) for ( let i = 0; i < p.position.length; i += 3 ) if ( Math.abs( p.position[ i ] ) < inner * 0.3 ) crown = Math.min( crown, p.position[ i + 1 ] );

	// A beam drawn as one long box has vertices only at its ends: then the
	// underside is the lowest vertex in the upper half within the opening
	if ( crown === Infinity ) for ( const p of parts ) for ( let i = 0; i < p.position.length; i += 3 ) if ( Math.abs( p.position[ i ] ) <= inner + 1e-3 && p.position[ i + 1 ] > size.y * 0.5 ) crown = Math.min( crown, p.position[ i + 1 ] );

	return { name, size, inner, crown, parts };

}

function concat( arrays ) {

	let n = 0;
	for ( const a of arrays ) n += a.length;
	const out = new Float32Array( n );
	let o = 0;

	for ( const a of arrays ) {

		out.set( a, o );
		o += a.length;

	}

	return out;

}

// The pieces `names` of `dir`, or null if they could not be loaded (the game
// then simply goes without them)
async function loadPieces( loader, dir, names, recolor ) {

	try {

		const scenes = await Promise.all( names.map( ( n ) => loader.loadAsync( `${ dir }/${ n }.glb` ) ) );
		const pieces = {};
		names.forEach( ( n, i ) => { pieces[ n ] = bake( n, scenes[ i ].scene, recolor ); } );
		return pieces;

	} catch ( e ) {

		console.warn( dir + ' not loaded', e );
		return null;

	}

}

export function loadKit( loader = new GLTFLoader() ) {

	return loadPieces( loader, 'models/kit', KIT_NAMES );

}

// ─── Kenney Nature Kit (models/nature/, CC0) ─────────────────
// Its pines and fir trees join the forest; stumps, logs and (autumn)
// mushrooms lie under them, Ultra adds bushes and (spring) flowers; tents and campfires stand by the rally crowds.
// Its palette is teal: leaves and grass are baked in the game's greens (so
// the seasons recolour them like the rest, Seasons.js), stone in grey.

export const NATURE_TREES = [
	'tree_pineDefaultA', 'tree_pineDefaultB', 'tree_pineGroundA', 'tree_pineGroundB',
	'tree_pineRoundA', 'tree_pineRoundB', 'tree_pineRoundC', 'tree_pineRoundD', 'tree_pineRoundE', 'tree_pineRoundF',
	'tree_pineSmallA', 'tree_pineSmallB', 'tree_pineSmallC', 'tree_pineSmallD',
	'tree_pineTallA', 'tree_pineTallB', 'tree_pineTallC', 'tree_pineTallD',
	'tree_pineTallA_detailed', 'tree_pineTallB_detailed', 'tree_pineTallC_detailed', 'tree_pineTallD_detailed',
	'tree_cone', 'tree_cone_dark',
];
export const NATURE_BUSHES = [ 'plant_bush', 'plant_bushDetailed', 'plant_bushLarge', 'plant_bushLargeTriangle', 'plant_bushSmall', 'plant_bushTriangle' ];
export const NATURE_FLOWERS = [ 'flower_purpleA', 'flower_purpleB', 'flower_purpleC', 'flower_redA', 'flower_redB', 'flower_redC', 'flower_yellowA', 'flower_yellowB', 'flower_yellowC' ];
export const NATURE_STUMPS = [ 'stump_old', 'stump_oldTall', 'stump_round', 'stump_roundDetailed', 'stump_square', 'stump_squareDetailed', 'stump_squareDetailedWide' ];
export const NATURE_LOGS = [ 'log', 'log_large' ];
export const NATURE_MUSHROOMS = [ 'mushroom_red', 'mushroom_redGroup', 'mushroom_redTall', 'mushroom_tan', 'mushroom_tanGroup', 'mushroom_tanTall' ];
export const NATURE_TENTS = [ 'tent_detailedClosed', 'tent_detailedOpen', 'tent_smallClosed', 'tent_smallOpen' ];
export const NATURE_FIRES = [ 'campfire_stones', 'campfire_bricks' ];
const NATURE_NAMES = [ ...NATURE_TREES, ...NATURE_BUSHES, ...NATURE_FLOWERS, ...NATURE_STUMPS, ...NATURE_LOGS, ...NATURE_MUSHROOMS, ...NATURE_TENTS, ...NATURE_FIRES, 'campfire_logs' ];

export const NATURE_TREE_SCALE = 2.2; // raw → m: a pine 2–4.6 m, like the forest's 3–3.7 m
export const NATURE_SCALE = 2; // bushes, flowers, stumps, logs, campfires
export const NATURE_TENT_SCALE = 1.6; // a tent ≈ 0.9 m high next to 0.75 m spectators

const NATURE_COLORS = {
	leafsDark: 0x3e8a4c, leafsGreen: 0x4f9a4c, grass: 0x5e9a44, // game greens: the seasons tint them
	stone: 0x8f8c86,
};

export function loadNature( loader = new GLTFLoader() ) {

	return loadPieces( loader, 'models/nature', NATURE_NAMES, NATURE_COLORS );

}

// A piece as one vertex-coloured geometry (no textured parts), for an
// InstancedMesh; flat normals
export function pieceGeometry( tpl ) {

	const positions = [], colors = [];

	for ( const part of tpl.parts ) {

		if ( part.map ) continue;
		for ( let i = 0; i < part.position.length; i ++ ) positions.push( part.position[ i ] );
		for ( let i = 0; i < part.position.length; i += 3 ) colors.push( part.color.r, part.color.g, part.color.b );

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	g.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );
	flatNormals( g );
	g.computeBoundingSphere();
	return g;

}

// Flat normals of a non-indexed geometry, written straight into a typed
// array: three's computeVertexNormals took ~1 ms per 1000 vertices here
// (13 ms for a chunk's roadside), this a tenth of that
export function flatNormals( geometry ) {

	const p = geometry.attributes.position.array;
	const n = new Float32Array( p.length );

	for ( let i = 0; i < p.length; i += 9 ) {

		const ax = p[ i + 3 ] - p[ i ], ay = p[ i + 4 ] - p[ i + 1 ], az = p[ i + 5 ] - p[ i + 2 ];
		const bx = p[ i + 6 ] - p[ i ], by = p[ i + 7 ] - p[ i + 1 ], bz = p[ i + 8 ] - p[ i + 2 ];
		let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
		const l = Math.hypot( nx, ny, nz ) || 1;
		nx /= l; ny /= l; nz /= l;
		n[ i ] = n[ i + 3 ] = n[ i + 6 ] = nx;
		n[ i + 1 ] = n[ i + 4 ] = n[ i + 7 ] = ny;
		n[ i + 2 ] = n[ i + 5 ] = n[ i + 8 ] = nz;

	}

	geometry.setAttribute( 'normal', new THREE.BufferAttribute( n, 3 ) );

}

// ─── Merging ──────────────────────────────────────────────

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3( 0, 1, 0 );

// Appends a piece to `target` ({ positions, colors, textured: Map }) at
// (x, y, z) turned by `rot` about Y (its front, +Z, then faces
// (sin rot, cos rot)), scaled by `scale` (a number or [ sx, sy, sz ]).
// opts.recolor: { materialName: hex } ; opts.warp( v ): moves a raw vertex
// before the transform
export function kitAdd( target, tpl, x, y, z, rot, scale, opts = {} ) {

	if ( typeof scale === 'number' ) _s.setScalar( scale );
	else _s.fromArray( scale );
	_m.compose( _p.set( x, y, z ), _q.setFromAxisAngle( _up, rot ), _s );

	for ( const part of tpl.parts ) {

		const pos = part.position;
		let out, uvOut = null;

		if ( part.map ) {

			let t = target.textured.get( part.map );
			if ( ! t ) target.textured.set( part.map, t = { positions: [], uvs: [] } );
			out = t.positions;
			uvOut = t.uvs;
			for ( let i = 0; i < part.uv.length; i ++ ) uvOut.push( part.uv[ i ] );

		} else {

			out = target.positions;
			const hex = opts.recolor?.[ part.material ];
			if ( hex !== undefined ) _c.set( hex );
			else _c.copy( part.color );

			for ( let i = 0; i < pos.length; i += 3 ) target.colors.push( _c.r, _c.g, _c.b );

		}

		for ( let i = 0; i < pos.length; i += 3 ) {

			_v.fromArray( pos, i );
			if ( opts.warp ) opts.warp( _v );
			_v.applyMatrix4( _m );
			out.push( _v.x, _v.y, _v.z );

		}

	}

}

// The meshes of the textured parts gathered in target.textured
export function texturedMeshes( textured ) {

	const meshes = [];

	for ( const [ map, t ] of textured ) {

		if ( ! t.positions.length ) continue;
		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( t.positions, 3 ) );
		g.setAttribute( 'uv', new THREE.Float32BufferAttribute( t.uvs, 2 ) );
		flatNormals( g );
		g.computeBoundingSphere();
		const mesh = new THREE.Mesh( g, texturedMaterial( map ) );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		meshes.push( mesh );

	}

	return meshes;

}

// A standalone batch of pieces (circuit dressing, arches): one group with a
// vertex-coloured mesh and the textured ones
export class KitBatch {

	constructor() {

		this.positions = [];
		this.colors = [];
		this.textured = new Map();

	}

	add( tpl, x, y, z, rot, scale, opts ) {

		kitAdd( this, tpl, x, y, z, rot, scale, opts );

	}

	object() {

		const group = new THREE.Group();

		if ( this.positions.length ) {

			const g = new THREE.BufferGeometry();
			g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.positions, 3 ) );
			g.setAttribute( 'color', new THREE.Float32BufferAttribute( this.colors, 3 ) );
			flatNormals( g );
			g.computeBoundingSphere();
			const mesh = new THREE.Mesh( g, KIT_MATERIAL );
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add( mesh );

		}

		for ( const m of texturedMeshes( this.textured ) ) group.add( m );
		return group;

	}

}

// Box collider of a piece placed as in kitAdd ({ x, y, z, hx, hy, hz, rot },
// the convention of RallyStage.addBox); shrink: fraction of the footprint kept
export function kitBox( tpl, x, y, z, rot, scale, shrink = 1 ) {

	const [ sx, sy, sz ] = typeof scale === 'number' ? [ scale, scale, scale ] : scale;
	const hy = tpl.size.y * sy / 2;
	return { x, y: y + hy, z, hx: Math.max( 0.04, tpl.size.x * sx / 2 * shrink ), hy, hz: Math.max( 0.04, tpl.size.z * sz / 2 * shrink ), rot };

}

// ─── Arches ───────────────────────────────────────────────

// Adds arch `name` across a road to `target`, in a frame where the road runs
// along +Z through the origin, the opening `half` m to either side. Flat ones
// keep their posts and centre at ARCH_SCALE and stretch the beam between;
// round ones are scaled to fit (a lower, wider curve). Returns where a banner
// hangs ({ y, width }) and the posts' colliders (local frame).
export function addArch( target, kit, name, half ) {

	const tpl = kit[ name ];
	const spec = ARCHES[ name ];
	const inner = tpl.inner;

	if ( spec.flat ) {

		const s = ARCH_SCALE, keep = spec.keep;

		// Raw x → final x: centre kept, span stretched, posts kept
		const warp = ( v ) => {

			const a = Math.abs( v.x ), sign = Math.sign( v.x );
			if ( a <= keep ) v.x *= s;
			else if ( a <= inner ) v.x = sign * ( keep * s + ( a - keep ) / ( inner - keep ) * ( half - keep * s ) );
			else v.x = sign * ( half + ( a - inner ) * s );

		};

		kitAdd( target, tpl, 0, 0, 0, 0, [ 1, s, s ], { warp } );

		const post = ( tpl.size.x / 2 - inner ) * s;
		const height = tpl.size.y * s;
		const colliders = [ - 1, 1 ].map( ( side ) => ( { x: side * ( half + post / 2 ), y: height / 2, z: 0, hx: post / 2, hy: height / 2, hz: tpl.size.z * s / 2 } ) );
		return { y: tpl.crown * s - 0.3, width: Math.min( half * 1.7, half * 2 - 0.6 ), colliders };

	}

	const sx = half / inner, sy = ROUND_HEIGHT / tpl.size.y, sz = ARCH_SCALE * 0.8;
	kitAdd( target, tpl, 0, 0, 0, 0, [ sx, sy, sz ] );

	const foot = ( tpl.size.x / 2 - inner ) * sx;
	const colliders = [ - 1, 1 ].map( ( side ) => ( { x: side * ( half + foot / 2 ), y: 0.6, z: 0, hx: foot / 2, hy: 0.6, hz: tpl.size.z * sz / 2 } ) );
	const y = tpl.crown * sy * 0.62;
	return { y, width: half * 2 * Math.sqrt( 1 - 0.75 * 0.75 ) * 0.95, colliders };

}

// A whole arch as an object at road frame f ({ x, y, z, tx, tz }, y = road
// surface), with an optional banner (texture); colliders in world space
export function buildArch( kit, name, f, half, banner = null ) {

	const batch = new KitBatch();
	const hang = addArch( batch, kit, name, half );
	const group = batch.object();

	if ( banner ) {

		const face = new THREE.MeshStandardMaterial( { map: banner, roughness: 0.9 } );
		const edge = new THREE.MeshStandardMaterial( { color: 0x1f2430, roughness: 1 } );
		const mesh = new THREE.Mesh( new THREE.BoxGeometry( hang.width, 0.5, 0.04 ), [ edge, edge, edge, edge, face, face ] );
		mesh.position.y = hang.y;
		mesh.castShadow = true;
		group.add( mesh );

	}

	const rot = Math.atan2( f.tx, f.tz );
	group.position.set( f.x, f.y, f.z );
	group.rotation.y = rot;

	const c = Math.cos( rot ), s = Math.sin( rot );
	const colliders = hang.colliders.map( ( b ) => ( { x: f.x + b.x * c + b.z * s, y: f.y + b.y, z: f.z - b.x * s + b.z * c, hx: b.hx, hy: b.hy, hz: b.hz, rot } ) );
	return { group, colliders };

}
