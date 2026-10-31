import * as THREE from 'three';
import { ROAD_Y } from '../SplineTrack.js';
import { RallyStage } from '../RallyStage.js';
import { SmokeTrails } from '../Particles.js';
import { MenuDrive, SLOWMO } from './MenuDrive.js';
import { season, applySeasonLight, SEASONS } from '../Seasons.js';
import { applyAtmosphere, setFogRange, MENU_ATMOSPHERE, PRESETS } from '../Atmosphere.js';
import { buildHome, buildLogo, placeLogo, LOGO } from './HomeScene.js';
import { LogoPhysics } from './LogoPhysics.js';
import { SeasonFlow, prepareSeasonFlow } from './SeasonFlow.js';
import { foldify } from './Fold.js';
import HOME from '../../config/home.js';
import { addFoldCenters } from './Fold.js';

// The places of the menu (Showroom.js shows one at a time, the car being the
// only thing they share; going from one to another folds the scene away and
// unfolds the next):
//   HomeSet   the car parked on a rally corner set by hand (config/home.js), camera still
//   GarageSet a white floor and a low plinth under the car, nothing else
//   DriveSet  the car racing down an endless stage in slow motion (Solo), with
//             two more cars in the multiplayer screens
//
// A set: group (everything that folds), rig (the car's frame on its ground,
// what the camera's poses are written in: road under the car, +Z its way),
// enter( car ) / leave(), update( dt ), light( showroom ) (sun, sky, fog),
// reach (m the fold wave must cover), cinematic (camera = the shot edit).

// Camera at rest, in the car's frame (+Z = the car's nose, y from the road):
// a three-quarter front view, the car in the middle of the screen
export const REST = { pos: [ - 2.35, ROAD_Y + 0.9, 3.55 ], look: [ 0, ROAD_Y + 0.28, 0 ], fov: 33 };

const MENU_FOG = [ 18, 42 ];
const SEASON_LIGHT_TIME = 1.6; // s for the light to turn to the new season's
const HOME_SHADOW = 18; // m each side of the car: the sun's shadow box at home (8 elsewhere)

function rallyLight( showroom, seasonId ) {

	const { scene, renderer, sun, ambient } = showroom;
	applyAtmosphere( { scene, renderer, sun, ambient }, {}, MENU_ATMOSPHERE );
	setFogRange( scene, MENU_FOG[ 0 ], MENU_FOG[ 1 ], MENU_ATMOSPHERE );
	applySeasonLight( seasonId, sun, ambient );

}

// How far from the car the fold wave must go in the rally sets: the fog's
// end counts from the camera, which stands a few metres from the car
function rallyReach() {

	return MENU_FOG[ 1 ] / ( MENU_ATMOSPHERE.fog.density || 1 ) + 10;

}

// ─── Rally sets ─────────────────────────────────────────────

class StageSet {

	// options: { models, props, ultra, seasonId, stageOptions }
	constructor( options ) {

		this.options = options;
		this.group = new THREE.Group();
		this.stage = null;
		this.drive = null;
		this.smoke = null;
		this.car = null;
		this.reach = rallyReach();

	}

	get rig() {

		return this.drive.rig;

	}

	// A fresh stage in the current season (the old one goes)
	build( start ) {

		if ( this.stage ) this.stage.destroy();
		const { models, seasonId, stageOptions } = this.options;
		const seed = Math.floor( Math.random() * 1e6 );
		this.stage = new RallyStage( this.group, null, models, seed, 'varied', 0, { ...stageOptions, seasonId } );
		const drive = new MenuDrive( this.stage, start );
		if ( this.drive ) drive.lane = this.drive.lane;
		this.drive = drive;
		if ( this.car ) drive.setModel( this.car );

		if ( this.smoke ) {

			// The season's dust, powder snow where the snow lies up high
			const stage = this.stage;
			this.smoke.color.set( season( seasonId ).dust );
			this.smoke.colorAt = stage.snow ? ( x, y, z ) => stage.snowyAt( x, y - ROAD_Y, z ) ? SEASONS.winter.dust : null : null;

		}

	}

	// A new season: the stage is rebuilt in it at the next refresh() (when
	// nothing of it shows: the empty moment of a change of place)
	setSeason( id ) {

		if ( id === this.options.seasonId ) return;
		this.options.seasonId = id;
		this.stale = true;

	}

