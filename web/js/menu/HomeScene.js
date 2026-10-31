import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { TrackPath, ROAD_Y, TRACK_SCALE, GRASS_UV, extractTileGeometry } from '../SplineTrack.js';
import { buildDirtRoadGeometry, createDirtMaterial, buildGantry, DIRT_HALF } from '../DirtRoad.js';
import { KitBatch, KIT_SCALE, BUILDING_SCALE, NATURE_TREE_SCALE, NATURE_SCALE, NATURE_TENT_SCALE, KIT_NAMES } from '../Kit.js';
import { Roadside } from '../Roadside.js';
import { extractProps } from '../Props.js';
import { season, seasonMaterial } from '../Seasons.js';

// The home screen's place: one rally corner and what stands around it, all
// from data (config/home.js, made by eye in lab/home.html, which draws it
// with this same module). Positions in metres, y up, the road starting at the
// origin heading +Z.
//
// data = {
//   road: { before, radius, angle (°, > 0 turns right), after, width },
//   season, car: { x, z, rot }, camera: { pos, target, fov },
//   props: [ { type, name, seed, x, y, z, rot, scale } ]
// }

export const GROUND_Y = ROAD_Y - 0.08; // the grass, a hair under the dirt's verge
const GROUND_SIZE = 140; // m
const GROUND_STEP = 2; // m: small triangles (they fold one by one)
const ARC_STEP = THREE.MathUtils.degToRad( 30 ); // a node every 30° of the bend

// ─── The road ──────────────────────────────────────────────

export function cornerNodes( { before = 18, radius = 14, angle = 90, after = 18 } ) {

	const nodes = [ { x: 0, z: 0, a: 0, y: 0 }, { x: 0, z: before, a: 0, y: 0 } ];
	const sign = Math.sign( angle ) || 1;
	const total = THREE.MathUtils.degToRad( Math.abs( angle ) );
	const steps = Math.max( 1, Math.ceil( total / ARC_STEP ) );

	// Centre on the inside of the bend; heading a ↦ ( sin a, cos a )
	for ( let k = 1; k <= steps; k ++ ) {

		const t = total * k / steps;
		nodes.push( { x: sign * radius * ( 1 - Math.cos( t ) ), z: before + radius * Math.sin( t ), a: sign * t, y: 0 } );

	}

	const end = nodes[ nodes.length - 1 ];
	if ( after > 0 ) nodes.push( { x: end.x + Math.sin( end.a ) * after, z: end.z + Math.cos( end.a ) * after, a: end.a, y: 0 } );
	return nodes;

}

export function buildRoad( road, seasonId = 'summer', ultra = false ) {

	const path = new TrackPath( cornerNodes( road ), false );
	const width = road.width ?? 1;
	const geometry = buildDirtRoadGeometry( path, 0, 1, 0, 0, null, () => width );
	const mesh = new THREE.Mesh( geometry, createDirtMaterial( new THREE.Color( season( seasonId ).grass ), ultra, seasonId ) );
	mesh.receiveShadow = true;
	mesh.name = 'road';
	mesh.userData.path = path;
	return mesh;

}

// ─── The ground ────────────────────────────────────────────

// The grass of the colormap (the terrain's own texel), in the season's colour
export function buildGround( models, seasonId = 'summer' ) {

	const { material } = extractTileGeometry( models[ 'track-straight' ] );
	const geometry = new THREE.PlaneGeometry( GROUND_SIZE, GROUND_SIZE, GROUND_SIZE / GROUND_STEP, GROUND_SIZE / GROUND_STEP ).rotateX( - Math.PI / 2 ).toNonIndexed();
	const uv = geometry.attributes.uv;
	for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, GRASS_UV[ 0 ], GRASS_UV[ 1 ] );
	const mesh = new THREE.Mesh( geometry, seasonMaterial( material, seasonId ) );
	mesh.position.set( 0, GROUND_Y, 20 );
	mesh.receiveShadow = true;
	mesh.name = 'ground';
	return mesh;

}

// ─── The props ─────────────────────────────────────────────

