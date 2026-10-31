import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createUltraEffects, createDofPass, setDof, setFocus } from '../Ultra.js';
import { ColorMapGLTFLoader } from '../Loader.js';
import { loadCar, CARS } from '../Cars.js';
import { extractProps } from '../Props.js';
import { TRACK_SCALE, ROAD_Y, GRASS_UV } from '../SplineTrack.js';
import { applyAtmosphere, setFogRange, MENU_ATMOSPHERE } from '../Atmosphere.js';
import { BEAT } from './MenuMusic.js';
import { loadKit, loadNature } from '../Kit.js';
import { SLOWMO } from './MenuDrive.js';
import { HomeSet, GarageSet, DriveSet, REST, FLOOR } from './Sets.js';
import { foldChannel, foldify, foldMaterial, FoldWave, FOLD_OUT, FOLD_IN, FOLD_IDLE, FOLD_GONE } from './Fold.js';
import { cubicBezier } from './Ease.js';
import { Walls } from './Walls.js';
import { PaintFlow, preparePaint } from './PaintFlow.js';

// Menu backdrop: the selected car, the only thing that stays while the menu
// goes from place to place (Sets.js: home at the start of a rally stage, the
// white garage, the stage raced down in Solo and multiplayer). A change of
// place folds the scene away triangle by triangle from under the car, then
// unfolds the next one (Fold.js); the camera eases from where it was to the
// next place's rest pose, written in the car's frame, so the car never moves
// on screen. The home screen's choices are titles in the scene (Walls.js).
//
// While racing (Solo, multiplayer) the car is filmed like a car ad: a
// shuffled edit of short shots, each one camera move (low dolly, tracking,
// crane, wheel close-up, orbit, top shot) at constant speed, cut into the next,
// with a touch of handheld shake. setViewOffset keeps the car in the part of
// the screen the menu panels leave free.
//
// With a clock (setClock: the menu music), shots last a number of beats and
// cut exactly on the bar grid — twice as long in calm passages — and onCut()
// fires on every cut. The outgoing shot keeps moving for transitionTime and
// each of its frames goes to onFrame() (the menu wipes it away with a mask).

const ROAD = ROAD_Y;
const CAMERA_CLEARANCE = 0.05; // m: may skim the ground, never go under it (near plane is closer)
const LIFT_AHEAD = 1.2; // s the camera looks ahead for relief
const LIFT_STEPS = 4;
const LIFT_UP = 3.5, LIFT_DOWN = 0.8; // 1/s: crane up briskly, settle back slowly
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _l = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const LIGHTS_GLOW = 6; // emissive intensity of the car lights: the white headlights bloom, the rest just glows
const BLOOM = { strength: 0.35, radius: 0.35, threshold: 3.5 };
const WHEEL = [ 0.32, ROAD_Y + 0.13, 0.45 ]; // front left wheel (car scale 0.5, +Z forward)

// A change of place: fold out, a breath of nothing, fold in (s)
const FOLD_OUT_TIME = 1.5, EMPTY_TIME = 0.12, FOLD_IN_TIME = 1.5;
const WAVE_REACH = 30; // m: a place change's wave goes no further (the fog hides the rest; further, it would rush through what shows)

const mix = ( a, b, t ) => a.map( ( v, i ) => v + ( b[ i ] - v ) * t );

// The camera between two places (poses in the car's frame): not a straight
// line but a swing around the car (its angle, distance and height eased apart),
// rising and backing off a little mid-way, slow to leave and to land
const ARC_LIFT = 0.55, ARC_OUT = 0.35; // m above and further out at mid-way, for a short move (more for a long swing)

const SLIDE_EASE = cubicBezier( 0.67, - 0.33, 0.26, 1.38 ); // walls swapping items: a dip, a rush, an overshoot
const SLIDE_LIFT = 2.2; // m the items travel: off the screen at the walls' depth
const SLIDE_FROM = 0.95; // m below where the new ones start: just off the screen (they stand low on it)
const SLIDE_SKIP = 0.275; // where SLIDE_EASE is back at 0 after its wind-up
const SLIDE_GONE = 0.8; // share of the way out where they are off the screen: the new ones come then
const SLIDE_OUT = 0.55, SLIDE_IN = 0.52; // s (in: the curve without its wind-up)
export const SLIDE = { ease: SLIDE_EASE, skip: SLIDE_SKIP, gone: SLIDE_GONE, out: SLIDE_OUT, in: SLIDE_IN }; // the menu slides its own panels the same way
const TRAVEL_EASE = cubicBezier( 0.66, 0, 0.58, 1 ); // the travelling's pace: slow away, fast through, settling in
const LAND_AT = 0.9; // share of the travelling done when the next screen's UI comes in
const TRAVEL_SHARE = 2 / 3; // of the place change the travelling takes (from the click; then the camera waits at the new place)

function travelling( a, b, t ) {

	const e = TRAVEL_EASE( Math.min( 1, Math.max( 0, t ) ) );
	const look = mix( a.look, b.look, e );
	// Around the point looked at: angle / radius / height, each eased on its own
	const ra = [ a.pos[ 0 ] - a.look[ 0 ], a.pos[ 2 ] - a.look[ 2 ] ], rb = [ b.pos[ 0 ] - b.look[ 0 ], b.pos[ 2 ] - b.look[ 2 ] ];
	const angA = Math.atan2( ra[ 0 ], ra[ 1 ] );
	let turn = Math.atan2( rb[ 0 ], rb[ 1 ] ) - angA;
	turn = Math.atan2( Math.sin( turn ), Math.cos( turn ) ); // the short way round
	const distA = Math.hypot( ra[ 0 ], ra[ 1 ] ), distB = Math.hypot( rb[ 0 ], rb[ 1 ] );
	const swing = Math.min( 1, Math.abs( turn ) / 1.2 ) + 0.4; // a bigger turn swings wider
	const bump = Math.sin( Math.PI * e );
	const angle = angA + turn * e;
	const dist = distA + ( distB - distA ) * e + bump * ARC_OUT * swing;
	const y = a.pos[ 1 ] + ( b.pos[ 1 ] - a.pos[ 1 ] ) * e + bump * ARC_LIFT * swing;
	return {
		pos: [ look[ 0 ] + Math.sin( angle ) * dist, y, look[ 2 ] + Math.cos( angle ) * dist ],
		look,
		fov: a.fov + ( b.fov - a.fov ) * e,
	};

}
const smooth = ( a, b, t ) => {

	const x = THREE.MathUtils.clamp( ( t - a ) / ( b - a ), 0, 1 );
	return x * x * ( 3 - 2 * x );

};