	refresh() {

		if ( ! this.stale ) return;
		this.stale = false;
		this.rebuild();

	}

	light( showroom ) {

		rallyLight( showroom, this.options.seasonId );
		showroom.setFar( this.reach + 6 );
		showroom.setShadowBox();
		showroom.setBloom( 1 );

	}

	enter( car ) {

		this.car = car;
		this.drive.setModel( car );
		this.drive.place( 0 );

	}

	leave() {

		this.car = null;

	}

}

// Home: the rally corner of config/home.js (made in lab/home.html), the car
// parked where it says, the camera still where it says. Its own season and
// light: the menu's season only changes the racing stage
// The home's season order (the Saison button)
export const HOME_SEASONS = [ 'summer', 'autumn', 'winter', 'spring' ];

export class HomeSet {

	// options: { models, ultra, seasonId (the home's own season, the Saison button) }
	constructor( { models, ultra, seasonId } ) {

		const data = HOME;
		this.data = data;
		this.models = models;
		this.ultra = ultra;
		this.sway = true; // the camera leans after the mouse (Showroom.swayCamera)
		this.group = new THREE.Group();
		// The place itself, per season (built when first shown, then kept; a
		// second copy when that season is still in the pile when asked again):
		// a season change spreads the new one over the old (SeasonFlow)
		this.worlds = new Map();
		this.seasonId = HOME_SEASONS.includes( seasonId ) ? seasonId : data.season || 'summer';
		this.world = this.worldOf( this.seasonId );
		this.group.add( this.world );
		this.flow = new SeasonFlow();
		// The 3D logo behind the car, once its letters are loaded (Showroom awaits it)
		this.logoSpec = { ...LOGO, ...data.logo };
		this.ready = buildLogo( this.logoSpec ).then( ( mesh ) => {

			this.logo = mesh;
			this.physics = new LogoPhysics( mesh ); // the mouse knocks its letters about
			this.group.add( mesh );
			this.fitLogo();

		} ).catch( ( e ) => console.warn( 'Home: no 3D logo', e ) );
		this.rig = new THREE.Object3D();
		this.rig.position.set( data.car.x, 0, data.car.z );
		this.rig.rotation.set( 0, data.car.rot || 0, 0 );
		this.rig.updateMatrixWorld();

		// The camera's world pose, written in the car's frame
		const inv = this.rig.matrixWorld.clone().invert();
		const c = data.camera;
		this.rest = {
			pos: new THREE.Vector3().fromArray( c.pos ).applyMatrix4( inv ).toArray(),
			look: new THREE.Vector3().fromArray( c.target ).applyMatrix4( inv ).toArray(),
			fov: c.fov || REST.fov,
		};

		const preset = PRESETS[ data.atmosphere?.preset ] || MENU_ATMOSPHERE;
		this.atmosphere = { ...preset, fog: { ...preset.fog, density: data.atmosphere?.fog ?? preset.fog.density } };
		this.reach = this.atmosphere.fog.density > 0 ? MENU_FOG[ 1 ] / this.atmosphere.fog.density + 10 : 60;

	}

	// Theme selected away from the home: prepare it for the next visit.
	setSeason( id, showroom ) {

		if ( id === this.seasonId ) return;
		this.endFlow();
		this.group.remove( this.world );
		this.seasonId = id;
		this.world = this.worldOf( id );
		foldify( this.world, showroom.setChannel );
		this.group.add( this.world );
		this.fitLogo();

	}

	// A world of that season not on screen in the pile (the first one by default)
	worldOf( id, free = false ) {

		const list = this.worlds.get( id ) || [];
		this.worlds.set( id, list );
		let world = free ? list.find( ( w ) => w !== this.world && ! this.flow?.has( w ) ) : list[ 0 ];
		if ( ! world ) {

			world = buildHome( { ...this.data, season: id }, this.models, { ultra: this.ultra } );
			prepareSeasonFlow( world );
			list.push( world );

		}

		return world;

	}

	// The logo right behind the car (whatever its size), the props in its letters hidden
	fitLogo() {

		if ( this.logo ) placeLogo( this.logo, this.data, this.car, this.logoSpec, [ ...this.worlds.values() ].flat() );

	}