const BUILDINGS = /^(grandStand|pits)/;
const NATURE_GROUPS = [
	[ 'Sapins', /^tree_/ ], [ 'Buissons', /^plant_/ ], [ 'Fleurs', /^flower_/ ], [ 'Souches, troncs', /^(stump_|log)/ ],
	[ 'Champignons', /^mushroom_/ ], [ 'Tentes, feux', /^(tent_|campfire_)/ ],
];

// What can be placed: { id, type, name, label, group }
export function catalogue( { kit, nature, trees } ) {

	const list = [];
	const add = ( type, name, label, group ) => list.push( { id: type + ':' + name, type, name, label, group } );

	for ( const [ name, label ] of ROADSIDE ) add( 'roadside', name, label, 'Bord de spéciale' );
	add( 'gantry', 'DÉPART', 'Arche en bois DÉPART', 'Bord de spéciale' );
	add( 'gantry', 'ARRIVÉE', 'Arche en bois ARRIVÉE', 'Bord de spéciale' );
	for ( let i = 0; i < ( trees?.length || 0 ); i ++ ) add( 'tree', String( i ), `Arbre ${ i + 1 }`, 'Arbres de la forêt' );
	if ( nature ) for ( const name of Object.keys( nature ) ) {

		const group = NATURE_GROUPS.find( ( [ , re ] ) => re.test( name ) );
		add( 'nature', name, name.replace( /_/g, ' ' ), 'Nature : ' + ( group ? group[ 0 ] : 'divers' ) );

	}

	if ( kit ) for ( const name of KIT_NAMES ) if ( kit[ name ] ) add( 'kit', name, name, 'Kit course' );
	return list;

}

// The roadside items a stage dresses itself with (Roadside.js), one at a time
const ROADSIDE = [
	[ 'spectator', 'Spectateur' ], [ 'crowd', 'Groupe de 5 spectateurs' ], [ 'bales', 'Bottes de paille (3)' ],
	[ 'post', 'Poteau rouge et blanc' ], [ 'fence', 'Barrière en bois (6 m)' ], [ 'fenceBanner', 'Barrière avec banderoles (6 m)' ],
	[ 'tape', 'Rubalise (6 m)' ], [ 'marquee', 'Barnum' ], [ 'flag', 'Mât à banderole' ], [ 'boulder', 'Rocher' ], [ 'bush', 'Buisson' ],
];

function mulberry( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6d2b79f5 ) >>> 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// A Roadside on flat ground at y = 0, no road around (items built at the origin)
export function flatRoadside( seasonId = 'summer', ultra = false, kit = null, nature = null ) {

	const r = new Roadside( 1, { snowAt: () => 0 }, { widthAt: () => 1 }, ultra, seasonId, kit, nature );
	r.groundY = () => 0;
	r.footY = () => 0;
	r.seasonAt = () => r.season;
	r.half = () => 0;
	return r;

}

function roadsideItems( roadside, name, rand ) {

	const items = [];
	const f = { x: 0, z: 0, tx: 1, tz: 0 }; // the road along +X: people face +Z
	const line = ( len ) => ( s, out ) => s >= - 1e-6 && s <= len + 1e-6 && Object.assign( out, { x: s - len / 2, z: 0, tx: 1, tz: 0 } );

	if ( name === 'spectator' ) roadside.spectator( items, { x: 0, z: 0 }, f, 1, rand );
	else if ( name === 'crowd' ) for ( let i = 0; i < 5; i ++ ) roadside.spectator( items, { x: ( i - 2 ) * 0.42 + ( rand() - 0.5 ) * 0.15, z: ( rand() - 0.5 ) * 0.35 }, f, 1, rand );
	else if ( name === 'bales' ) roadside.bales( items, f, 0, 1, rand );
	else if ( name === 'post' ) items.push( roadside.post( f, 0, 0 ) );
	else if ( name === 'fence' ) roadside.fence( items, line( 6.4 ), 0, 6.4, 1, 0, rand, 0 );
	else if ( name === 'fenceBanner' ) roadside.fence( items, line( 6.4 ), 0, 6.4, 1, 0, rand, 1 );
	else if ( name === 'tape' ) {

		// tape() reads the road's edge: its own straight line here
		const half = roadside.half;
		roadside.half = () => - 0.7;
		roadside.tape( items, line( 6 ), 0, 1, 0, rand );
		roadside.half = half;

	} else if ( name === 'marquee' ) roadside.marquee( items, { x: 0, z: 0 }, f, rand );
	else if ( name === 'flag' ) roadside.flag( items, { x: 0, z: 0 }, f, rand );
	else if ( name === 'boulder' ) items.push( roadside.boulder( { x: 0, z: 0 }, rand ) );
	else if ( name === 'bush' ) items.push( roadside.bush( { x: 0, z: 0 }, rand ) );
	return items;

}