// Each shot: length in beats (4 = one bar) and, for t in 0..1 (linear), camera
// position, look-at point and fov.
// Kept close to the car: the menu fog can be thick.
const SHOTS = [

	// Low dolly in on the front three-quarter
	{ name: 'front-low', beats: 8, at: ( t ) => ( { pos: mix( [ - 2.2, ROAD + 0.28, 3.6 ], [ - 1.25, ROAD + 0.3, 2.3 ], t ), look: [ 0, ROAD + 0.3, 0.35 ], fov: 32 - 4 * t } ) },

	// Tracking along the side, the car sliding through the frame
	{ name: 'side-track', beats: 8, at: ( t ) => ( { pos: [ 2.4, ROAD + 0.5, - 2.2 + 4.4 * t ], look: [ 0, ROAD + 0.35, - 0.6 + 1.2 * t ], fov: 30 } ) },

	// Crane rising behind the car
	{ name: 'crane', beats: 8, at: ( t ) => ( { pos: mix( [ - 1.4, ROAD + 0.45, - 2.6 ], [ - 2.3, ROAD + 3.6, - 3.2 ], t ), look: [ 0, ROAD + 0.3, 0.2 ], fov: 34 + 4 * t } ) },

	// Wheel close-up, slow slide towards the front
	{ name: 'wheel', beats: 4, at: ( t ) => ( { pos: mix( [ 1.35, ROAD + 0.2, 1.5 ], [ 1.15, ROAD + 0.24, 0.25 ], t ), look: mix( WHEEL, [ WHEEL[ 0 ], WHEEL[ 1 ], WHEEL[ 2 ] + 0.25 ], t ), fov: 24 } ) },

	// Rear three-quarter orbit
	{ name: 'rear-orbit', beats: 8, at: ( t ) => { const a = 2.3 + 1.1 * t; return { pos: [ Math.sin( a ) * 3.1, ROAD + 0.95, Math.cos( a ) * 3.1 ], look: [ 0, ROAD + 0.3, 0 ], fov: 30 }; } },

	// Top shot slowly turning
	{ name: 'top', beats: 4, at: ( t ) => { const a = 0.4 + 0.9 * t; return { pos: [ Math.sin( a ) * 1.1, ROAD + 3.8, Math.cos( a ) * 1.1 ], look: [ 0, ROAD, 0 ], fov: 40 }; } },

	// Hero shot: straight in front, rising from the ground
	{ name: 'hero', beats: 8, at: ( t ) => ( { pos: mix( [ 0.05, ROAD + 0.14, 3.1 ], [ 0.05, ROAD + 0.75, 2.4 ], t ), look: [ 0, ROAD + 0.3, 0 ], fov: 28 } ) },

];

// A car change: the old one shrinks away, then the new one grows in (s)
const SHRINK_TIME = 0.32, GROW_TIME = 0.45;

// A car at a share of its own size (never quite 0: a flat matrix has no inverse for the normals)
function scaleCar( model, k ) {

	model.scale.setScalar( ( model.userData.baseScale ?? 0.5 ) * Math.max( 1e-3, k ) );

}

// The rest pose as a shot: where the edit starts from once a racing set is unfolded
const SWAY = [ 0.22, 0.1 ]; // m the home camera leans at the screen's edges (across, up / down)
const SWAY_SMOOTH = 3; // 1/s: how fast it follows the mouse
const REST_SHOT = { name: 'rest', beats: 4, at: () => REST };

// What a place's light is made of, to blend one into the next
function lightState( { scene, renderer, sun, ambient, camera, bloom } ) {

	return {
		bloom: bloom.strength,
		background: scene.background.clone(),
		fog: scene.fog ? [ scene.fog.color.clone(), scene.fog.near, scene.fog.far ] : null,
		exposure: renderer.toneMappingExposure,
		sun: [ sun.color.clone(), sun.intensity ],
		ambient: [ ambient.color.clone(), ambient.groundColor.clone(), ambient.intensity ],
		far: camera.far,
	};

}

export class Showroom {

	// options.cinematic: false keeps a slow orbit (lab/atmo.html, to judge light)
	constructor( container, { cinematic = true } = {} ) {

		this.cinematic = cinematic;

		this.renderer = new THREE.WebGLRenderer( { antialias: true, outputBufferType: THREE.HalfFloatType } );
		this.renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
		this.renderer.shadowMap.enabled = true;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		container.appendChild( this.renderer.domElement );

		this.scene = new THREE.Scene();
		const sun = new THREE.DirectionalLight();
		sun.position.set( 11.4, 15, - 5.3 );
		sun.castShadow = true;
		sun.shadow.mapSize.setScalar( 2048 );
		sun.shadow.radius = 4;
		Object.assign( sun.shadow.camera, { left: - 8, right: 8, top: 8, bottom: - 8, near: 1, far: 40 } );
		this.scene.add( sun, sun.target );
		this.sun = sun;
		this.sunOffset = sun.position.clone(); // kept relative to the car (shadows follow it)
		const ambient = new THREE.HemisphereLight();
		this.scene.add( ambient );
		this.ambient = ambient;
		this.seasonId = 'summer';

		// The menu's mood: config/atmosphere.js (USE.menu)
		applyAtmosphere( { scene: this.scene, renderer: this.renderer, sun, ambient }, {}, MENU_ATMOSPHERE );
		setFogRange( this.scene, 18, 42, MENU_ATMOSPHERE );

		// Bloom on the car lights only: the threshold sits above anything the sun
		// lights (HDR, before tone mapping), only the emissive lights pass it
		this.bloom = new UnrealBloomPass( new THREE.Vector2( window.innerWidth, window.innerHeight ), BLOOM.strength, BLOOM.radius, BLOOM.threshold );
		this.setGraphics( 'normal' );

		this.camera = new THREE.PerspectiveCamera( 35, 1, 0.03, 70 ); // near: the camera may skim the ground
		this.angle = 0.6; // orbit when not cinematic
		this.shot = null;
		this.shotTime = 0; // s since the cut
		this.shotStart = 0; // beat of the cut (with a clock)
		this.shotBeats = 8;
		this.time = 0;
		this.beatClock = null;
		this.onCut = null; // ( shot ) at every cut
		this.onFrame = null; // ( canvas | null, p 0..1 ) every frame of a transition, null at its end
		this.prev = null; // outgoing shot during a transition: { shot, length (s) }
		this.transitionTime = 1.65; // s
		this.lift = { value: 0, fresh: true }; // current shot's crane-up over the relief (liftOver)
		this.dt = 0;

		// Places and the moves between them
		this.sets = {};
		this.active = null; // the set on screen
		this.place = null; // its name ('home', 'garage', 'solo', 'multi')
		this.filming = false; // the shot edit runs (a racing set, fully there)
		this.move = null; // the change of place under way
		this.queued = null; // the next one, asked for meanwhile
		this.setChannel = foldChannel();
		this.setChannel.uFoldWhite.value.set( FLOOR ); // between places the ground turns to the garage's white
		this.wallChannel = foldChannel();
		this.setWave = new FoldWave( this.setChannel );
		this.wallWave = new FoldWave( this.wallChannel );
		this.walls = null;
		this.carFrame = new THREE.Object3D(); // the car on its ground, turned its way: the rest pose's frame

		// Home: the camera leans a little after the mouse (-1..1 from the
		// screen's middle, eased in `sway`), never with reduced motion
		this.pointer = [ 0, 0 ];
		this.sway = [ 0, 0 ];
		this.calm = matchMedia( '(prefers-reduced-motion: reduce)' );
		addEventListener( 'pointermove', ( e ) => {

			if ( e.pointerType !== 'mouse' ) return;
			this.pointer[ 0 ] = e.clientX / innerWidth * 2 - 1;
			this.pointer[ 1 ] = e.clientY / innerHeight * 2 - 1;

		} );
		document.documentElement.addEventListener( 'pointerleave', () => { this.pointer = [ 0, 0 ]; } );
		this.shadowFade = 1;

		this.view = 'center';
		this.loader = new ColorMapGLTFLoader();
		this.car = null;
		this.carKey = '';
		this.cache = new Map();
		this.shownId = null; // the car on display (its id, whatever the livery)
		this.paint = new PaintFlow( this.scene ); // a livery change spreads over the body

		this.resize();
		window.addEventListener( 'resize', () => this.resize() );

		this.clock = new THREE.Timer();
		this.renderer.setAnimationLoop( () => this.render() );

	}