	light( showroom ) {

		this.camera = showroom.camera; // the logo's letters are hit through it
		const { scene, renderer, sun, ambient } = showroom;
		applyAtmosphere( { scene, renderer, sun, ambient }, {}, this.atmosphere );
		if ( this.atmosphere.fog.density > 0 ) setFogRange( scene, MENU_FOG[ 0 ], MENU_FOG[ 1 ], this.atmosphere );
		applySeasonLight( this.seasonId, sun, ambient );
		showroom.setFar( this.reach + 6 );
		showroom.setBloom( 1 );
		showroom.setShadowBox( HOME_SHADOW ); // the trees behind the car cast theirs too

	}

	// The Saison button: the next season spreads from under the car over the
	// world, the light turning with it. Resolves with the new season's id
	// The Saison button: the next season spreads from under the car over the
	// world, the light turning with it. Clicked again while one spreads, the
	// next one spreads inside it (a new layer of the flow): nothing waits,
	// nothing is cut short. Resolves with the new season's id
	async nextSeason( showroom ) {

		const id = HOME_SEASONS[ ( HOME_SEASONS.indexOf( this.seasonId ) + 1 ) % HOME_SEASONS.length ];
		const from = this.world, to = this.worldOf( id, true );
		this.fitLogo();
		foldify( to, showroom.setChannel );
		const origin = new THREE.Vector3( this.data.car.x, ROAD_Y, this.data.car.z );
		const layer = this.flow.start( from, to, origin, this.reach );
		this.group.add( to );
		this.world = to;
		this.seasonId = id;

		// The light, from where it is now (maybe half way to the last season's) to the new one's
		const { sun, ambient } = showroom;
		const grab = () => ( { sun: sun.color.clone(), sunI: sun.intensity, sky: ambient.color.clone(), ground: ambient.groundColor.clone(), skyI: ambient.intensity } );
		const before = grab();
		this.light( showroom );
		this.lights = { from: before, to: grab(), sun, ambient };
		this.tintLight( 0 );

		// Its shaders compiled before it starts spreading (no hitch on the way)
		try {

			await showroom.renderer.compileAsync?.( to, showroom.camera, showroom.scene );

		} catch {}

		if ( ! this.flow.has( to ) ) return id; // ended meanwhile (the home left)
		layer.go = true;
		// When its front sweeps under the camera (no noise: its middle), for the woosh
		const cam = showroom.camera.position;
		const field = Math.hypot( cam.x - origin.x, ( cam.y - origin.y ) * 1.4, cam.z - origin.z );
		showroom.onSeasonFlow?.( this.flow.timeTo( field ) );
		return id;

	}

	tintLight( t ) {

		const { from, to, sun, ambient } = this.lights;
		sun.color.copy( from.sun ).lerp( to.sun, t );
		sun.intensity = THREE.MathUtils.lerp( from.sunI, to.sunI, t );
		ambient.color.copy( from.sky ).lerp( to.sky, t );
		ambient.groundColor.copy( from.ground ).lerp( to.ground, t );
		ambient.intensity = THREE.MathUtils.lerp( from.skyI, to.skyI, t );

	}

	// Done or cut short (leaving the home): the newest season everywhere
	endFlow() {

		for ( const old of this.flow.finish() ) this.group.remove( old );
		if ( this.lights ) this.tintLight( 1 );
		this.lights = null;

	}

	enter( car ) {

		car.position.set( this.data.car.x, ROAD_Y, this.data.car.z );
		car.rotation.set( 0, this.data.car.rot || 0, 0 );
		this.car = car;
		this.fitLogo();

	}

	leave() {

		this.endFlow();

	}

	update( dt ) {

		this.physics?.update( dt, this.camera );

		if ( this.flow.running ) {

			for ( const old of this.flow.update( dt ) ) this.group.remove( old );
			if ( this.flow.running ) {

				if ( this.lights ) this.tintLight( Math.min( 1, this.flow.top.time / SEASON_LIGHT_TIME ) );

			} else this.endFlow();

		}

	}

}

// Solo and multiplayer: racing down the stage
export class DriveSet extends StageSet {

	constructor( options ) {

		super( options );
		this.cinematic = true;
		if ( options.props ) this.smoke = new SmokeTrails( this.group );
		this.others = []; // { drive, model, smoke }: the multiplayer backdrop's other cars
		this.crowd = false;
		this.build( 40 );
		this.drive.park();

	}

	rebuild() {

		this.build( 40 );
		this.drive.park();
		for ( const o of this.others ) o.drive.stage = this.stage;
		this.placeOthers();

	}