// ctx = { kit, nature, trees, treeMaterial, natureMaterial, roadside, ultra }
// → an Object3D at its place
export function buildProp( ctx, spec ) {

	let object;
	const rand = mulberry( spec.seed ?? 1 );

	if ( spec.type === 'kit' || spec.type === 'nature' ) {

		const tpl = ( spec.type === 'kit' ? ctx.kit : ctx.nature )?.[ spec.name ];
		if ( ! tpl ) return null;
		const base = spec.type === 'kit'
			? ( BUILDINGS.test( spec.name ) ? BUILDING_SCALE : KIT_SCALE )
			: /^tree_/.test( spec.name ) ? NATURE_TREE_SCALE : /^tent_/.test( spec.name ) ? NATURE_TENT_SCALE : NATURE_SCALE;
		const batch = new KitBatch();
		batch.add( tpl, 0, 0, 0, 0, base );
		object = batch.object();
		if ( spec.type === 'nature' && ctx.natureMaterial ) object.traverse( ( o ) => { if ( o.isMesh && o.geometry.attributes.color ) o.material = ctx.natureMaterial; } );
		// The kit's greens (its big trees, hedges) in the season's colours too
		if ( spec.type === 'kit' && ctx.kitMaterials ) object.traverse( ( o ) => { if ( o.isMesh && ! Array.isArray( o.material ) ) o.material = ctx.kitMaterial( o.material ); } );

	} else if ( spec.type === 'tree' ) {

		const geometry = ctx.trees?.[ Number( spec.name ) ];
		if ( ! geometry ) return null;
		object = new THREE.Mesh( geometry, ctx.treeMaterial );
		object.scale.setScalar( TRACK_SCALE );
		const wrap = new THREE.Group();
		wrap.add( object );
		object = wrap;

	} else if ( spec.type === 'roadside' ) {

		const items = roadsideItems( ctx.roadside, spec.name, rand );
		if ( ! items.length ) return null;
		object = new THREE.Group();
		object.add( ctx.roadside.build( items ) );

	} else if ( spec.type === 'gantry' ) {

		object = buildGantry( { x: 0, y: - ROAD_Y, z: 0, tx: 0, tz: 1 }, spec.name );
		const wrap = new THREE.Group();
		wrap.add( object );
		object = wrap;

	} else return null;

	object.traverse( ( o ) => { if ( o.isMesh ) o.castShadow = o.receiveShadow = true; } );
	object.position.set( spec.x, spec.y ?? GROUND_Y, spec.z );
	object.rotation.y = spec.rot || 0;
	object.scale.multiplyScalar( spec.scale || 1 );
	object.userData.spec = spec;
	return object;

}

// What buildProp needs, from the loaded models (decoration tiles, kits)
export function propContext( models, { seasonId = 'summer', ultra = false } = {} ) {

	const { trees, material } = extractProps( models );
	const natureBase = new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true } );
	return {
		kit: models.kit || null,
		nature: models.nature || null,
		trees,
		// Each tree its own colour in the season's palette, as on the stages
		treeMaterial: seasonMaterial( material, seasonId, { perObject: true } ),
		natureMaterial: seasonMaterial( natureBase, seasonId, { perObject: true } ),
		roadside: flatRoadside( seasonId, ultra, models.kit || null, models.nature || null ),
		// One season clone per kit material (buildProp)
		kitMaterials: new Map(),
		kitMaterial( m ) {

			if ( ! this.kitMaterials.has( m ) ) this.kitMaterials.set( m, seasonMaterial( m, seasonId, { perObject: true } ) );
			return this.kitMaterials.get( m );

		},
		ultra,
	};

}

