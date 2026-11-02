import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { LightProbeGridHelper } from 'three/addons/helpers/LightProbeGridHelper.js';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Vehicle, MAX_SPEED } from './Vehicle.js';
import { Camera } from './Camera.js';
import { Sky } from './Sky.js';
import { Controls } from './Controls.js';
import { buildTrack, decodeCells, computeSpawnPosition, computeTrackBounds, TRACK_CELLS } from './Track.js';
import { buildWallColliders, buildSplineWallColliders, createGroundProxy, createSphereBody } from './Physics.js';
import { TrackPath, decodeTrack, splineSpawn, splineBounds, splineLapConfig, roadPieces, ROAD_Y } from './SplineTrack.js';
import { CIRCUIT_BUDGET, shouldBakeCircuitProbes } from './CircuitBudget.js';
import { buildSplineTrack } from './TrackScene.js';
import { dressGridTrack, gridTrackModels, gridForest, pathFromCells } from './CircuitDressing.js';
import { Terrain } from './Terrain.js';
import { SmokeTrails } from './Particles.js';
import { DriftMarks } from './DriftMarks.js';
import { GameAudio } from './Audio.js';
import { LapTimer, gridLapConfig } from './LapTimer.js';
import { ColorMapGLTFLoader } from './Loader.js';
import { loadKit, loadNature } from './Kit.js';
import { RallyStage } from './RallyStage.js';
import { landscapeOf } from './RallyBiomes.js';
import { loadCar, findCar } from './Cars.js';
import { loadSettings, saveSettings, saveBest, loadBest } from './Settings.js';
import { MenuMusic } from './menu/MenuMusic.js';
import { BetaHUD } from './BetaHUD.js';
import { BETA_METRES_PER_WORLD } from './RaceUnits.js';
import { YarisWallGuard } from './YarisWallGuard.js';
import { getAccount } from './Account.js';
import { YARIS_CAR, YARIS_TRACK_ID, stretchYaris } from './YarisMode.js';
import { createUltraEffects, createDofPass, setDof, setFocus } from './Ultra.js';
import { season, applySeasonLight, seasonScenery, SEASONS } from './Seasons.js';
import { CircuitOnline } from './CircuitOnline.js';
import { listenKonami, isBoostUnlocked, COUNT_BOOSTED } from './Boost.js';
import { fetchPublished } from './Circuits.js';
import { applyAtmosphere, setFogRange } from './Atmosphere.js';
import { GameUI } from './GameUI.js';
import { RaceStart } from './RaceStart.js';
import { LaunchBurnout } from './LaunchBurnout.js';
import { themeSeason } from './Theme.js';
import { AdaptiveResolution } from './AdaptiveResolution.js';
import { FrameMonitor } from './FrameMonitor.js';
import { PageLoading, leavePage } from './PageTransition.js';
import { GamepadUI, PAD } from './Gamepad.js';
import { FlyingStart, runUpStart } from './FlyingStart.js';
import { ControlsHint } from './ControlsHint.js';
import { t, ordinal } from './i18n.js';
import { GhostRecorder } from './Ghost.js';
import { submitLap, dailyBoardId } from './Leaderboard.js';
import { useHudTheme } from './HudTheme.js';
import { trackView, trackRace, trackFinish } from './Stats.js';
import { isOfficialPublished } from './multi/Protocol.js';


// Physics runs at a fixed rate whatever the display (see animate)
const PHYSICS_STEP = 1 / 120; // s
const OFFROAD_SPEED = 0.62; // rally: top speed on the grass, share of the road's
const RESET_PENALTY = 5; // s added when the car is put back on the road
const SPECTATOR_PENALTY = 10; // s added for running into a spectator...
const SPECTATOR_GRACE = 2; // s: ...once per impact (a crowd knocked over together counts once)
const FALL_DEPTH = 2.5; // m below the road level nearby: the car has gone over the edge
const LOST_DISTANCE = 30; // m off the dirt: too far to count as a line
const CHASE_ULTRA_REACH = 2; // Ultra, third-person view: everything twice as far (far plane, rally fog, streaming)
const OFF_TRACK_TIME = 3; // s with no wheel on the dirt: put back on the road
const STUCK_TIME = 2; // s pressing the controls without moving: put back too
const STUCK_SPEED = 0.4; // u/s under which the car counts as not moving
// At most this much game time per drawn frame: a hitch (GC, shader compile)
// slows the game down for an instant instead of making the car jump ahead.
// Fair either way: the lap clock counts physics steps.
const MAX_FRAME_TIME = 1 / 30; // s

const RALLY_SHADOW_EXTENT = 30; // m around the car
const RALLY_SHADOW_MAP = 2048;
const CIRCUIT_SHADOW_EXTENT = 65; // shadow radius around the car, independent of circuit size
const PROBE_SIDE = 420; // m: circuits up to the old 400 m terrain keep a probe every 16 m
const BIG_PROBE_CELLS = 10; // past it, this many probes along the longest side (a cube map each: 1 350 took 35 s)
const PROBE_FAR = 450; // m, what a probe sees at most

// Performance mode (menu Paramètres) for low-end PCs: no trees or props, no
// shadows, bloom, antialiasing or smoke, pixel ratio 1, low-latency canvas
const lowSpec = loadSettings().performance;
// Ultra: sun shafts through the air + ambient occlusion (Ultra.js), set up once the camera exists
const ultra = loadSettings().graphics === 'ultra';
let bloomPass = null;

const renderer = lowSpec ? createLowLatencyRenderer() : new THREE.WebGLRenderer( { antialias: true, outputBufferType: THREE.HalfFloatType } );
renderer.setSize( window.innerWidth, window.innerHeight );
// Pixel ratio capped at 2 (1 in performance mode), then lowered/raised to hold the frame rate
const resolution = new AdaptiveResolution( renderer, lowSpec ? 1 : undefined );
renderer.shadowMap.enabled = ! lowSpec;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

// Ultra only (it joins Ultra's effect chain below). In Normal the faint
// bloom (strength 0.02, invisible side by side) put every frame through the
// HalfFloat post-processing chain instead of drawing straight to the
// canvas: ~11 ms per frame on an Intel HD 520
if ( ultra && ! lowSpec ) {

	bloomPass = new UnrealBloomPass( new THREE.Vector2( window.innerWidth, window.innerHeight ) );
	bloomPass.strength = 0.02;
	bloomPass.radius = 0.02;
	bloomPass.threshold = 0.5;

	renderer.setEffects( [ bloomPass ] );

}