	// Multiplayer: two more cars (models loaded by the showroom), one ahead
	// and one behind, on lanes of their own
	setOthers( models ) {

		for ( const o of this.others ) {

			this.group.remove( o.model );
			if ( o.smoke ) for ( const m of o.smoke.meshes ) this.group.remove( m );

		}

		this.others = models.map( ( model, i ) => {

			const drive = new MenuDrive( this.stage );
			drive.setModel( model );
			drive.lane = i === 0 ? 0.55 : - 0.55;
			this.group.add( model );
			const smoke = this.options.props ? new SmokeTrails( this.group ) : null;
			if ( smoke ) smoke.color.copy( this.smoke.color );
			return { drive, model, smoke };

		} );

		this.placeOthers();

	}

	placeOthers() {

		const [ ahead, behind ] = this.others;
		if ( ahead ) {

			ahead.drive.stage = this.stage;
			ahead.drive.park( this.drive.s + 8 );

		}

		if ( behind ) {

			behind.drive.stage = this.stage;
			behind.drive.park( Math.max( 1, this.drive.s - 7 ) );

		}

		this.drive.leader = ahead ? ahead.drive : null;
		if ( behind ) behind.drive.leader = this.drive;

	}

	// crowd: the other cars race too (multiplayer)
	enter( car, { crowd = false } = {} ) {

		super.enter( car );
		this.crowd = crowd;
		for ( const o of this.others ) o.model.visible = crowd;
		if ( crowd ) this.placeOthers();
		else this.drive.leader = null;

	}

	leave() {

		super.leave();
		this.drive.park();
		for ( const o of this.others ) o.drive.park();

	}

	// Off they go, once the scene is there
	launch() {

		this.drive.launch();
		if ( this.crowd ) for ( const o of this.others ) o.drive.launch();

	}

	update( dt ) {

		this.drive.update( dt );
		if ( this.crowd ) for ( const o of this.others ) o.drive.update( dt );
		if ( this.drive.parked ) return; // nothing streams while it stands (a scene change)
		this.stage.update( dt * SLOWMO, this.drive.position, false ); // streams road, terrain, trees; the crowd in slow motion too
		if ( this.smoke ) this.smoke.update( dt * SLOWMO, this.drive );
		if ( this.crowd ) for ( const o of this.others ) if ( o.smoke ) o.smoke.update( dt * SLOWMO, o.drive );

	}

}

// ─── Garage ─────────────────────────────────────────────────

export const FLOOR = '#f4f4f2'; // the garage's white (also what the ground turns to between places, Fold.js)
const STEP = 0.11; // m: the plinth's height
const PLINTH = 2 / 3; // its footprint: the car + a margin, scaled down
const RISE_DELAY = 0.5, RISE_TIME = 0.85, SINK_TIME = 0.55; // s: the plinth coming out of the floor (after the white is everywhere), going back in

export class GarageSet {

	constructor() {

		this.group = new THREE.Group();
		this.sway = true; // the camera leans after the mouse, as at home (Showroom.swayCamera)
		this.rig = new THREE.Object3D();
		this.rig.position.set( 0, STEP - ROAD_Y, 0 ); // the car (its wheels at the rig's ROAD_Y) stands on the plinth
		this.rig.updateMatrixWorld();
		this.reach = 26;

		// The floor: a disc of small triangles (they fold one by one), fading into the white
		const floorMaterial = new THREE.MeshStandardMaterial( { color: FLOOR, roughness: 0.92, metalness: 0 } );
		const floor = new THREE.Mesh( addFoldCenters( new THREE.CircleGeometry( 30, 96, 0, Math.PI * 2 ).rotateX( - Math.PI / 2 ) ), floorMaterial );
		floor.receiveShadow = true;
		floor.userData.floor = true; // white already: the place changes leave it as it is
		this.floor = floor;
		this.group.add( floor );
		this.subdivideFloor();

		// The plinth: one low step, edges softened by a chamfer
		const plinthMaterial = new THREE.MeshStandardMaterial( { color: '#ffffff', roughness: 0.75, metalness: 0 } );
		this.plinth = new THREE.Mesh( this.plinthGeometry( 3.4, 4.6 ), plinthMaterial );
		this.plinth.castShadow = this.plinth.receiveShadow = true;
		this.plinth.userData.folded = true; // never shrinks: it rises out of the floor and sinks back (lift)
		this.group.add( this.plinth );
		this.lift = 1; // 0: sunk in the floor (the car on the floor), 1: up (the car on it)
		this.rise = null;

	}