// The whole place: road, ground and props in one group
export function buildHome( data, models, { ultra = false } = {} ) {

	const seasonId = data.season || 'summer';
	const group = new THREE.Group();
	const ground = buildGround( models, seasonId ), road = buildRoad( data.road, seasonId, ultra );
	ground.userData.floor = road.userData.floor = true; // placeLogo stands the letters on them
	group.add( ground, road );
	const ctx = propContext( models, { seasonId, ultra } );
	for ( const spec of data.props || [] ) {

		const o = buildProp( ctx, spec );
		if ( o ) {

			o.userData.prop = true; // placeLogo hides those in its letters
			group.add( o );

		}

	}

	return group;

}

// ─── The logo ──────────────────────────────────────────────
// DIRTBOUND in big white letters standing right behind the car, Brand
// extruded (fonts/brand-logo.typeface.json: just those letters, made by
// tools/typeface.mjs). data.logo: { height (m, of the letters), depth (m),
// gap (m between the car's far side and the letters) }; it faces the camera.

export const LOGO = { height: 0.8, depth: 0.4, gap: 0.08 };
const LOGO_FONT = 'fonts/brand-logo.typeface.json';

// The bevelled glyphs have zero-area triangles (normal 0, 0, 0). Once
// projected, rounding sometimes gives one a pixel: normalize( 0 ) = NaN in the
// shader, which the bloom spread into black blocks flickering over the menu
// (Normal: no Ultra shafts pass to stop it). Drops them from the non-indexed
// geometry; groups go too (the logo has one material)
function dropDegenerate( geometry ) {

	const normal = geometry.attributes.normal;
	const keep = [];
	for ( let i = 0; i < normal.count; i += 3 ) {

		if ( normal.getX( i ) !== 0 || normal.getY( i ) !== 0 || normal.getZ( i ) !== 0 ) keep.push( i );

	}

	if ( keep.length * 3 === normal.count ) return;

	for ( const name of Object.keys( geometry.attributes ) ) {

		const attribute = geometry.attributes[ name ], size = attribute.itemSize;
		const array = new attribute.array.constructor( keep.length * 3 * size );
		keep.forEach( ( first, t ) => array.set( attribute.array.subarray( first * size, ( first + 3 ) * size ), t * 3 * size ) );
		geometry.setAttribute( name, new THREE.BufferAttribute( array, size, attribute.normalized ) );

	}

	geometry.clearGroups();

}

// A group of one mesh per letter (LogoPhysics shakes them one by one), each
// with its origin at the middle of its foot; userData: letters, box (the
// word's, in the group's frame), gaps (m between a letter's top and the next's)
export async function buildLogo( spec = LOGO ) {

	const font = new FontLoader().parse( await ( await fetch( LOGO_FONT ) ).json() );
	const text = 'DIRTBOUND';
	const options = { font, size: 1, depth: 1, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 };

	// Laid out like TextGeometry would: each glyph at the sum of the advances before it
	let x = 0;
	const parts = [ ...text ].map( ( ch ) => {

		const geometry = new TextGeometry( ch, options );
		geometry.computeBoundingBox();
		const part = { geometry, x };
		x += font.data.glyphs[ ch ].ha / font.data.resolution * options.size;
		return part;

	} );

	const word = new THREE.Box3();
	for ( const { geometry, x: at } of parts ) word.union( geometry.boundingBox.clone().translate( new THREE.Vector3( at, 0, 0 ) ) );
	const k = spec.height / ( word.max.y - word.min.y );
	const kz = spec.depth / ( word.max.z - word.min.z );
	const middle = ( word.min.x + word.max.x ) / 2, zMiddle = ( word.min.z + word.max.z ) / 2;

	const material = new THREE.MeshStandardMaterial( { color: 0xf5f5f2, roughness: 0.55, metalness: 0 } );
	const logo = new THREE.Group();
	logo.name = 'logo';
	const letters = parts.map( ( { geometry, x: at }, i ) => {

		const box = geometry.boundingBox;
		const cx = ( box.min.x + box.max.x ) / 2;
		geometry.translate( - cx, - word.min.y, - zMiddle );
		geometry.scale( k, k, kz );
		geometry.computeVertexNormals();
		dropDegenerate( geometry );
		geometry.computeBoundingBox();
		const mesh = new THREE.Mesh( geometry, material );
		mesh.name = `logo-${ text[ i ] }`;
		mesh.castShadow = mesh.receiveShadow = true;
		mesh.position.set( ( at + cx - middle ) * k, 0, 0 );
		logo.add( mesh );
		return mesh;

	} );

	logo.userData.letters = letters;
	logo.userData.box = new THREE.Box3().setFromObject( logo );
	logo.userData.gaps = letters.slice( 0, - 1 ).map( ( m, i ) => ( letters[ i + 1 ].position.x + letters[ i + 1 ].geometry.boundingBox.min.x ) - ( m.position.x + m.geometry.boundingBox.max.x ) );
	return logo;

}