// A desynchronized context lets the browser show a frame without waiting for
// the compositor (less input lag, possible tearing); plain renderer if refused
function createLowLatencyRenderer() {

	const canvas = document.createElement( 'canvas' );
	const context = canvas.getContext( 'webgl2', { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', desynchronized: true } );
	return context ? new THREE.WebGLRenderer( { canvas, context } ) : new THREE.WebGLRenderer( { antialias: false, powerPreference: 'high-performance' } );

}

document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
const dirLight = new THREE.DirectionalLight();
dirLight.position.set( 11.4, 15, -5.3 );
dirLight.castShadow = true;
dirLight.shadow.mapSize.setScalar( 4096 );
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 60;
dirLight.shadow.radius = 4;
scene.add( dirLight );

const hemiLight = new THREE.HemisphereLight();
hemiLight.position.copy( dirLight.position )
scene.add( hemiLight );

// Sun tint, ambient light, brightness, fog colour and density: config/atmosphere.js
applyAtmosphere( { scene, renderer, sun: dirLight, ambient: hemiLight } );
setFogRange( scene, 30, 55 );


let pausedFrameDrawn = false; // paused: draw one frame, then idle

window.addEventListener( 'resize', () => {

	renderer.setSize( window.innerWidth, window.innerHeight );
	pausedFrameDrawn = false;

} );

// Back from a hidden tab: the long gap must not count as a slow frame
document.addEventListener( 'visibilitychange', () => resolution.reset() );

const loader = new ColorMapGLTFLoader();

const modelNames = [
	'vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red',
	'track-straight', 'track-corner', 'track-bump', 'track-finish',
	'decoration-empty', 'decoration-forest', // never decoration-tents (the user doesn't want that tile)
];

const models = {};

async function loadModels() {

	const promises = modelNames.map( ( name ) =>
		new Promise( ( resolve, reject ) => {

			loader.load( `models/${ name }.glb`, ( gltf ) => {

				const meshes = [];
				gltf.scene.traverse( ( child ) => {

					if ( child.isMesh ) {

						child.material.side = THREE.FrontSide;
						meshes.push( child );

					}

				} );

				// Godot imports vehicle models at root_scale=0.5
				if ( name.startsWith( 'vehicle-' ) ) {

					gltf.scene.scale.setScalar( 0.5 );

				}

				if ( meshes.length === 1 ) {

					const mesh = meshes[ 0 ];
					mesh.removeFromParent();
					models[ name ] = mesh;

				} else {

					models[ name ] = gltf.scene;

				}

				resolve();

			}, undefined, reject );

		} )
	);

	// All at once: one after the other they stacked up their network round trips
	[ models.kit, models.nature ] = await Promise.all( [
		loadKit( loader ), // Kenney racing kit: arches, stands, flags… (null if missing)
		loadNature( loader ), // Kenney nature kit: pines, bushes, stumps, tents, campfires (null if missing)
		...promises,
	] );

}

// The loading bar of the page transition: each step's share of the bar
const loading = new PageLoading( { files: 40, build: 15, bake: 20, shaders: 20, frame: 5 }, {
	ui: () => [ ...document.body.children ].filter( ( el ) => el !== renderer.domElement && el.tagName !== 'SCRIPT' ), // the HUD
} );

async function init() {
 const loadStarted = performance.now();
 let circuitPerformance = null;

	trackView( 'play' );
	registerAll();
	// Load the environment alongside the selected car and room/track data.
	// Capture failures immediately, including when an invalid lobby exits early.
	const modelsRequest = loadModels().then( () => ( {} ), ( error ) => ( { error } ) );

	// Circuits drawn in an editor (track=, map=) come after the # (play.html#track=…):
	// the fragment never reaches the server, so no "URI too large" however big the
	// circuit. Old ?track= links still work.
	const pageParams = new URLSearchParams( window.location.search );
	for ( const [ key, value ] of new URLSearchParams( window.location.hash.slice( 1 ) ) ) pageParams.set( key, value );

	// ?lobby=<code>: a multiplayer race; the race chosen by the lobby becomes the usual parameters
	let multi = null;

	if ( pageParams.has( 'lobby' ) ) {

		const { joinLobbyRace, raceParams } = await import( './multi/LobbyRace.js' );

		try {

			multi = await joinLobbyRace();

		} catch ( e ) {

			showLobbyError( e.message );
			return;

		}

		multi.params = raceParams( multi.race, multi.you );

	}

	const params = multi ? multi.params : pageParams;
	const betaMode=multi ? multi.race.mode==='beta' : params.get('beta')==='1';
 if(betaMode && !(await getAccount({refresh:true}))?.beta) throw new Error('Нужен доступ бетатестера.');
 const yarisMode = multi ? multi.race.yaris || multi.race.mode === 'yaris' : params.get( 'mode' ) === 'yaris';

	// The car chosen in the garage (Settings.js), or ?car=<name>&color=<livery>:
	// fetched and decrypted while the circuit is built
	const settings = loadSettings();
	const carId = yarisMode ? YARIS_CAR : params.get( 'car' ) || settings.car;
	const carColor = yarisMode ? 1 : Number( params.get( 'color' ) ) || settings.color;
	const carRequest = loadCar( loader, carId, carColor ).then( ( model ) => ( { model } ), ( error ) => ( { error } ) );

	let trackParam = params.get( 'track' );

	// ?circuit=<id>: a circuit published from the editor, fetched from the server
	const circuitParam = params.get( 'circuit' );

	if ( ! trackParam && /^[a-f0-9]{64}$/.test( circuitParam || '' ) ) {

		const res = await fetchPublished( circuitParam );
		if ( res.ok ) trackParam = res.data.data;
		else if ( multi ) {

			// Never race a different track from the others
			showLobbyError( 'Трасса не найдена (' + res.error + ')' );
			return;

		} else console.warn( 'Published circuit unavailable: ' + res.error );

	}

	const mapParam = params.get( 'map' );
	const rallyParam = params.get( 'rally' );
	let rallySeed = null;
	const rallySeason = themeSeason( settings, params.get( 'season' ) );
	const rallyLandscape = landscapeOf( params.get( 'landscape' ) ); // ?landscape=low|high (old ?style= links: ignored)
	let customCells = null;
	let path = null;
	let terrain = null;
	let spawn = null;
	// ?test (menu des salons → « Mode test »): solo on a flat oval without trees,
	// bots and bonuses on buttons (bonus/TestBench.js)
	const testMode = ! multi && pageParams.has( 'test' );
	// ?daily (menu, tuile « Défi du jour »): this run's lap goes to the daily
	// challenge's own leaderboard (its id, not the circuit's own) — solo only
	const dailyMode = ! multi && ! testMode && ! betaMode && pageParams.has( 'daily' );
	// What is raced, for the audience stats (Stats.js)
	const raceMode = yarisMode ? 'yaris' : testMode ? 'test' : dailyMode ? 'daily' : multi ? ( multi.race.bonus ? 'bonus' : 'multi' ) : rallyParam !== null ? 'rally'
		: circuitParam ? ( isOfficialPublished( circuitParam ) ? 'official' : 'community' ) : trackParam || mapParam ? 'drawn' : 'official';

	if ( testMode ) {

		const { testPath } = await import( './bonus/TestBench.js' );
		path = testPath();
		spawn = splineSpawn( path );
		terrain = new Terrain();
		terrain.conform( path );

	} else if ( rallyParam !== null ) {

		// ?rally → random stage, ?rally=<seed> → that stage. The seed goes in
		// the URL so a stage can be replayed or shared.
		rallySeed = parseInt( rallyParam, 10 );
		if ( ! Number.isFinite( rallySeed ) ) rallySeed = Math.floor( Math.random() * 1e6 );
		params.set( 'rally', rallySeed );
		if ( ! multi ) history.replaceState( null, '', '?' + params );

	} else if ( trackParam ) {

		try {

			const data = await decodeTrack( trackParam );
			path = new TrackPath( data.nodes, data.closed );
			if ( path.length < 1 ) throw new Error( 'Empty track' );
			spawn = splineSpawn( path );

			terrain = Terrain.fromData( data.terrain );
			terrain.conform( path );

		} catch ( e ) {

			path = null;
			terrain = null;
			console.warn( 'Invalid track parameter, using default track' );

		}

	} else if ( mapParam ) {

		try {

			customCells = decodeCells( mapParam );
			spawn = computeSpawnPosition( customCells );

		} catch ( e ) {

			console.warn( 'Invalid map parameter, using default track' );

		}

	}

	// Compute track bounds and size physics/shadows to fit
	// The rally stage is endless: size lights/fog/probes for the area around the car
	const bounds = rallySeed !== null ? { centerX: 0, centerZ: 0, halfWidth: 30, halfDepth: 30 }
		: path ? splineBounds( path ) : computeTrackBounds( customCells );
	const hw = bounds.halfWidth;
	const hd = bounds.halfDepth;
	const groundSize = Math.max( hw, hd ) * 2 + 20;

	// Ground height range over the play area (flat for grid tracks)
	const area = {
		x0: bounds.centerX - hw - 10, x1: bounds.centerX + hw + 10,
		z0: bounds.centerZ - hd - 10, z1: bounds.centerZ + hd + 10,
	};
	const relief = terrain ? terrain.range( area.x0, area.z0, area.x1, area.z1 ) : { min: 0, max: 0 };

	// The road counts too: a circuit all on piers leaves the ground flat while
	// the road climbs, and a flat ground box would let the car drive under it
	if ( terrain && path ) {

		for ( let k = 0; k < path.sampleCount; k ++ ) {

			relief.min = Math.min( relief.min, path.py[ k ] );
			relief.max = Math.max( relief.max, path.py[ k ] );

		}

	}

	const hasRelief = relief.max - relief.min > 0.01 || Math.abs( relief.min ) > 0.01;

	// Rally: the shadow box follows the car, so it only has to cover the view;
	// a smaller box keeps the same sharpness with a quarter of the shadow map
	// (it follows the car: past CIRCUIT_SHADOW_EXTENT a big circuit's shadows only got blurrier)
	const shadowExtent = rallySeed !== null ? RALLY_SHADOW_EXTENT : Math.min( CIRCUIT_SHADOW_EXTENT, Math.max( hw, hd ) + 10 );
	if ( rallySeed !== null ) dirLight.shadow.mapSize.setScalar( RALLY_SHADOW_MAP );
	dirLight.shadow.camera.left = - shadowExtent;
	dirLight.shadow.camera.right = shadowExtent;
	dirLight.shadow.camera.top = shadowExtent;
	dirLight.shadow.camera.bottom = - shadowExtent;
	dirLight.shadow.camera.updateProjectionMatrix();

	// Rally: see down into the valley below the cliffs
	if ( rallySeed !== null ) setFogRange( scene, 45, 110 );
	else setFogRange( scene, Math.min(groundSize * 0.4,90), Math.min(groundSize * 0.8,180) );

	// Performance mode: decoration tiles become plain grass (no trees, no tents)
	// Test mode: the bare ground, no decoration tiles (their trees) and no dressing
	const modelsResult = await modelsRequest;
	if ( modelsResult.error ) throw modelsResult.error;
	applySeasonLight( rallySeason, dirLight, hemiLight );
	const sceneModels = testMode ? { ...models, kit: null, nature: null, 'decoration-forest': null, 'decoration-empty': null }
		: lowSpec ? { ...models, 'decoration-forest': models[ 'decoration-empty' ] } : models;
	let bridges = null; // spline circuits: they fade while the car is under them
	if ( path ) { const layout = await buildSplineTrack( scene, sceneModels, path, terrain, rallySeason, () => loading.paint() ); bridges = layout.userData.bridges; circuitPerformance = layout.userData.performance; }
	else if ( rallySeed === null ) {

		const gridModels = gridTrackModels( sceneModels, customCells ); // the kit's arch replaces the finish tile's
		const layout = buildTrack( scene, gridModels, customCells );
		seasonScenery( layout.group, rallySeason );
		scene.add( gridForest( gridModels, layout, rallySeason ) );
		dressGridTrack( scene, gridModels, layout, rallySeason );

	}

	loading.set( 'build', 0.6 );
	await loading.paint();

	//

	const worldSettings = createWorldSettings();
	worldSettings.gravity = [ 0, - 9.81, 0 ];

	const BPL_MOVING = addBroadphaseLayer( worldSettings );
	const BPL_STATIC = addBroadphaseLayer( worldSettings );
	const OL_MOVING = addObjectLayer( worldSettings, BPL_MOVING );
	const OL_STATIC = addObjectLayer( worldSettings, BPL_STATIC );

	enableCollision( worldSettings, OL_MOVING, OL_STATIC );
	enableCollision( worldSettings, OL_MOVING, OL_MOVING );

	const world = createWorld( worldSettings );
	world._OL_MOVING = OL_MOVING;
	world._OL_STATIC = OL_STATIC;

	let stage = null;

	if ( rallySeed !== null ) {

		// ?landscape=low|high (RallyBiomes.js), varied otherwise;
		// ?length=<m> for a limited stage (endless without it)
		stage = new RallyStage( scene, world, models, rallySeed, rallyLandscape, Number( params.get( 'length' ) ) || 0, { props: ! lowSpec, ultra, seasonId: rallySeason, forest: ultra && ! multi ? 2 : 1, metresPerWorld: betaMode ? BETA_METRES_PER_WORLD : 1 } ); // Ultra, solo: twice the trees
		stage.autoStream = false; // streamed once per frame in animate(), not every physics step
		spawn = stage.spawn();

	} else if ( path ) buildSplineWallColliders( world, path );
	else buildWallColliders( world, null, customCells );

	// Probes

	loading.set( 'build', 1 );
	await loading.paint();

	// The bake renders a cube map per probe, so its time grows with the
	// circuit's area: a probe every ~16 m on circuits (was 8 m: ~1 000 probes
	// and seconds of loading on a big one, for a light that hardly differs)
	const side = Math.max( hw, hd ) * 2;
	const probeSpacing = rallySeed !== null ? 8 : side <= PROBE_SIDE ? 16 : side / BIG_PROBE_CELLS;
	const probeHeight = 6 + relief.max - relief.min;
	let probes = null;
	if ( ! lowSpec && shouldBakeCircuitProbes(path,terrain) ) {
		probes = new LightProbeGrid(
			hw * 2, probeHeight, hd * 2,
			Math.max( 2, Math.min(CIRCUIT_BUDGET.maxProbeAxis, Math.round( hw * 2 / probeSpacing )) ),
			2,
			Math.max( 2, Math.min(CIRCUIT_BUDGET.maxProbeAxis, Math.round( hd * 2 / probeSpacing )) ),
		);
		probes.position.set( bounds.centerX, relief.min + probeHeight / 2, bounds.centerZ );
		// The kit dressing stays out of the bake: a probe that lands under the
		// arch or inside a stand sees mostly dark and shades a whole probe cell
		// (a dark square on the ground around the start line)
		const unbaked = [];
		scene.traverse( ( o ) => { if ( o.userData.skipProbeBake && o.visible ) unbaked.push( o ); } );
		for ( const o of unbaked ) o.visible = false;
		// The cube faces draw into a render target (linear, no tone mapping), so
		// the bake needs its own shader variants: compiled here in parallel
		// (KHR_parallel_shader_compile) instead of one by one on the first face
		const bakeTarget = new THREE.WebGLRenderTarget( 1, 1 );
		renderer.setRenderTarget( bakeTarget );
		const bakeShaders = loading.compile( 'bake', renderer, scene, new THREE.PerspectiveCamera() );
		renderer.setRenderTarget( null );
		const bakeReady = await bakeShaders;
		bakeTarget.dispose();
		await loading.paint();
		if ( bakeReady ) probes.bake( renderer, scene, { cubemapSize: 32, near: 0.1, far: Math.min( groundSize, PROBE_FAR ) } );
		for ( const o of unbaked ) o.visible = true;
		if ( bakeReady ) scene.add( probes );
		else { probes.dispose?.(); probes = null; }

		// scene.add( new LightProbeGridHelper( probes, 0.5 ) );

	}

	// Ground: a flat box, or on relief a plane kept tangent to the terrain under the car
	let groundBody;
	let groundProxy = null;
	// Where the car's wheels are, in terrain units (sphere radius 0.5)
	const carGroundY = () => vehicle.spherePos.y - 0.5 - ROAD_Y;

	if ( stage ) {

		// The proxy box follows the car, tangent to the road under it
		groundProxy = createGroundProxy( world, ( x, z, normal ) => stage.groundAt( x, z, normal ) );
		groundBody = groundProxy.body;

	} else if ( hasRelief ) {

		// On the road the road itself (the stretch at the car's height where
		// two overlap), off it the terrain: the grid's triangles can't follow
		// a road beside another one at another height
		groundProxy = createGroundProxy( world, ( x, z, normal ) => terrain.groundAt( x, z, carGroundY(), normal ) + ROAD_Y );
		groundBody = groundProxy.body;

	} else {

		const roadHalf = groundSize / 2;
		groundBody = rigidBody.create( world, {
			shape: box.create( { halfExtents: [ roadHalf, 0.01, roadHalf ] } ),
			motionType: MotionType.STATIC,
			objectLayer: OL_STATIC,
			position: [ bounds.centerX, - 0.125, bounds.centerZ ],
			friction: 5.0,
			restitution: 0.0,
		} );

	}

	// Multiplayer: this car's slot on the starting grid, behind the line
	if ( multi ) {

		const { gridFrameFor } = await import( './multi/LobbyRace.js' );
		const { gridSlot } = await import( './multi/StartGrid.js' );
		spawn = gridSlot( multi.slot, gridFrameFor( { path, customCells, stage } ) );

	}

	const sphereBody = createSphereBody( world, spawn ? spawn.position : null, {beta:betaMode} );

	const vehicle = new Vehicle({beta:betaMode});
	vehicle.rigidBody = sphereBody;
	vehicle.physicsWorld = world;
	vehicle.groundBody = groundBody;

	if ( spawn ) {

		const [ sx, sy, sz ] = spawn.position;
		vehicle.spherePos.set( sx, sy, sz );
		vehicle.prevModelPos.set( sx, sy - 0.5, sz );
		vehicle.container.rotation.y = spawn.angle;
		vehicle.spawnPosition.set( sx, sy, sz );
		vehicle.spawnAngle = spawn.angle;

	}

	if ( stage ) {

		vehicle.getGroundNormal = ( x, z, out ) => {

			stage.groundAt( x, z, out );
			return out;

		};
		vehicle.fallY = - 100;

	} else if ( hasRelief ) {

		vehicle.getGroundNormal = ( x, z, out ) => {

			terrain.groundAt( x, z, carGroundY(), out );
			return out;

		};
		vehicle.fallY = relief.min + ROAD_Y - 10;

	}

	let carModel = models[ 'vehicle-truck-yellow' ];
	let playerCar = { id: 'truck', color: 1 }; // what the leaderboard and the ghost show
	const car = await carRequest;

	if ( car.model ) {

		carModel = car.model;
		playerCar = { id: findCar( carId ).id, color: carColor };

	} else {
		if ( yarisMode ) throw car.error; // Never silently race another model in this mode.
		console.warn( car.error.message + ', using the truck' );
	}

	if(carModel?.userData.yarisModel) carModel.userData.yaris=yarisMode;
 const vehicleGroup = vehicle.init( carModel );
 const yarisBounds=carModel?.userData.yarisModel?new THREE.Box3().setFromObject(carModel):null;
 const wallGuard=yarisBounds?new YarisWallGuard(world,{stretch:yarisMode,halfWidth:Math.max(Math.abs(yarisBounds.min.x),Math.abs(yarisBounds.max.x))+.01,halfLength:Math.max(Math.abs(yarisBounds.min.z),Math.abs(yarisBounds.max.z))+.01}):null;
	scene.add( vehicleGroup );
	vehicle.respawn( vehicle.spawnPosition.toArray(), vehicle.spawnAngle );

	dirLight.target = vehicleGroup;

	const cam = new Camera();
	const ultraEffects = ultra ? createUltraEffects( scene, cam.camera, dirLight, 'game' ) : null;
	const dofPass = ultra ? createDofPass( scene, cam.camera, 'game' ) : null; // focused on the car every frame
	if ( dofPass ) setDof( dofPass, loadSettings().dof );
	if ( ultra ) renderer.setEffects( [ ...ultraEffects, dofPass, bloomPass ] );

	if ( stage ) {

		cam.camera.far = 150;
		cam.camera.updateProjectionMatrix();

	}
	scene.add( cam.debug );

	// The view (menu Paramètres → Contrôles, key C / pad Y): from above, or
	// third person behind the car. Solo: the player's choice. Multiplayer: the
	// lobby's camera setting (Protocol.js CAMERAS): from above only, third person
	// only, or 'both' = each racer's choice with the key. Behind the car the horizon shows, so the
	// rally fog closes in before the terrain tiles end (TILE_BUILD_RADIUS 80 m)
	const isoFar = cam.camera.far;
	const raceCamera = multi ? multi.race.camera || 'iso' : 'both';
	let refreshCameraUI = () => {};
	const viewLocked = raceCamera !== 'both';
	let view = raceCamera === 'both' ? settings.view : raceCamera;
	let sky = null; // blue sky and a few clouds, built the first time the view goes behind the car
	const applyView = ( next ) => {

		view = viewLocked ? raceCamera : next === 'chase' ? 'chase' : 'iso';
		cam.setView( view );
		refreshCameraUI();
		const chase = view === 'chase';
		// Ultra sees twice as far behind the car: far plane, rally fog, terrain
		// tiles and chunks streamed around the car, the sky pushed back with it
		const reach = chase && ultra && ! lowSpec ? CHASE_ULTRA_REACH : 1;
		if ( chase && ! sky ) sky = new Sky( scene, ( scene.fog ? scene.fog.color : scene.background ).clone(), { puffy: ultra && ! lowSpec, sun: dirLight, scale: reach } );
		if ( sky ) sky.visible = chase;
		cam.camera.far = chase ? ( stage ? 150 : 180 ) * Math.min(reach,1.5) : isoFar;
		cam.camera.updateProjectionMatrix();
		if ( stage ) {

			setFogRange( scene, chase ? 30 * reach : 45, chase ? 75 * reach : 110 );
			stage.setReach( reach > 1 ? { tileRadius: 80 * reach, ahead: 3 * reach, behind: 3 + reach } : {} );

		}

	};
	applyView( view );
	const selectView = ( next ) => {
		if ( viewLocked ) return;
		applyView( next );
		cam.update( 0, vehicle.spherePos, vehicle.modelVelocity, {
			quaternion: vehicle.container.quaternion, speed: Math.abs( vehicle.linearSpeed ) / MAX_SPEED, groundAt: cameraGround,
		} );
		if ( sky ) sky.follow( cam.camera );
		if ( bridges ) bridges.update( vehicle.spherePos, cam.camera, 1 );
		pausedFrameDrawn = false;
		saveSettings( { ...loadSettings(), view } );
	};
	let viewHeld = false;
	const viewKey = ( raw ) => {

		// The touch stick steers in screen space for the view from above
		if ( raw.touchActive && view === 'chase' ) applyView( 'iso' );
		if ( raw.view && ! viewHeld && ! raw.touchActive && ! viewLocked ) {

			selectView( view === 'chase' ? 'iso' : 'chase' );

		}

		viewHeld = !! raw.view;

	};
	// Ground under the chase camera (it never goes below)
	const cameraGround = stage ? ( x, z ) => stage.surfaceAt( x, z ) : terrain ? ( x, z ) => terrain.heightAt( x, z ) + ROAD_Y : () => ROAD_Y;

	const controls = new Controls();

	const particles = lowSpec ? null : new SmokeTrails( scene, stage ? season( rallySeason ).dust : 0xffffff ); // dust (or powder snow) on the dirt
	// Powder snow where the snow lies up high (the other seasons, RallyStage.snowyAt)
	if ( particles && stage && stage.snow ) particles.colorAt = ( x, y, z ) => stage.snowyAt( x, y - ROAD_Y, z ) ? SEASONS.winter.dust : null;
	const trackId = testMode ? 'test' : stage ? 'rally.' + rallySeed : path ? 'spline.' + trackParam : mapParam;
	const driftMarks = new DriftMarks( scene, trackId );

	const audio = new GameAudio( settings.volume );
	audio.init( cam.camera, vehicleGroup );

	const raceMusic = new MenuMusic( {
		enabled: settings.raceMusic, volume: settings.volume.raceMusic, localPlaylist: true,
		trackIds: yarisMode ? [ YARIS_TRACK_ID ] : null,
	} );
	let yarisTime = 0;

	const lapTimer = new LapTimer( stage ? null : path ? splineLapConfig( path ) : gridLapConfig( customCells ), betaMode?'beta-v3:'+trackId:trackId );
 const betaHUD=betaMode?new BetaHUD({path,customCells,stage}):null;

	// Circuits: online leaderboard and record ghost (the id follows the circuit
	// actually loaded, unless it's the daily challenge: ranked under its own id)
	let circuitFinishTracked = false; // trackFinish once per session, on the first valid lap
	const online = lapTimer.enabled && ! multi && ! testMode && !betaMode ? new CircuitOnline( {
		scene, loader, lapTimer, vehicle,
		trackRef: { track: path ? trackParam : null, map: customCells ? mapParam : null },
		car: playerCar, yarisMode,
		ghost: settings.ghost,
		prepare: ( object ) => precompile( object ),
		boardId: dailyMode ? dailyBoardId() : null,
		onFinish: () => {

			if ( circuitFinishTracked ) return;
			circuitFinishTracked = true;
			trackFinish( raceMode );

		},
	} ) : null;

	// The daily challenge, on a rally stage: there is no online leaderboard for
	// rally otherwise (CircuitOnline is circuit-only), so its own small ghost
	// recording + submission lives here (fed in the loop below, finished in stage.onFinish)
	const dailyRally = dailyMode && stage ? new GhostRecorder() : null;

	const _camLead = new THREE.Vector3();

	const spectatorHits = [];
	let offTrackTime = 0, stuckTime = 0;
	const _wheel = new THREE.Vector3();
	let spectatorGrace = 0;
	const contactListener = {
		onContactAdded( bodyA, bodyB ) {

			if ( bodyA !== sphereBody && bodyB !== sphereBody ) return;
			if ( bodyA === groundBody || bodyB === groundBody ) return;

			// A spectator: handled after the step (it removes the body)
			const other = bodyA === sphereBody ? bodyB : bodyA;
			if ( stage && stage.isSpectator( other ) ) spectatorHits.push( other );

		}
	};

	// Pause menu and arrival screen
	const ui = new GameUI( {
		camera: { mode: () => view, select: selectView, locked: () => viewLocked, multiplayer: !!multi },
		music: {
			volume: () => settings.volume.raceMusic,
			enabled: () => settings.raceMusic,
			track: () => raceMusic.currentTrack,
			setVolume: value => {
				settings.volume.raceMusic = value;
				raceMusic.setVolume( value );
				const fresh = loadSettings();
				fresh.volume.raceMusic = value;
				saveSettings( fresh );
			},
			toggle: () => {
				settings.raceMusic = ! settings.raceMusic;
				raceMusic.setEnabled( settings.raceMusic );
				saveSettings( { ...loadSettings(), raceMusic: settings.raceMusic } );
			},
		},
		onPause: ( paused ) => {

			audio.setPaused( paused );

		},
		onRestart: multi ? null : () => location.reload(),
		onMenu: () => leavePage( 'menu.html' ),
		ghost: online ? {
			mode: () => online.ghostMode,
			next: () => {

				online.setGhostMode( online.nextGhostMode() );
				saveSettings( { ...loadSettings(), ghost: online.ghostMode } );

			},
		} : null,
		// Trees, shadows and the renderer are set up at load: toggling restarts the run
		performance: multi ? null : {
			enabled: () => lowSpec,
			toggle: () => {

				saveSettings( { ...loadSettings(), graphics: lowSpec ? 'normal' : 'low' } );
				location.reload();

			},
		},
		onNewStage: stage && ! multi ? () => {

			params.set( 'rally', Math.floor( Math.random() * 1e6 ) );
			location.search = params.toString();

		} : null,
	} );

	refreshCameraUI = () => ui.updateCameraControls();
	raceMusic.audio.addEventListener( 'playing', () => ui.updateMusicControls() );

	// Secret accelerator (Konami code → Shift), solo only. Unless COUNT_BOOSTED,
	// a lap counts only if the boost was not used during it (flag cleared at each line)
	if ( ! multi ) {

		controls.boostEnabled = isBoostUnlocked();
		lapTimer.excludeLap = () => {

			const used = vehicle.boostUsed;
			vehicle.boostUsed = vehicle.boost;
			return used && ! COUNT_BOOSTED;

		};
		listenKonami( ( on ) => {

			controls.boostEnabled = on;
			showToast( on ? t( 'game.boostOn' ) : t( 'game.boostOff' ), 2200 );

		} );

	}

	if ( stage && stage.length ) {

		// Best time per stage (seed + landscape + length), on this device; v2 = the biome stages
		const bestKey = `${betaMode ? "beta-v3." : ""}racing.bestStage2.${ rallySeed }.${ rallyLandscape }.${ stage.length }`;

		stage.onFinish = ( time ) => {

			trackFinish( raceMode ); // 'rally', or 'daily' on a daily-challenge stage
			const best = loadBest( bestKey );
			const boosted = vehicle.boostUsed && ! COUNT_BOOSTED;
			const record = boosted ? false : saveBest( bestKey, time );
			ui.showResult( {
				title: t( 'race.finish' ),
				time,
				best,
				record,
				subtitle: t( 'race.stageLine', { seed: rallySeed, km: ( stage.length * stage.metresPerWorld / 1000 ).toFixed( 0 ) } ) + ( boosted ? ' · ' + t( 'game.boostedTime' ) : '' ),
			} );

			// The daily challenge: post to its leaderboard once the result screen
			// is already up (a toast follows when the server answers — never
			// blocks the result, a boosted run never ranked just like locally)
			if ( dailyRally && ! boosted ) {

				const lap = dailyRally.finish( time, vehicle );

				if ( lap ) ( async () => {

					// seed/landscape/length: the server checks they are today's
					// exact daily stage before skipping its own-geometry check
					const res = await submitLap( await dailyBoardId(), { time, car: playerCar.id, color: playerCar.color, ghost: lap.encoded, seed: String( rallySeed ), landscape: rallyLandscape, length: stage.length } );
					if ( res.ok ) showToast( res.data.record ? t( 'daily.newRecord' ) : t( 'daily.rank', { place: ordinal( res.data.rank ), total: res.data.leaderboard.total } ), 2600 );

				} )();

			}

		};

	}

	let sync = null;

	if ( multi ) {

		const { RaceSync } = await import( './multi/RaceSync.js' );
		const finishS = path ? roadPieces( path, path.closed ).finishS : 0;
		let pastLine = false;

		// 0 at the start, 1 at the finish
		const progress = () => {

			if ( stage ) return stage.length ? Math.min( 1, stage.distance / stage.length ) : 0;
			if ( ! lapTimer.enabled ) return 0;
			let lap = 0;

			if ( path ) {

				const s = path.nearest( vehicle.spherePos.x, vehicle.spherePos.z, 2 ).s;
				lap = ( ( ( s - finishS ) % path.length ) + path.length ) % path.length / path.length;
				if ( lap < 0.25 ) pastLine = true;
				if ( ! pastLine ) lap = 0; // on the grid, behind the line

			} else lap = lapTimer.counter.visitedCount() / lapTimer.config.checkpointCount;

			return Math.min( 1, ( sync.lapsDone + lap ) / multi.race.laps );

		};

		sync = new RaceSync( { ...multi, scene, camera: cam.camera, world, loadCar: ( id, color ) => loadCar( loader, id, color ), progress } );
		await sync.prepare();

		if ( stage ) stage.onFinish = () => sync.finish( vehicle );
		else if ( lapTimer.enabled ) lapTimer.onLap = () => {

			sync.lapsDone += 1;
			if ( sync.lapsDone >= multi.race.laps ) sync.finish( vehicle );

		};

	}

	// A rift (turbo level 3) jumps the car along the road: my lap counter is
	// walked along the road it skipped, so its checkpoints (and the line) count
	const warpLap = ( points ) => {

		if ( ! lapTimer.enabled ) return;
		for ( const p of points ) if ( lapTimer.counter.feed( p.x, p.z ) ) lapTimer.completeLap();

	};

	// Bonus race (lobby mode Expérimental): item boxes and rockets, circuits only
	let bonus = null;
	const bonusPath = sync && multi.race.bonus && ! stage ? path || pathFromCells( customCells || TRACK_CELLS ) : null;

	if ( bonusPath ) {

		const { BonusRace } = await import( './bonus/BonusRace.js' );
		bonus = new BonusRace( {
			client: multi.client, sync, scene, world, vehicle,
			path: bonusPath,
			finishS: path ? roadPieces( path, path.closed ).finishS : 0,
			fireKey: settings.keys.fire.find( Boolean ),
			shake: ( amount ) => cam.shake( amount ), audio, onWarp: warpLap,
		} );

	}

	// Test mode: the bench stands in for the lobby (bots, bonuses on buttons)
	let bench = null;

	if ( testMode ) {

		const { TestBench } = await import( './bonus/TestBench.js' );
		const { BonusRace } = await import( './bonus/BonusRace.js' );
		bench = new TestBench( { scene, world, path, vehicle, loadCar: ( id, color ) => loadCar( loader, id, color ) } );
		bonus = new BonusRace( {
			client: bench.client, sync: bench.sync, scene, world, vehicle, path,
			finishS: roadPieces( path, true ).finishS,
			fireKey: settings.keys.fire.find( Boolean ),
			localHits: true,
			shake: ( amount ) => cam.shake( amount ), audio, onWarp: warpLap,
		} );
		bench.attach( bonus );

	}

	if ( params.has( 'debug' ) || pageParams.has( 'debug' ) ) window.game = { vehicle, controls, stage, world, cam, ui, lapTimer, online, renderer, bloomPass, ultraEffects, driftMarks, dofPass, sync, bonus, bench, flying: () => flying };

	let sceneReady = false;
	const start = !sync ? new RaceStart() : null;
	const launchBurnout = new LaunchBurnout();
	const timer = new THREE.Timer();
	const noInput = { x: 0, z: 0, handbrake: false, touchActive: false };

	// Fixed physics step: the car, the lap clock and the stage advance in
	// PHYSICS_STEP slices whatever the screen refresh rate, so a lap drives
	// and times the same at 30, 60 or 240 FPS (fair leaderboard). The picture
	// shows the car extrapolated from the last two steps.
	let accumulator = 0;
	const monitor = params.has( 'debug' ) ? new FrameMonitor( renderer ) : null;
	const prevPos = vehicle.container.position.clone();
	const prevQuat = vehicle.container.quaternion.clone();
	const currPos = new THREE.Vector3();
	const currQuat = new THREE.Quaternion();
	const _renderSphere = new THREE.Vector3();

	function physicsStep( input ) {

		const step = PHYSICS_STEP;

		if ( restartDue ) restartLap();

		prevPos.copy( vehicle.container.position );
		prevQuat.copy( vehicle.container.quaternion );

		if ( groundProxy ) groundProxy.update( vehicle.spherePos.x, vehicle.spherePos.z );
		if ( stage ) vehicle.speedFactor += ( ( stage.onRoad( vehicle.spherePos.x, vehicle.spherePos.z ) ? 1 : OFFROAD_SPEED ) - vehicle.speedFactor ) * Math.min( 1, step * 4 );
		if ( sync ) sync.beforePhysics( vehicle, step );
		if ( bench ) bench.beforePhysics( step );
		updateWorld( world, contactListener, step );
		if ( sync ) sync.afterPhysics( vehicle );

		spectatorGrace = Math.max( 0, spectatorGrace - step );

		while ( spectatorHits.length ) {

			if ( stage.hitSpectator( spectatorHits.pop() ) && spectatorGrace === 0 ) {

				// The penalty, and the car goes back on the road
				spectatorGrace = SPECTATOR_GRACE;
				stage.addPenalty( SPECTATOR_PENALTY );
				backOnRoad( t( 'game.spectator' ), 0, SPECTATOR_PENALTY );

			}

		}

		if(wallGuard)wallGuard.resolve(vehicle);
 vehicle.update( step, input );
		if ( online ) online.input( input );
		if ( dailyRally ) dailyRally.input( input );
		if ( bonus ) bonus.afterVehicle( step );

		const hasInput = input.touchActive || Math.abs( input.x ) > 0.05 || Math.abs( input.z ) > 0.05;
		lapTimer.update( step, vehicle.spherePos, hasInput );
		if ( flying ) {

			flying.record( vehicle );
			if ( lapTimer.counter.crossed() ) flying.lineCrossed();

		}
		if ( online ) online.step();
		if ( stage ) {

			stage.update( step, vehicle.spherePos, hasInput );
			if ( dailyRally ) dailyRally.sample( stage.time, vehicle );

			// Over the edge or lost in the woods: back on the road, time penalty
			const road = stage.nearestRoad( vehicle.spherePos.x, vehicle.spherePos.z );
			if ( road && ! resetting && ( vehicle.spherePos.y < road.y - FALL_DEPTH || road.dist > LOST_DISTANCE ) ) backOnRoad( t( 'game.offRoad' ) );

			// No wheel on the dirt for a while, or pushing without moving (stuck
			// against a tree): put back too. Only while the clock runs.
			if ( stage.running && ! resetting ) {

				let onDirt = 0;

				for ( const wheel of vehicle.wheels ) {

					wheel.getWorldPosition( _wheel );
					if ( stage.onRoad( _wheel.x, _wheel.z ) ) onDirt ++;

				}

				if ( ! vehicle.wheels.length && stage.onRoad( vehicle.spherePos.x, vehicle.spherePos.z ) ) onDirt = 1;
				offTrackTime = onDirt === 0 ? offTrackTime + step : 0;
				stuckTime = hasInput && vehicle.sphereVel.length() < STUCK_SPEED ? stuckTime + step : 0;

				if ( offTrackTime > OFF_TRACK_TIME ) backOnRoad( t( 'game.offTrack' ) );
				else if ( stuckTime > STUCK_TIME ) backOnRoad( t( 'game.stuck' ) );

			}

		}

	}

	// Rally: a short fade, then the car stands on the road a few metres back
	let resetting = false;
	useHudTheme();
	const toast = document.createElement( 'div' );
	toast.className = 'reset-toast hud-toast';
	document.body.appendChild( toast );
	const toastStyle = document.createElement( 'style' );
	toastStyle.textContent = `
		.reset-toast { position: absolute; top: 18%; left: 50%; z-index: 15; transform: translate(-50%, -10px); opacity: 0; pointer-events: none;
			transition: opacity 0.25s, transform 0.25s; }
		.reset-toast.on { opacity: 1; transform: translate(-50%, 0); }
		.reset-fade { position: absolute; inset: 0; z-index: 14; background: #0b0e14; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
		.reset-fade.on { opacity: 1; }
	`;
	document.head.appendChild( toastStyle );
	const fade = document.createElement( 'div' );
	fade.className = 'reset-fade';
	document.body.appendChild( fade );

	let toastTimer = 0;

	function showToast( html, hold = 1600 ) {

		toast.innerHTML = html;
		toast.classList.add( 'on' );
		clearTimeout( toastTimer );
		toastTimer = setTimeout( () => toast.classList.remove( 'on' ), hold );

	}

	// penalty: seconds added here; shown: seconds on the toast (a spectator's
	// penalty is added by the caller)
	function backOnRoad( reason, penalty = RESET_PENALTY, shown = penalty ) {

		if ( ! stage || resetting || stage.finished ) return;
		launchBurnout.cancel();
		resetting = true;
		offTrackTime = stuckTime = 0;
		showToast( `${ reason } · <b>+${ shown } s</b>`, 1550 );
		fade.classList.add( 'on' );

		setTimeout( () => {

			const road = stage.nearestRoad( vehicle.spherePos.x, vehicle.spherePos.z );
			const at = stage.respawnAt( Math.max( 2, ( road ? road.s : stage.distance ) - 4 ) );
			vehicle.respawn( at.position, at.angle );
			if ( groundProxy ) groundProxy.update( at.position[ 0 ], at.position[ 2 ] );
			if ( penalty ) stage.addPenalty( penalty );
			offTrackTime = stuckTime = 0;
			fade.classList.remove( 'on' );
			resetting = false;

		}, 350 );

	}

	// The reset key (menu Paramètres → Contrôles), rally only
	const resetKeys = settings.keys.reset;
	window.addEventListener( 'keydown', ( e ) => {

		if ( stage && ! ui.paused && sceneReady && !start?.blocked && resetKeys.includes( e.code ) ) backOnRoad( t( 'game.backOnRoad' ) );

	} );

	// Quick restart (the restart key, menu Paramètres → Contrôles), solo
	// circuits: back FLYING s before the line at the speed of the last lap, or
	// RUN_UP m of road before it, stopped (FlyingStart.js); the clock starts at
	// the line. Taken at the next physics step
	const flying = lapTimer.enabled && ! multi && ! testMode && !betaMode ? new FlyingStart( PHYSICS_STEP ) : null;
	let restartDue = false;
	let runUp = null; // the standing run-up, worked out the first time

	function quickRestart() {

		if ( flying && ! ui.paused && sceneReady && !start?.blocked ) restartDue = true;

	}

	function restartLap() {

		launchBurnout.cancel();
		restartDue = false;
		const start = flying.start;

		if ( start ) vehicle.restoreState( start, 0 );
		else {

			runUp ??= runUpStart( path || pathFromCells( customCells || TRACK_CELLS ), { position: vehicle.spawnPosition.toArray(), angle: vehicle.spawnAngle }, ROAD_Y );
			vehicle.respawn( runUp.position, runUp.angle );

		}

		if ( groundProxy ) groundProxy.update( vehicle.spherePos.x, vehicle.spherePos.z );
		vehicle.boostUsed = false;
		lapTimer.restart( true );
		if ( online ) online.restart();
		flying.clear();
		showToast( t( start ? 'game.flyingStart' : 'game.standingStart' ), 900 );

	}

	// The controls at the start of the race (ControlsHint.js), shown once the scene is
	const hint = new ControlsHint( settings.keys, { view: ! viewLocked, restart: !! flying } );

	const restartKeys = settings.keys.restart;
	window.addEventListener( 'keydown', ( e ) => {

		if ( ! e.repeat && restartKeys.includes( e.code ) ) quickRestart(); // R is also the stage's reset: circuits only

	} );

	// Gamepad (Controls.js drives): Start = pause, Back = the reset key on a
	// stage, the quick restart on a circuit; the d-pad / stick, A and B work
	// the pause and arrival screens
	new GamepadUI( {
		navActive: () => !! document.querySelector( '.ui-overlay.open' ),
		root: () => document.querySelector( '.ui-overlay.open' ),
		buttons: {
			[ PAD.START ]: () => window.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', code: 'Escape', bubbles: true } ) ),
			[ PAD.BACK ]: () => {
				if ( !sceneReady || start?.blocked ) return;

				if ( stage && ! ui.paused ) backOnRoad( t( 'game.backOnRoad' ) );
				else if ( flying ) quickRestart();

			},
		},
		hint: t( 'pad.gameHint' ),
	} );

	function animate() {

		requestAnimationFrame( animate );

		timer.update();
		const frameTime = timer.getDelta();
		const frameStart = monitor ? performance.now() : 0;
		const dt = Math.min( frameTime, 1 / 30 ); // visual effects only
		if ( start ) {
			start.update( frameTime, { paused: ui.paused, visible: !document.hidden } );
			ui.setCountdown( start.label === 'go' ? t( 'race.go' ) : start.label );
		}

		// Paused: the world stands still, the picture stays (drawn once)
		// Multiplayer: the race goes on under the pause menu (the car just gets no input)
		if ( ui.paused && ! sync ) {

			if ( ! pausedFrameDrawn ) renderer.render( scene, cam.camera );
			pausedFrameDrawn = true;
			resolution.reset();
			accumulator = 0;
			return;

		}

		pausedFrameDrawn = false;
		resolution.update( frameTime );

		// After the arrival the car just rolls to a stop
		let input = noInput;
		let held = noInput; // the controls before a bonus hit takes them away (the fire key)
		const readInput = () => {

			const raw = controls.update();
			viewKey( raw );
			input = !sceneReady || start?.blocked || ( stage && stage.finished ) ? noInput : raw;
			if ( sync ) input = ui.paused ? noInput : sync.gate( input );
			held = input;
			if ( bonus ) input = bonus.gate( input );

			// Multiplayer: the lap clock and the stage clock start at the GO, not on the first input
			if ( sync && sync.started ) {

				if ( lapTimer.enabled ) lapTimer.running = true;
				if ( stage && ! stage.finished ) stage.running = true;

			}

		};
		if ( monitor ) monitor.time( 'commandes', readInput );
		else readInput();
		hint.frame( dt, held );

		// A stall (tab switch, hitch) is dropped rather than replayed at once
		accumulator = Math.min( accumulator + frameTime, MAX_FRAME_TIME );
		let steps = 0;
		const simulate = () => {

			if ( !sceneReady || start?.blocked ) accumulator = 0;
			while ( accumulator >= PHYSICS_STEP ) {

				physicsStep( input );
				accumulator -= PHYSICS_STEP;
				steps ++;

			}

		};

		if ( monitor ) monitor.time( 'physique', simulate );
		else simulate();
		if ( sync ) sync.step( vehicle, accumulator );

		// Draw the car ahead of the last physics state by the time not simulated
		// yet (extrapolated along the last step): smooth at any refresh rate,
		// without the one-step lag interpolating between two past states adds
		const alpha = accumulator / PHYSICS_STEP;
		currPos.copy( vehicle.container.position );
		currQuat.copy( vehicle.container.quaternion );
		vehicle.container.position.lerpVectors( prevPos, currPos, 1 + alpha );
		vehicle.container.quaternion.slerpQuaternions( prevQuat, currQuat, 1 + alpha );
		_renderSphere.copy( vehicle.container.position ).y += 0.5;

		dirLight.position.set(
			_renderSphere.x + 11.4,
			_renderSphere.y + 15,
			_renderSphere.z - 5.3
		);

		const mv = vehicle.modelVelocity;
		_camLead.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion ).multiplyScalar( Math.sqrt( mv.x * mv.x + mv.z * mv.z ) );
		const effects = () => {
			if ( yarisMode ) {
				if ( sync ) yarisTime = Math.max( 0, sync.raceTime ?? 0 );
				else if ( sceneReady && ! start?.blocked ) yarisTime += dt;
				stretchYaris( vehicle.visualModel, yarisTime );
			}

			const burnout = launchBurnout.update( frameTime, sceneReady && ( sync ? sync.started : ! start.blocked ), input.z, sync ? sync.raceTime : null );
			if ( burnout ) for ( const wheel of vehicle.wheels ) wheel.rotation.x += dt * 40 * burnout;
			cam.update( dt, _renderSphere, _camLead, { quaternion: vehicle.container.quaternion, speed: Math.abs( vehicle.linearSpeed ) / MAX_SPEED, groundAt: cameraGround } );
			if ( sky ) sky.follow( cam.camera );
			if ( bridges ) bridges.update( _renderSphere, cam.camera, dt );
			if ( particles ) particles.update( dt, vehicle, burnout );
			driftMarks.update( dt, vehicle, burnout );
			audio.update( dt, vehicle.linearSpeed / MAX_SPEED, input.z, Math.max( vehicle.driftIntensity, burnout * 1.7 ), betaMode?vehicle.transmission:null );
 if(betaHUD)betaHUD.update(dt,vehicle);
			if ( online ) online.render( alpha * PHYSICS_STEP );
			if ( sync ) sync.render();
			if ( bench ) bench.frame();
			if ( bonus ) bonus.frame( held, dt );
			lapTimer.render();

		};

		if ( monitor ) monitor.time( 'effets', effects );
		else effects();

		if ( stage ) {

			// Chunks and terrain tiles, a few ms per frame (RallyStage.stream)
			stage.stream( vehicle.spherePos );

			// Uniform scenery: the baked probe volume just travels with the car
			if ( probes ) {
				probes.position.set( _renderSphere.x, _renderSphere.y + 2, _renderSphere.z );
				probes.updateBoundingBox();
			}

		}

		if ( dofPass ) setFocus( dofPass, cam.camera, vehicle.container.position );
		if ( monitor ) monitor.time( 'rendu', () => renderer.render( scene, cam.camera ) );
		else renderer.render( scene, cam.camera );
		if ( monitor ) monitor.frame( frameTime, steps, performance.now() - frameStart );

		// The physics carries on from the real state, not the drawn one
		vehicle.container.position.copy( currPos );
		vehicle.container.quaternion.copy( currQuat );

	}

	// Compile every shader now (smoke, skid marks, shadows, ghost) instead of
	// the first time each one shows up, which made the first lap stutter
	await loading.compile( 'shaders', renderer, scene, cam.camera ).catch( ( e ) => console.warn( 'Shader precompile failed: ' + e.message ) );

	animate(); // Draw the held car while the loading curtain opens.
	Promise.resolve( loading.reveal() ).then( () => {
		sceneReady = true;
		if ( start ) start.begin();
  if(pageParams.has('debug'))console.info('[circuit-ready] '+JSON.stringify({circuit:circuitParam||'default',loadMs:Math.round(performance.now()-loadStarted),probes:!!probes,...circuitPerformance}));
		if ( sync ) sync.loaded();
		hint.show();
	} );
	trackRace( raceMode );

	// Hidden objects (the ghost until the lap starts) are skipped by compile:
	// shown just while compile walks the scene, which happens synchronously
	function precompile( object ) {

		const visible = object.visible;
		object.visible = true;
		const done = renderer.compileAsync( object, cam.camera, scene );
		object.visible = visible;
		return done.catch( ( e ) => console.warn( 'Shader precompile failed: ' + e.message ) );

	}

}

// play.html?lobby= that can't join its race: say why and go back to the menu
function showLobbyError( message ) {

	const box = document.createElement( 'div' );
	useHudTheme();
	// Dark and long enough to read once the loading screen has faded; a click leaves at once
	box.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;align-content:center;gap:18px;background:rgba(14,17,22,.94);text-align:center;z-index:50;cursor:pointer;padding:24px';
	const inner = document.createElement( 'div' );
	inner.className = 'hud-toast';
	inner.style.cssText = 'white-space:normal;max-width:min(90vw,900px)';
	inner.textContent = t( 'game.lobbyError', { message } );
	const hint = document.createElement( 'div' );
	hint.style.cssText = 'color:#c9ced6;font:600 16px var(--text, sans-serif)';
	hint.textContent = t( 'race.backToMenu' );
	box.append( inner, hint );
	document.body.appendChild( box );
	loading.reveal();
	const back = () => leavePage( 'menu.html' );
	box.addEventListener( 'click', back );
	setTimeout( back, 7000 );

}

init().catch( ( e ) => {

	loading.reveal(); // never left behind the loading screen
	throw e;

} );