	// The circle's long thin fan triangles fold badly: rings of ~1 m instead
	subdivideFloor() {

		const geometry = new THREE.RingGeometry( 0, 30, 96, 30 ).rotateX( - Math.PI / 2 );
		this.floor.geometry.dispose();
		this.floor.geometry = addFoldCenters( geometry );

	}

	// A rounded rectangle ( w × d ) extruded STEP high, with a bevel
	plinthGeometry( w, d ) {

		const r = 0.24, x = w / 2, z = d / 2;
		const shape = new THREE.Shape();
		shape.moveTo( - x + r, - z );
		shape.lineTo( x - r, - z );
		shape.quadraticCurveTo( x, - z, x, - z + r );
		shape.lineTo( x, z - r );
		shape.quadraticCurveTo( x, z, x - r, z );
		shape.lineTo( - x + r, z );
		shape.quadraticCurveTo( - x, z, - x, z - r );
		shape.lineTo( - x, - z + r );
		shape.quadraticCurveTo( - x, - z, - x + r, - z );
		const bevel = 0.025;
		const geometry = new THREE.ExtrudeGeometry( shape, { depth: STEP - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 } );
		geometry.rotateX( - Math.PI / 2 ).translate( 0, bevel, 0 );
		return addFoldCenters( geometry );

	}

	// Fits the plinth to the car (its footprint + a margin)
	fit( car ) {

		const box = new THREE.Box3();
		const yaw = car.rotation.y;
		car.rotation.y = 0;
		car.updateMatrixWorld( true );
		car.traverse( ( c ) => { if ( c.isMesh ) box.expandByObject( c, true ); } ); // meshes only: not the beams' targets far ahead
		car.rotation.y = yaw;
		const size = box.getSize( new THREE.Vector3() );
		const w = Math.max( 1.6, ( size.x + 1.1 ) * PLINTH ), d = Math.max( 2.3, ( size.z + 1.3 ) * PLINTH );
		if ( this.plinthSize && Math.abs( this.plinthSize[ 0 ] - w ) < 0.05 && Math.abs( this.plinthSize[ 1 ] - d ) < 0.05 ) return;
		this.plinthSize = [ w, d ];
		this.plinth.geometry.dispose();
		this.plinth.geometry = this.plinthGeometry( w, d );

	}

	light( showroom ) {

		const { scene, renderer, sun, ambient } = showroom;
		renderer.toneMappingExposure = 1.05;
		scene.background = new THREE.Color( FLOOR );
		scene.fog = new THREE.Fog( FLOOR, 9, 24 );
		sun.color.set( '#ffffff' );
		sun.intensity = 2.6;
		ambient.color.set( '#ffffff' );
		ambient.groundColor.set( '#c9ccd4' );
		ambient.intensity = 2.4;
		showroom.setFar( 40 );
		showroom.setShadowBox();
		showroom.setBloom( 0.5 ); // on white, the headlights' halo spread too far

	}

	// Arriving (not a car or livery change once here): the plinth comes out
	// of the floor under the car, lifting it
	enter( car ) {

		this.car = car;
		car.rotation.set( 0, 0, 0 );
		this.fit( car );
		if ( ! this.here ) {

			this.here = true;
			this.rise = { from: 0, to: 1, time: - RISE_DELAY, duration: RISE_TIME };
			this.setLift( 0 );

		} else this.setLift( this.lift );

	}

	// Going: it sinks back, the car coming down with it
	leave() {

		this.here = false;
		this.rise = { from: this.lift, to: 0, time: 0, duration: SINK_TIME };

	}

	setLift( k ) {

		this.lift = k;
		this.plinth.position.y = - ( STEP + 0.02 ) * ( 1 - k );
		if ( this.car ) this.car.position.set( 0, STEP * k, 0 );

	}

	update( dt ) {

		const r = this.rise;
		if ( ! r ) return;
		r.time += dt;
		const t = Math.min( 1, Math.max( 0, r.time / r.duration ) );
		const e = r.to > r.from ? 1 - Math.pow( 1 - t, 3 ) : t * t; // up: eases in to rest; down: drops away
		this.setLift( r.from + ( r.to - r.from ) * e );
		if ( t >= 1 ) this.rise = null;

	}

}