// Stands the logo just behind the car as the camera sees it (its far side +
// gap, whatever the car's size), facing the camera
const _box = new THREE.Box3();
const _p = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const DOWN = new THREE.Vector3( 0, - 1, 0 );

// worlds: the home's built worlds (buildHome; one per season): the letters
// stand on the highest point of the ground and road under them, never sunk
// into the dirt; the props going through the letters are hidden, those of a
// former place shown again
export function placeLogo( logo, data, car, spec = LOGO, worlds = [] ) {

	const at = new THREE.Vector2( data.car.x, data.car.z );
	const view = at.clone().sub( new THREE.Vector2( data.camera.pos[ 0 ], data.camera.pos[ 2 ] ) ).normalize();

	// How far the car reaches behind its middle, along the view
	let reach = 2.2;
	if ( car ) {

		car.updateMatrixWorld( true );
		_box.setFromObject( car );
		if ( ! _box.isEmpty() ) {

			reach = 0;
			for ( let i = 0; i < 8; i ++ ) {

				_p.set( i & 1 ? _box.max.x : _box.min.x, 0, i & 2 ? _box.max.z : _box.min.z );
				reach = Math.max( reach, ( _p.x - at.x ) * view.x + ( _p.z - at.y ) * view.y );

			}

		}

	}

	at.addScaledVector( view, reach + spec.gap + spec.depth / 2 );
	logo.position.set( at.x, GROUND_Y, at.y );
	logo.rotation.y = Math.atan2( - view.x, - view.y ); // its front (+z) towards the camera

	// The floor under its foot: across the word, front and back
	const floors = [];
	worlds[ 0 ]?.traverse( ( o ) => { if ( o.userData.floor ) o.traverse( ( m ) => { if ( m.isMesh ) floors.push( m ); } ); } );
	if ( floors.length ) {

		worlds[ 0 ].updateMatrixWorld( true );
		const { min, max } = logo.userData.box;
		logo.updateMatrixWorld( true );
		let top = - Infinity;
		for ( let i = 0; i <= 12; i ++ ) for ( const z of [ min.z, max.z ] ) {

			_p.set( min.x + ( max.x - min.x ) * i / 12, 0, z ).applyMatrix4( logo.matrixWorld );
			_ray.set( _p.setY( 20 ), DOWN );
			const hit = _ray.intersectObjects( floors, false )[ 0 ];
			if ( hit ) top = Math.max( top, hit.point.y );

		}

		if ( top > - Infinity ) logo.position.y = top - 0.01;

	}

	// The props whose box meets the letters' (in the letters' frame)
	logo.updateMatrixWorld( true );
	const letters = logo.userData.box.clone().expandByScalar( 0.03 );
	const inverse = logo.matrixWorld.clone().invert();
	for ( const o of worlds.flatMap( ( w ) => w.children ) ) {

		if ( ! o.userData.prop ) continue;
		_box.setFromObject( o ).applyMatrix4( inverse );
		o.visible = ! _box.intersectsBox( letters );

	}

}

export { DIRT_HALF };