	load( name ) {

		return new Promise( ( resolve, reject ) => this.loader.load( `models/${ name }.glb`, ( g ) => resolve( g.scene ), undefined, reject ) );

	}

	// Cinematic (the menu): the places of the menu, built up front (their
	// stages are what take time). Otherwise (atmo-lab): a short straight with
	// grass and pines.
	// options.props: false = no trees, stones, tents or smoke (performance mode)
	// options.ultra: the road texture at 4× (Ultra graphics); seasonId: the
	// stages' season (Seasons.js), changed later with setSeason
	// options.walls: the DOM layer for the home titles' buttons; homeSeason:
	// the home's own season (its Saison button, settings.homeSeason)
	async buildSet( { props = true, ultra = false, seasonId = 'summer', homeSeason = null, walls = null } = {} ) {

		this.seasonId = seasonId;

		if ( this.cinematic ) return this.buildPlaces( props, ultra, walls, homeSeason );

		const [ straight, forest, empty ] = await Promise.all( [ 'track-straight', 'decoration-forest', 'decoration-empty' ].map( ( n ) => this.load( n ) ) );

		for ( let k = - 3; k <= 3; k ++ ) {

			const tile = straight.clone();
			tile.scale.setScalar( TRACK_SCALE );
			tile.position.set( 0, ROAD_Y, k * 10 * TRACK_SCALE ); // asphalt is at the tile's y = 0
			tile.traverse( ( c ) => { if ( c.isMesh ) c.castShadow = c.receiveShadow = true; } );
			this.scene.add( tile );

		}

		let material = null;
		straight.traverse( ( c ) => { if ( c.isMesh ) material = c.material; } );

		const ground = new THREE.PlaneGeometry( 120, 120 ).rotateX( - Math.PI / 2 );
		const uv = ground.attributes.uv;
		for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, GRASS_UV[ 0 ], GRASS_UV[ 1 ] );
		const grass = new THREE.Mesh( ground, material );
		grass.position.y = ROAD_Y - 0.02;
		grass.receiveShadow = true;
		this.scene.add( grass );

		// Pines on both sides of the road, a fixed pseudo-random layout
		const { trees } = extractProps( { 'decoration-forest': forest, 'decoration-empty': empty } );
		let seed = 7;
		const rand = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;

		for ( let i = 0; i < 70; i ++ ) {

			const side = i % 2 ? 1 : - 1;
			const x = side * ( 5 + rand() * 14 );
			const z = ( rand() - 0.5 ) * 50;
			const tree = new THREE.Mesh( trees[ Math.floor( rand() * trees.length ) ], material );
			tree.position.set( x, ROAD_Y - 0.1, z );
			tree.rotation.y = rand() * Math.PI * 2;
			tree.scale.setScalar( TRACK_SCALE * ( 0.8 + rand() * 0.45 ) );
			tree.castShadow = tree.receiveShadow = true;
			this.scene.add( tree );

		}

	}

	async buildPlaces( props, ultra, wallsLayer, homeSeason ) {

		const names = [ 'track-straight', 'track-finish', 'decoration-forest', 'decoration-empty' ];
		const loaded = await Promise.all( names.map( ( n ) => this.load( n ) ) );
		const models = Object.fromEntries( names.map( ( n, i ) => [ n, loaded[ i ] ] ) );
		models.kit = await loadKit( this.loader );
		models.nature = await loadNature( this.loader );

		// Light: no colliders, no HUD, terrain only as far as the fog lets you
		// see (shots stay within ~5 m of the car; tiles are 32 m squares, so a
		// tile touches that view if its centre is within view + half a diagonal)
		const view = ( this.scene.fog ? this.scene.fog.far : 40 ) + 5;
		const stageOptions = { props, hud: false, tileRadius: view + 23, ahead: 2, behind: 1, ultra };
		this.props = props;

		this.sets.home = new HomeSet( { models, ultra, seasonId: homeSeason } );
		this.sets.drive = new DriveSet( { models, props, ultra, seasonId: this.seasonId, stageOptions } );
		this.sets.garage = new GarageSet();
		await this.sets.home.ready; // its logo in before the sets are made foldable

		for ( const set of Object.values( this.sets ) ) {

			set.group.visible = false;
			this.scene.add( set.group );
			foldify( set.group, this.setChannel );

		}

		if ( wallsLayer ) {

			// The titles have a canvas of their own over the scene's: out of its
			// effects (no depth of field, no bloom on the letters)
			this.walls = new Walls( wallsLayer, this.wallChannel );
			this.titles = new THREE.WebGLRenderer( { antialias: true, alpha: true } );
			this.titles.setPixelRatio( this.renderer.getPixelRatio() );
			this.titles.setSize( window.innerWidth, window.innerHeight );
			this.titles.domElement.className = 'titles';
			this.renderer.domElement.after( this.titles.domElement );
			// A shade on the screen's sides under the titles, so they read on any scene
			this.scrim = document.createElement( 'div' );
			this.scrim.className = 'titles-scrim';
			this.titles.domElement.before( this.scrim );
			this.titleScene = new THREE.Scene();
			this.titleScene.add( this.walls.group );

		}

	}

	// The set behind a place of the menu
	setOf( place ) {

		return place === 'solo' || place === 'multi' ? this.sets.drive : this.sets[ place ];

	}

	// Shows a place at once (no fold). hidden: nothing but the car until
	// unfold() (the page's first reveal)
	show( place, { walls = false, hidden = false } = {} ) {

		const set = this.setOf( place );
		if ( ! set ) return;
		set.refresh?.();
		if ( this.active && this.active !== set ) this.active.group.visible = false;
		this.active = set;
		this.place = place;
		set.group.visible = true;
		if ( this.car ) set.enter( this.car, { crowd: place === 'multi' } );
		set.light( this );
		this.setWave.set( hidden ? FOLD_GONE : FOLD_IDLE );
		this.wallWave.set( walls && ! hidden ? FOLD_IDLE : FOLD_GONE );
		this.showWalls = walls;
		this.walls?.show( walls );
		this.followCar();
		this.restPose();
		this.placeWalls();
		if ( set.cinematic && ! hidden ) this.startFilming();
		if ( place === 'multi' ) this.loadOthers();

	}

	// The place unfolds around the car (after show( …, { hidden: true } ))
	async unfold() {

		if ( ! this.active ) return;
		const origin = this.car ? this.car.position : this.carFrame.position;
		const waves = [ this.setWave.run( FOLD_IN, origin, { duration: FOLD_IN_TIME * 1.15, reach: Math.min( this.active.reach, WAVE_REACH ) } ) ];
		if ( this.showWalls ) waves.push( this.wallWave.run( FOLD_IN, origin, { duration: FOLD_IN_TIME * 1.3, reach: 7, width: 2.5 } ) );
		await waves[ 0 ];
		if ( this.active.cinematic && ! this.move ) this.startFilming();

	}

	// Goes to a place: the scene goes, the next one comes around the car.
	// options.walls: the home titles shown there. Resolves as the camera
	// lands on the new place (the screen's UI comes in then; onArrive( place )
	// when the new place starts to come).
	goTo( place, { walls = false } = {} ) {

		if ( ! this.active ) {

			this.show( place, { walls } );
			return Promise.resolve();

		}

		if ( this.move ) {

			// One at a time: the last one asked for runs next
			this.queued = { place, walls };
			return this.move.landed;

		}

		// Same place: only the titles come or go
		if ( place === this.place ) {

			this.setWalls( walls );
			return Promise.resolve();

		}

		this.changePlace( place, walls );
		return this.move.landed;

	}

	setWalls( on ) {

		if ( on === this.showWalls ) return;
		this.showWalls = on;
		this.walls?.show( on );
		if ( ! this.walls ) return;
		if ( on ) this.placeWalls();
		if ( on && this.wallsOff ) {

			// Back from a screen they slid off for: they come back the other way, no fold
			this.slideWalls( SLIDE_FROM * this.wallsOff, 0, SLIDE_IN, 1, SLIDE_SKIP );
			this.wallsOff = 0;
			return;

		}

		this.wallWave.run( on ? FOLD_IN : FOLD_OUT, this.car ? this.car.position : this.carFrame.position, { duration: on ? 0.9 : 0.6, reach: 7, width: 2.5 } );

	}

	async changePlace( place, walls ) {

		const from = this.active, to = this.setOf( place );
		this.paint.finish();
		this.dropSlidWalls();
		const move = { place };
		move.arrived = new Promise( ( resolve ) => { move.arrive = resolve; } );
		move.landed = new Promise( ( resolve ) => { move.land = resolve; } ); // updateMove
		this.move = move;

		// The camera's pose now, in the car's frame: eased to the next rest pose
		this.followCar();
		move.camFrom = this.cameraInCarFrame();
		move.camTo = to.rest || REST; // the next place's rest pose, from the very start (the travelling runs through the whole change)
		move.time = 0;
		move.duration = FOLD_OUT_TIME + EMPTY_TIME + FOLD_IN_TIME;
		move.lightFrom = lightState( this );
		this.sway = [ 0, 0 ]; // the camera eases from where it is; at home it leans again from the rest pose
		this.stopFilming();
		from.leave();

		const origin = this.car ? this.car.position.clone() : this.carFrame.position.clone();
		const out = [ this.setWave.run( FOLD_OUT, origin, { duration: FOLD_OUT_TIME, reach: Math.min( from.reach, WAVE_REACH ) } ) ];
		if ( this.showWalls && this.walls ) out.push( this.wallWave.run( FOLD_OUT, origin, { duration: FOLD_OUT_TIME * 0.7, reach: 7, width: 2.5 } ) );
		this.showWalls = walls;
		this.walls?.show( false );

		// The next place's light, to blend into
		to.light( this );
		move.lightTo = lightState( this );
		this.applyLight( move.lightFrom );

		// The old place stays (all white, nothing standing) until the new one
		// takes its place: hidden earlier, the white floor went and the sky
		// flashed through for the empty moment
		await Promise.all( out );
		await new Promise( ( r ) => setTimeout( r, EMPTY_TIME * 1000 ) );

		// Nothing left but the car: it moves over to the new place (rebuilt
		// first if its season changed)
		to.refresh?.();
		this.active = to;
		this.place = place;
		if ( this.car ) to.enter( this.car, { crowd: place === 'multi' } );
		this.followCar();
		this.setWave.set( FOLD_GONE );
		if ( from !== to ) from.group.visible = false;
		to.group.visible = true;
		foldify( to.group, this.setChannel );
		const arrived = this.setWave.run( FOLD_IN, this.car ? this.car.position : this.carFrame.position, { duration: FOLD_IN_TIME, reach: Math.min( to.reach, WAVE_REACH ) } );
		if ( place === 'multi' ) this.loadOthers();
		if ( walls && this.walls ) {

			this.placeWalls();
			this.walls.show( true );
			this.wallWave.run( FOLD_IN, this.car.position, { duration: FOLD_IN_TIME * 1.1, reach: 7, width: 2.5 } );

		}

		move.arrive();
		if ( this.onArrive ) this.onArrive( place );
		await arrived;

		this.applyLight( move.lightTo );
		move.land?.();
		this.move = null;
		if ( to.cinematic ) this.startFilming();

		if ( this.queued ) {

			const q = this.queued;
			this.queued = null;
			this.goTo( q.place, { walls: q.walls } );

		} else if ( this.active.stale ) this.changePlace( this.place, this.showWalls ); // another season meanwhile

	}

	// The camera's pose in the car's frame (position, a look-at point, fov)
	cameraInCarFrame() {

		_inv.copy( this.carFrame.matrixWorld ).invert();
		const pos = this.camera.position.clone().applyMatrix4( _inv );
		const dist = this.camera.position.distanceTo( this.car ? this.car.position : this.carFrame.position ) || 3;
		const look = this.camera.getWorldDirection( _l ).multiplyScalar( dist ).add( this.camera.position ).applyMatrix4( _inv );
		return { pos: pos.toArray(), look: look.toArray(), fov: this.camera.fov };

	}

	// The car's frame: on its ground (the rig's y), turned the way its nose points
	followCar() {

		const f = this.carFrame;
		if ( this.car ) {

			f.position.copy( this.car.position );
			f.position.y -= ROAD_Y;
			f.rotation.set( 0, this.car.rotation.y, 0 );

		} else if ( this.active ) {

			f.position.copy( this.active.rig.position );
			f.rotation.set( 0, this.active.rig.rotation.y, 0 );

		}

		f.updateMatrixWorld();

	}

	// A pose written in the car's frame, onto the camera
	poseInCarFrame( { pos, look, fov } ) {

		this.camera.position.fromArray( pos ).applyMatrix4( this.carFrame.matrixWorld );
		_l.fromArray( look ).applyMatrix4( this.carFrame.matrixWorld );
		this.camera.fov = fov;
		this.camera.lookAt( _l );

	}

	// The active place's camera at rest (a set may have its own: home)
	get rest() {

		return this.active?.rest || REST;

	}

	restPose() {

		this.poseInCarFrame( this.rest );

	}

	// The rest pose moved after the mouse: across and up / down around the
	// point it looks at (SWAY m at the screen's edges), still looking there
	swayCamera( dt ) {

		const target = this.calm.matches ? [ 0, 0 ] : this.pointer;
		const k = 1 - Math.exp( - SWAY_SMOOTH * dt );
		this.sway[ 0 ] += ( target[ 0 ] - this.sway[ 0 ] ) * k;
		this.sway[ 1 ] += ( target[ 1 ] - this.sway[ 1 ] ) * k;
		_l.fromArray( this.rest.look ).applyMatrix4( this.carFrame.matrixWorld );
		_p.set( 1, 0, 0 ).applyQuaternion( this.camera.quaternion ); // the camera's right
		this.camera.position.addScaledVector( _p, this.sway[ 0 ] * SWAY[ 0 ] );
		this.camera.position.y -= this.sway[ 1 ] * SWAY[ 1 ];
		this.camera.lookAt( _l );

	}

	// The home titles laid out for the rest pose
	// Other items on the walls with the place staying put (the home's titles ↔
	// Solo's two clips): those shown rise off the screen, the new ones come up
	// from below (SLIDE_EASE, anticipating then overshooting). dir: 1 forward,
	// -1 back (the other way round). During a change of place, or before the
	// walls show: set at once
	// instant: the same screen updated (a tab, a setting): replaced at once
	async swapWalls( items, dir = 1, instant = false ) {

		if ( ! this.walls ) return;
		// A swap under way: what comes in is just the newer list (an update meanwhile)
		if ( this.wallSwap ) {

			this.wallSwap.items = items;
			return;

		}

		if ( JSON.stringify( items ) === this.walls.key ) return;
		const showing = this.showWalls && this.walls.shown && this.walls.items.length && this.active && ! this.move;

		if ( instant && showing ) {

			this.walls.setItems( items, true ); // tiles changed in place fade over (a slide still coming in carries them on)
			this.placeWalls();
			this.walls.show( true );
			return;

		}

		if ( ! showing ) {

			this.walls.setItems( items );
			return;

		}

		const swap = this.wallSwap = { items };
		this.walls.show( false );
		await this.slideWalls( 0, SLIDE_LIFT * dir, SLIDE_OUT, SLIDE_GONE ); // the new ones start as soon as these are off the screen
		this.walls.setItems( swap.items );
		this.wallSwap = null;
		this.placeWalls();
		this.walls.show( true );
		await this.slideWalls( - SLIDE_FROM * dir, 0, SLIDE_IN, 1, SLIDE_SKIP ); // coming from off the screen: no wind-up (it read as a stall at the edge)

	}

	// To a screen of its own in the same place (Paramètres, Mentions légales):
	// the walls' items slide off like a swapWalls instead of folding away, and
	// come back the same way (setWalls). Resolves once they are off the screen
	slideWallsOff( dir = 1 ) {

		if ( ! this.walls || ! this.showWalls || ! this.active || this.move ) return Promise.resolve();
		this.showWalls = false;
		this.walls.show( false );
		this.wallsOff = dir;
		return this.slideWalls( 0, SLIDE_LIFT * dir, SLIDE_OUT, SLIDE_GONE );

	}

	// Walls slid off then a change of place: back to the usual hidden state (folded away)
	dropSlidWalls() {

		if ( ! this.wallsOff ) return;
		this.wallsOff = 0;
		this.wallSlide?.resolve();
		this.wallSlide = null;
		this.walls.group.position.y = 0;
		this.wallWave.set( FOLD_GONE );

	}

	// The walls' items all moved up / down together (m), eased; resolves when
	// there, or (gone: a share of the way) once that far, the rush past it
	// skip: the share of the curve left out at its start (its wind-up)
	slideWalls( from, to, duration, gone = 1, skip = 0 ) {

		this.wallSlide?.resolve();
		return new Promise( ( resolve ) => {

			this.wallSlide = { from, to, duration, time: 0, resolve, gone, skip };
			this.walls.group.position.y = from;

		} );

	}

	updateWallSlide( dt ) {

		const s = this.wallSlide;
		if ( ! s || ! this.walls ) return;
		s.time += dt;
		const t = Math.min( 1, s.time / s.duration );
		const e = SLIDE_EASE( s.skip + t * ( 1 - s.skip ) );
		this.walls.group.position.y = s.from + ( s.to - s.from ) * e;
		if ( t < 1 && ! ( s.gone < 1 && t > 0.3 && e >= s.gone ) ) return;
		this.wallSlide = null;
		s.resolve();

	}

	placeWalls() {

		if ( ! this.walls || ! this.active ) return;
		const keep = [ this.camera.position.clone(), this.camera.quaternion.clone(), this.camera.fov ];
		this.poseInCarFrame( this.rest );
		this.camera.updateProjectionMatrix();
		// The framing's lens shift (setView): the walls stay on the screen's edges
		this.walls.place( this.camera, - 2 * this.targetOffset()[ 0 ] / window.innerWidth );
		this.camera.position.copy( keep[ 0 ] );
		this.camera.quaternion.copy( keep[ 1 ] );
		this.camera.fov = keep[ 2 ];

	}

	// The sun's shadow box: half its side in m around the car (8 by default)
	setShadowBox( half = 8 ) {

		const c = this.sun.shadow.camera;
		if ( c.right === half ) return;
		Object.assign( c, { left: - half, right: half, top: half, bottom: - half } );
		c.updateProjectionMatrix();

	}

	applyLight( l ) {

		const { scene, renderer, sun, ambient } = this;
		scene.background = l.background.clone();
		if ( l.fog ) {

			if ( ! scene.fog ) scene.fog = new THREE.Fog( l.fog[ 0 ], l.fog[ 1 ], l.fog[ 2 ] );
			scene.fog.color.copy( l.fog[ 0 ] );
			scene.fog.near = l.fog[ 1 ];
			scene.fog.far = l.fog[ 2 ];

		}

		renderer.toneMappingExposure = l.exposure;
		this.bloom.strength = l.bloom;
		sun.color.copy( l.sun[ 0 ] );
		sun.intensity = l.sun[ 1 ];
		ambient.color.copy( l.ambient[ 0 ] );
		ambient.groundColor.copy( l.ambient[ 1 ] );
		ambient.intensity = l.ambient[ 2 ];
		this.camera.far = l.far;

	}

	// The light halfway between two places (t 0..1)
	blendLight( a, b, t ) {

		const { scene, renderer, sun, ambient } = this;
		scene.background.copy( a.background ).lerp( b.background, t );
		if ( scene.fog && a.fog && b.fog ) {

			scene.fog.color.copy( a.fog[ 0 ] ).lerp( b.fog[ 0 ], t );
			scene.fog.near = a.fog[ 1 ] + ( b.fog[ 1 ] - a.fog[ 1 ] ) * t;
			scene.fog.far = a.fog[ 2 ] + ( b.fog[ 2 ] - a.fog[ 2 ] ) * t;

		}

		renderer.toneMappingExposure = a.exposure + ( b.exposure - a.exposure ) * t;
		this.bloom.strength = a.bloom + ( b.bloom - a.bloom ) * t;
		sun.color.copy( a.sun[ 0 ] ).lerp( b.sun[ 0 ], t );
		sun.intensity = a.sun[ 1 ] + ( b.sun[ 1 ] - a.sun[ 1 ] ) * t;
		ambient.color.copy( a.ambient[ 0 ] ).lerp( b.ambient[ 0 ], t );
		ambient.groundColor.copy( a.ambient[ 1 ] ).lerp( b.ambient[ 1 ], t );
		ambient.intensity = a.ambient[ 2 ] + ( b.ambient[ 2 ] - a.ambient[ 2 ] ) * t;
		this.camera.far = Math.max( a.far, b.far );

	}

	setFar( far ) {

		this.camera.far = far;

	}

	// The headlights' bloom, as a share of BLOOM.strength (the white garage: half)
	setBloom( share ) {

		this.bloom.strength = BLOOM.strength * share;

	}

	// The shot edit, from the rest pose: the first cut on the next bar
	startFilming() {

		this.filming = true;
		this.active.launch?.();
		this.shot = REST_SHOT;
		this.shotTime = 0;
		this.lift = { value: 0, fresh: true };
		this.prev = null;

		if ( this.beatClock ) {

			const { beat } = this.beatClock.info();
			this.shotStart = Math.floor( beat / 4 ) * 4;
			this.shotBeats = this.shotStart + 4 - beat < 2 ? 8 : 4; // at least two beats at rest

		}

	}

	stopFilming() {

		this.filming = false;
		if ( this.prev && this.onFrame ) this.onFrame( null, 1 );
		this.prev = null;

	}

	// The home's Saison button: the next season spreads over the home from
	// under the car (HomeSet.nextSeason). Resolves with its id, or null when
	// the home isn't on screen and still
	async nextHomeSeason() {

		const home = this.sets.home;
		if ( ! home || this.active !== home || this.move ) return null;
		return home.nextSeason( this );

	}

	// Menu Spéciale → Saison: the stages are rebuilt in that season, the one
	// on screen folded away and back (rebuilt while nothing shows), the
	// other when it is next shown
	setSeason( id ) {

		if ( id === this.seasonId ) return;
		this.seasonId = id;
		for ( const set of Object.values( this.sets ) ) set.setSeason?.( id );
		if ( this.active && this.active.stale && ! this.move ) this.changePlace( this.place, this.showWalls );

	}

	// Swaps the displayed car (models are cached per car + livery)
	async setCar( id, livery ) {

		const key = id + '#' + livery;
		this.carKey = key;

		// Another car: the one on display shrinks away at once, while the next one loads
		if ( this.cinematic && this.car && ( this.swap || this.shownId !== id ) && ! this.move ) this.shrinkCar();

		let model = this.cache.get( key );

		if ( ! model ) {

			model = await loadCar( this.loader, id, livery );
			model.traverse( ( c ) => { if ( c.isMesh ) c.castShadow = c.receiveShadow = true; } );
			this.lightUp( model );
			if ( this.cinematic ) preparePaint( model );
			model.userData.baseScale = model.scale.x;
			this.cache.set( key, model );

		}

		if ( this.carKey !== key ) return; // a newer choice arrived meanwhile

		// Grows in once the old one is gone (updateSwap)
		if ( this.swap ) {

			this.swap.next = model;
			this.swap.nextId = id;
			this.shownKey = key;
			return;

		}

		if ( key === this.shownKey ) return; // that paint is already on (or flowing on)
		this.shownKey = key;

		// Another livery of the same car: the new paint flows over the old one
		// (over the ones still flowing too)
		const old = this.car;
		const repaint = this.cinematic && old && this.shownId === id && ! this.move && ! this.active?.cinematic; // standing still (the garage)

		if ( repaint ) {

			this.car = this.paint.add( old, model );
			if ( this.active ) this.active.enter( this.car, { crowd: this.place === 'multi' } );
			return;

		}

		this.paint.finish();
		if ( old ) this.scene.remove( this.car );
		this.car = model;
		this.shownId = id;
		this.scene.add( model );

		if ( ! this.cinematic ) {

			model.position.y = ROAD_Y;
			return;

		}

		if ( old ) {

			model.position.copy( old.position );
			model.rotation.copy( old.rotation );

		}

		if ( this.active ) this.active.enter( model, { crowd: this.place === 'multi' } );

	}

	// A loaded model of that car, in any livery (the same UVs in all), or null
	modelOf( id ) {

		for ( const [ key, model ] of this.cache ) if ( key.slice( 0, key.lastIndexOf( '#' ) ) === id ) return model;
		return null;

	}

	// A car change, step one: the car on display shrinks to nothing (from
	// its current size: it may be growing in still)
	shrinkCar() {

		this.paint.finish();
		const s = this.swap;
		if ( s && s.phase === 'out' ) return;
		const k = s ? s.k : 1;
		this.swap = { phase: 'out', model: this.car, t: 0, from: k, k, next: null, nextId: null };

	}

	// Per frame: shrink, swap once the next car is in, grow with a little overshoot
	updateSwap( dt ) {

		const s = this.swap;
		if ( ! s ) return;
		s.t += dt;

		if ( s.phase === 'out' ) {

			const u = Math.min( 1, s.t / SHRINK_TIME );
			s.k = s.from * ( 1 - u * u );
			scaleCar( s.model, s.k );
			if ( u < 1 || ! s.next ) return; // gone: waits for the next one if it is still loading

			const next = s.next, old = s.model;

			if ( next !== old ) {

				this.scene.remove( old );
				scaleCar( old, 1 ); // as it was, for when it comes back from the cache
				next.position.copy( old.position );
				next.rotation.copy( old.rotation );
				this.car = next;
				this.shownId = s.nextId;
				this.scene.add( next );
				scaleCar( next, 1 ); // full size while the place fits it (the garage's plinth)
				if ( this.active ) this.active.enter( next, { crowd: this.place === 'multi' } );

			}

			this.swap = { phase: 'in', model: next, t: 0, k: 0 };
			scaleCar( next, 0 );
			return;

		}

		const u = Math.min( 1, s.t / GROW_TIME );
		const c = 1.9; // easeOutBack: a touch past full size, then settles
		s.k = 1 + ( c + 1 ) * Math.pow( u - 1, 3 ) + c * Math.pow( u - 1, 2 );
		scaleCar( s.model, s.k );
		if ( u >= 1 ) {

			scaleCar( s.model, 1 );
			this.swap = null;

		}

	}

	// The multiplayer backdrop's two other cars: random rally cars, not the
	// player's (loaded once, the first time a multiplayer screen shows)
	async loadOthers() {

		if ( this.othersLoading ) return this.othersLoading;
		const pool = CARS.filter( ( c ) => c.id !== 'truck' && ! this.carKey.startsWith( c.id + '#' ) );
		const picks = [];
		while ( picks.length < 2 && pool.length ) picks.push( pool.splice( Math.floor( Math.random() * pool.length ), 1 )[ 0 ] );

		this.othersLoading = Promise.all( picks.map( async ( car ) => {

			const model = await loadCar( this.loader, car.id, 1 + Math.floor( Math.random() * car.liveries ) );
			model.traverse( ( c ) => { if ( c.isMesh ) c.castShadow = c.receiveShadow = true; } );
			this.lightUp( model, false );
			return model;

		} ) ).then( ( models ) => {

			const drive = this.sets.drive;
			drive.setOthers( models );
			foldify( drive.group, this.setChannel );
			const here = this.place === 'multi';
			for ( const m of models ) m.visible = here;
			if ( here ) {

				drive.crowd = true;
				drive.placeOthers();
				if ( this.filming ) drive.launch();

			}

		} ).catch( ( e ) => console.error( 'Menu: other cars', e ) );

		return this.othersLoading;

	}

	// Graphics preset: 'low' no effects, 'normal' the headlight bloom, 'ultra'
	// sun shafts + ambient occlusion first (Ultra.js)
	setGraphics( preset ) {

		if ( preset === 'ultra' && ! this.ultra ) {

			this.ultra = createUltraEffects( this.scene, this.camera, this.sun, 'menu' );
			this.dof = createDofPass( this.scene, this.camera, 'menu' );
			setDof( this.dof, this.dofSettings );
			// Their own scene passes (the DOF's depth, the AO's normals) shrink
			// and grow with the place changes too: no ghosts of what is gone
			foldMaterial( this.dof._materialDepth, this.setChannel );
			foldMaterial( this.ultra[ 1 ].normalMaterial, this.setChannel );

		}

		this.renderer.setEffects( preset === 'low' ? null : preset === 'ultra' ? [ ...this.ultra, this.dof, this.bloom ] : [ this.bloom ] );

	}

	// Ultra depth of field: { on, strength } (menu Paramètres, live)
	setDofSettings( settings ) {

		this.dofSettings = settings;
		if ( this.dof ) setDof( this.dof, settings );

	}

	// Focus on the car from wherever the camera stands now
	focusCar() {

		if ( this.dof && this.car ) {

			this.camera.updateMatrixWorld();
			setFocus( this.dof, this.camera, this.car.position );

		}

	}

	// Menu only: the rally cars' "Lights" material (head and tail lights, one
	// shared atlas) glows in its own colours, and (the player's car) two beams
	// light the road ahead. The other cars get no beams: every light added
	// to the scene recompiles every material
	lightUp( model, beams = true ) {

		let lit = false;

		model.traverse( ( c ) => {

			if ( ! c.isMesh ) return;
			const glow = ( m ) => {

				if ( m.name !== 'Lights' ) return m;
				lit = true;
				m = m.clone(); // the game's cars stay unlit
				m.emissive = new THREE.Color( 0xffffff );
				m.emissiveMap = m.map;
				m.emissiveIntensity = LIGHTS_GLOW;
				return m;

			};

			c.material = Array.isArray( c.material ) ? c.material.map( glow ) : glow( c.material );

		} );

		if ( ! lit || ! beams ) return;

		// Beams in the model's raw units (+Z forward, root scaled 0.5)
		for ( const side of [ - 1, 1 ] ) {

			const beam = new THREE.SpotLight( 0xfff1d6, 18, 14, 0.42, 0.55, 1.4 );
			beam.position.set( side * 0.42, 0.55, 1.7 );
			beam.target.position.set( side * 0.6, 0, 9 );
			model.add( beam, beam.target );

		}

	}

	// Framing per menu layout, eased in render():
	//   'center' — the home titles, the garage lists: car in the middle
	//   'stage'  — cards along the bottom: car centred, raised
	//   'split'  — list on the left, detail card on the right: car in between
	//   'side' / 'garage' — panel on the left: car pushed right
	//   'menu' — the circuit / stage menus on the left wall: car on the right two thirds
	setView( view ) {

		this.view = view;

	}

	// clock: { info() → { time, beat, beatLength }, calm() → bool } — the menu music
	setClock( clock ) {

		this.beatClock = clock;
		if ( this.filming ) this.startFilming();

	}

	// s per beat: the music's (each track has its tempo), else the silent clock's
	beatLength() {

		return this.beatClock?.info().beatLength ?? BEAT;

	}

	// Next shot of the edit: random, never twice in a row
	nextShot() {

		// The outgoing shot keeps running under the transition (renderOutgoing)
		this.prev = this.shot ? { shot: this.shot, length: ( this.beatClock ? this.shotBeats : this.shot.beats ) * this.beatLength(), lift: this.lift } : null;
		this.lift = { value: 0, fresh: true };

		let shot;
		do shot = SHOTS[ Math.floor( Math.random() * SHOTS.length ) ]; while ( SHOTS.length > 1 && shot === this.shot );
		this.shot = shot;
		this.shotTime = 0;
		if ( this.onCut && this.prev ) this.onCut( shot );

	}

	placeCamera( dt ) {

		if ( ! this.cinematic ) {

			this.angle += dt * 0.18;
			this.camera.position.set( Math.sin( this.angle ) * 6, 2.7, Math.cos( this.angle ) * 6 );
			this.camera.lookAt( 0, 0.35, 0 );
			return;

		}

		// A change of place: from where the camera was to the next rest pose
		if ( this.move ) {

			this.poseInCarFrame( travelling( this.move.camFrom, this.move.camTo, this.move.time / ( this.move.duration * TRAVEL_SHARE ) ) );
			return;

		}

		if ( ! this.filming ) {

			this.restPose();
			if ( this.active?.sway ) this.swayCamera( dt );
			return;

		}

		let progress;

		if ( this.beatClock ) {

			// On the beat grid: cuts land on bars, the next shot starts exactly
			// where the last one ends; resync if the music jumped (loop, seek)
			const { time, beat } = this.beatClock.info();
			this.time = time;
			const off = beat - this.shotStart;

			// off < 0: the music looped back to the start
			if ( ! this.shot || off >= this.shotBeats || off < 0 ) {

				this.shotStart = ! this.shot || off < 0 || off > this.shotBeats * 2 ? Math.floor( beat / 4 ) * 4 : this.shotStart + this.shotBeats;
				this.nextShot();
				this.shotBeats = this.shot.beats * ( this.beatClock.calm() ? 2 : 1 );

			}

			this.shotTime = ( beat - this.shotStart ) * this.beatLength();
			progress = ( beat - this.shotStart ) / this.shotBeats;

		} else {

			this.time += dt;
			this.shotTime += dt;
			if ( ! this.shot || this.shotTime >= this.shot.beats * BEAT ) this.nextShot();
			progress = this.shotTime / ( this.shot.beats * BEAT );

		}

		const rate = 1 / ( ( this.beatClock ? this.shotBeats : this.shot.beats ) * this.beatLength() );
		this.pose( this.shot, Math.max( 0, progress ), rate, this.lift );

	}

	// Camera on a shot at progress t (past 1 it keeps moving at the same speed:
	// the outgoing shot during a transition). rate = progress per second,
	// lift = the shot's { value, fresh } crane-up over the relief.
	pose( shot, t, rate = 0, lift = null ) {

		let { pos, look, fov } = shot.at( t );
		const drive = this.active && this.active.drive;

		// Shots are written around a car standing at the origin: carried along
		// in the car's frame (MenuDrive.rig) when it drives
		if ( drive ) {

			pos = _p.fromArray( pos ).applyMatrix4( drive.rig.matrixWorld ).toArray();
			look = _l.fromArray( look ).applyMatrix4( drive.rig.matrixWorld ).toArray();

		}

		if ( this.active && this.active.stage && lift ) pos[ 1 ] += this.liftOver( shot, t, rate, pos, lift );

		// Handheld: slow, small, never the same twice (none at rest)
		const s = this.time;
		const k = shot === REST_SHOT ? 0 : 1;
		const shake = [ ( Math.sin( s * 1.3 ) * 0.012 + Math.sin( s * 3.1 ) * 0.005 ) * k, Math.sin( s * 1.7 + 1 ) * 0.01 * k, Math.sin( s * 1.1 + 2 ) * 0.012 * k ];

		this.camera.position.set( pos[ 0 ] + shake[ 0 ], pos[ 1 ] + shake[ 1 ], pos[ 2 ] + shake[ 2 ] );
		this.camera.fov = fov;
		this.camera.lookAt( look[ 0 ], look[ 1 ], look[ 2 ] );

	}

	// How high to lift the camera so it never goes into the relief: looks
	// LIFT_AHEAD s ahead along the shot (and along the road, the car keeps
	// going) and cranes up smoothly before the bump, down slowly after it —
	// never a snap onto the ground. Only if the relief comes up faster than
	// that (rare) is the camera pushed up at once.
	liftOver( shot, t, rate, pos, lift ) {

		const drive = this.active.drive;
		const rig = drive.rig;
		const fx = Math.sin( rig.rotation.y ), fz = Math.cos( rig.rotation.y );
		const travel = drive.speed * SLOWMO; // m/s of the car, real time
		const now = Math.max( 0, this.floorAt( pos[ 0 ], pos[ 2 ] ) - pos[ 1 ] );
		let need = now;

		for ( let k = 1; k <= LIFT_STEPS; k ++ ) {

			const tau = LIFT_AHEAD * k / LIFT_STEPS;
			_q.fromArray( shot.at( t + tau * rate ).pos ).applyMatrix4( rig.matrixWorld );
			_q.x += fx * travel * tau;
			_q.z += fz * travel * tau;
			need = Math.max( need, this.floorAt( _q.x, _q.z ) - _q.y );

		}

		if ( lift.fresh ) {

			lift.value = need; // a cut: start where the shot needs to be
			lift.fresh = false;

		} else {

			const k = need > lift.value ? LIFT_UP : LIFT_DOWN;
			lift.value += ( need - lift.value ) * ( 1 - Math.exp( - k * this.dt ) );

		}

		lift.value = Math.max( lift.value, now - CAMERA_CLEARANCE * 0.6 ); // safety net
		return lift.value;

	}

	// Lowest height the camera may take at (x, z) on the stage: just above
	// what is drawn there (terrain facets or road)
	floorAt( x, z ) {

		return this.active.stage.surfaceAt( x, z ) + CAMERA_CLEARANCE;

	}

	// During a transition the outgoing shot is rendered too, still moving, and
	// handed to onFrame( canvas, p ) before the incoming one is drawn
	renderOutgoing() {

		if ( ! this.prev ) return;

		if ( ! this.onFrame || this.shotTime >= this.transitionTime ) {

			this.prev = null;
			if ( this.onFrame ) this.onFrame( null, 1 );
			return;

		}

		const position = this.camera.position.clone(), quaternion = this.camera.quaternion.clone(), fov = this.camera.fov;
		this.pose( this.prev.shot, 1 + this.shotTime / this.prev.length, 1 / this.prev.length, this.prev.lift );
		this.applyOffset();
		this.focusCar();
		this.renderer.render( this.scene, this.camera );
		this.onFrame( this.renderer.domElement, this.shotTime / this.transitionTime ); // copied now, while the canvas holds it

		this.camera.position.copy( position );
		this.camera.quaternion.copy( quaternion );
		this.camera.fov = fov;

	}

	// Screen shift of the car for the current layout, in pixels
	targetOffset() {

		const w = window.innerWidth, h = window.innerHeight;
		if ( this.view === 'center' ) return [ 0, w <= 760 ? h * 0.08 : 0 ];
		if ( w <= 760 ) return [ 0, h * 0.22 ];
		if ( this.view === 'stage' ) return [ 0, h * 0.12 ];
		if ( this.view === 'split' ) return [ - 110, h * 0.08 ]; // between the list (left) and the detail card (right)
		if ( this.view === 'menu' ) return [ - w / 6, 0 ]; // the car on the right two thirds, a menu on the left wall
		return [ - w * 0.2, 0 ];

	}

	resize() {

		const w = window.innerWidth, h = window.innerHeight;
		this.renderer.setSize( w, h );
		this.titles?.setSize( w, h );
		this.camera.aspect = w / h;
		this.offset = this.offset || this.targetOffset();
		this.applyOffset();
		this.placeWalls();

	}

	applyOffset() {

		const w = window.innerWidth, h = window.innerHeight;
		this.camera.setViewOffset( w, h, this.offset[ 0 ], this.offset[ 1 ], w, h );
		this.camera.updateProjectionMatrix();

	}

	render() {

		this.clock.update();
		const dt = Math.min( this.clock.getDelta(), 0.1 );
		this.dt = dt;

		const [ tx, ty ] = this.targetOffset();
		const ease = Math.min( 1, dt * 5 );
		this.offset[ 0 ] += ( tx - this.offset[ 0 ] ) * ease;
		this.offset[ 1 ] += ( ty - this.offset[ 1 ] ) * ease;

		if ( this.walls && ! this.walls.placed && this.active ) this.placeWalls(); // new titles

		if ( this.active ) {

			this.active.update( dt );
			if ( this.active.stage && ( this.frame = ( this.frame || 0 ) + 1 ) % 10 === 0 ) foldify( this.active.group, this.setChannel ); // new chunks, tiles

		}

		this.setWave.update( dt );
		this.wallWave.update( dt );
		this.updateWallSlide( dt );

		this.paint.update( dt );
		this.updateSwap( dt );
		this.updateMove( dt );

		// The sun and its shadow box follow the car
		if ( this.cinematic && this.car ) {

			this.followCar();
			this.sun.target.position.copy( this.car.position );
			this.sun.position.copy( this.car.position ).add( this.sunOffset );

		}

		this.placeCamera( dt );
		if ( this.cinematic && this.filming ) this.renderOutgoing();
		this.applyOffset(); // also updates the projection (fov)
		if ( this.walls ) this.walls.update( dt, this.camera, window.innerWidth, window.innerHeight );

		this.focusCar();
		this.renderer.render( this.scene, this.camera );
		if ( this.titles ) {

			this.titles.render( this.titleScene, this.camera );
			const state = this.wallWave.state;
			this.scrim.classList.toggle( 'on', this.showWalls && ( state === FOLD_IDLE || state === FOLD_IN ) );

		}

	}

	// A change of place under way: light blended across the empty moment,
	// shadows gone while the ground folds
	updateMove( dt ) {

		const move = this.move;
		let shadow = 1;

		if ( move ) {

			move.time += dt;
			const t = move.time / move.duration;
			// The camera nearly there: the screen's UI may come in with its last stretch
			if ( move.land && move.time >= move.duration * TRAVEL_SHARE * LAND_AT ) {

				move.land();
				move.land = null;

			}
			// The whole mood (sky, fog, sun, sky light, exposure, bloom) turns over the whole change
			if ( move.lightTo ) this.blendLight( move.lightFrom, move.lightTo, smooth( 0, 1, t ) );
			const outEnd = FOLD_OUT_TIME / move.duration, inStart = ( FOLD_OUT_TIME + EMPTY_TIME ) / move.duration;
			shadow = t < inStart ? 1 - smooth( 0, outEnd * 0.35, t ) : smooth( inStart + ( 1 - inStart ) * 0.55, 1, t );

		}

		this.shadowFade += ( shadow - this.shadowFade ) * Math.min( 1, dt * 20 );
		this.sun.shadow.intensity = this.shadowFade;

	}

}
