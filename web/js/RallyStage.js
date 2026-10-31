import * as THREE from 'three';
import { rigidBody, box, MotionType } from 'crashcat';
import { CELL_RAW, GRID_SCALE } from './Track.js';
import { TrackPath, TILE_LEN, TRACK_SCALE, ROAD_HALF, ROAD_Y, GRASS_UV, ROCK_UV, extractTileGeometry } from './SplineTrack.js';
import { RallyRoute, LEAD_IN, RUN_OUT } from './RallyRoute.js';
import { RallyTerrain } from './RallyTerrain.js';
import { extractProps } from './Props.js';
import { Odometer, formatKm } from './Odometer.js';
import { buildDirtRoadGeometry, createDirtMaterial, buildGantry, bannerTexture, dirtHalfAt, DIRT_HALF, texelColor } from './DirtRoad.js';
import { buildArch, flatNormals, pieceGeometry, NATURE_TREES, NATURE_BUSHES, NATURE_FLOWERS, NATURE_STUMPS, NATURE_LOGS, NATURE_MUSHROOMS, NATURE_TREE_SCALE, NATURE_SCALE } from './Kit.js';
import { Roadside, SPECTATOR_TIME } from './Roadside.js';
import { season, seasonMaterial } from './Seasons.js';
import { vertexRock, rockField, onRockField, ROCK_EDGE } from './RockEdge.js';
import { t } from './i18n.js';
import { useHudTheme } from './HudTheme.js';

// Endless rally stage (`?rally` or `?rally=<seed>`): RallyRoute lays the road
// feature by feature (with its elevation), this streams it in chunks around
// the car — a dirt track (DirtRoad.js), what lines it (Roadside.js: posts,
// fences, spectators, bales, rocks, bushes) and a band of forest — and drops
// chunks far behind. The relief (RallyTerrain: cliff on one side, mountain on
// the other) is streamed separately as square tiles around the car.
//
// No barriers: the car can leave the road. The ground under it is the road,
// then the verge, then the terrain as drawn (groundAt); trees, rocks, fences
// and people near the road are solid. Falling off is caught in main.js
// (nearestRoad / respawnAt put the car back, with a time penalty).
//
// The route is laid LOOKAHEAD metres ahead of the car so every tile and tree
// already knows about the road that will pass near it: 5 times the terrain's
// reach (setReach scales it: a later leg of a switchback coming back within
// reach of a tile built before it was laid left that tile, and the cached
// heights, wrong — spikes through the road).

const CHUNK_LEN = 45; // m of road per chunk
const AHEAD = 3; // chunks kept built in front of the car
const BEHIND = 3; // chunks kept behind it
const LOOKAHEAD = 400; // m of route laid ahead of the car

const TILE = 32; // m, terrain tile side
const TILE_STEP = 2; // m, terrain grid (the physics and every placement decision)
const FINE_STEP = 1; // m, the grid Ultra draws (fineHeight)
const TILE_BUILD_RADIUS = 80; // tiles whose center is this close get built...
const TILE_DROP_RADIUS = 120; // ...and dropped past this
const STREAM_BUDGET = 4; // ms of building (chunks, terrain tiles) per frame, see stream()
const TERRAIN_SINK = - 0.15; // visual ground just under the road surface
// Steep faces (cliffs) drawn with their vertices pushed a little off the grid,
// each by its own hashed amount (the same for the tiles sharing it): the
// regular grid made every cliff the same row of sawteeth. Only past STEEP_FROM
// (rise per metre), fully from STEEP_FULL: the ground the cars drive on and
// every prop stand where they did (the physics reads the 2 m grid, not this)
const STEEP_FROM = 0.9, STEEP_FULL = 1.6;
const STEEP_JITTER = 0.3; // share of the drawn grid step, across (under 0.35: two neighbours never cross, no facet turns over)
const STEEP_RISE = 0.8; // m, up or down
// and their quads cut along either diagonal (hashed): one diagonal everywhere made
// the tall thin triangles of a cliff line up into regular teeth. Only steep quads,
// where nothing stands (drawnAt / terrainAt keep the one diagonal: the ground
// under props and cameras, a few cm off there at most)
const ROCK_SNOW = 0.35; // less snow field on rock: it shows through at the edges
const VERGE = 0.8; // m past the dirt edge over which the ground eases down to the grass
const COLLIDE_RANGE = 22; // m from the road: trees and stones closer than this are solid
const GANTRY_START = 5.5; // m from the start of the stage: the start banner, just ahead of the car
const FINISH_BACK = 6; // m before the end of a limited stage: the arrival banner
const OWN_STRETCH = 22; // m of arc length a roadside item counts as "its" road

// Props (Props.js: trees and stones cut out of the Kenney decoration tiles)
const TREE_CLEAR = ROAD_HALF + 1.6; // m from the centerline, keeps foliage off the barriers
const STONE_CLEAR = ROAD_HALF + 0.8;
const MAX_TREE_SLOPE = 1.1; // grade (rise/run) above which no tree grows
const MAX_STONE_SLOPE = 2.5;
// The forest floor (Nature Kit): stumps and fallen logs where the ground
// lets them lie, mushrooms in autumn (every graphics mode with props);
// Ultra adds bushes all year (season colours) and flowers in spring
const FLOOR_BUSHES = [ 1, 4 ]; // per cell, min..max
const FLOOR_FLOWERS = [ 2, 7 ]; // patches per cell, spring only
const FLOOR_MUSHROOMS = [ 1, 4 ]; // per cell, autumn only
const STUMP_CHANCE = 0.45; // per cell
const LOG_CHANCE = 0.25;
const MAX_MUSHROOM_SLOPE = 0.8;
const MAX_BUSH_SLOPE = 1.1;
const MAX_STUMP_SLOPE = 0.6;
const MAX_LOG_SLOPE = 0.2; // a log lies on nearly flat ground only (it is drawn level)
const ROADSIDE_TREES = 15; // up to this many per cell by the road...
const FOREST_TREES = [ 4, 6 ]; // ...and this many beyond

// Crags (RallyTerrain.js) dressed from each cell's own random stream (the
// forest never moves), in every mode with props: blocks of rock standing out
// of the faces (generated: rockShape), scree at their foot, bushes and small
// pines on their ledges
const CRAG_TRIES = 8; // spots tried per cell
const BLOCK_CHANCE = 0.6; // a spot on a crag's face gets a block
const BLOCK_HEIGHT = [ 2.5, 5 ]; // m
const SCREE_SIZE = [ 0.5, 1.6 ]; // m
const CRAG_NEAR = 3.5; // m: a grass spot this close to rock is a crag's foot or ledge
const ROCK_SHAPES = 6; // generated shapes per kind (blocks, boulders)
const SCREE_GREYS = [ 0x8a8f96, 0x7d7a74, 0x9a9690 ]; // Roadside.js boulder's
const LEDGE_PINES = [ 'tree_pineSmallA', 'tree_pineSmallB', 'tree_pineSmallC', 'tree_pineSmallD', 'tree_pineGroundA', 'tree_pineGroundB' ];
const RING = [ 0, 1, 2, 3, 4, 5 ].map( ( k ) => [ Math.cos( k * Math.PI / 3 ) * CRAG_NEAR, Math.sin( k * Math.PI / 3 ) * CRAG_NEAR ] );

const CELL = CELL_RAW * GRID_SCALE;
const CLEAR = CELL * Math.SQRT1_2 + ROAD_HALF + 0.25; // same road clearance as TrackScene
const FOREST_BAND = CLEAR + 3 * CELL; // decoration stops this far from the road

const _dummy = new THREE.Object3D();
const _f = {};
const _g = {};
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _g3 = new THREE.Vector3();
const GRID_CACHE_MAX = 200000; // grid heights kept (gridHeight), then the cache starts over

// A low-poly rock with its foot at y = 0, about 1 m tall: a jagged pillar
// (block) or a squashed icosahedron (boulder); a shade of `color` per face
function rockShape( rand, block, color ) {

	let g = block ? new THREE.CylinderGeometry( 0.14 + rand() * 0.08, 0.24 + rand() * 0.06, 1, 5 + Math.floor( rand() * 2 ), 2 ) : new THREE.IcosahedronGeometry( 0.5, 0 );
	if ( g.index ) g = g.toNonIndexed();
	g.deleteAttribute( 'uv' );
	const p = g.attributes.position;
	const sx = 0.8 + rand() * 0.35, sz = 0.75 + rand() * 0.3, sy = block ? 1 : 0.55 + rand() * 0.3;
	const jitter = new Map(); // one offset per corner, shared by its faces

	for ( let i = 0; i < p.count; i ++ ) {

		const key = p.getX( i ).toFixed( 3 ) + ',' + p.getY( i ).toFixed( 3 ) + ',' + p.getZ( i ).toFixed( 3 );
		let j = jitter.get( key );
		if ( ! j ) jitter.set( key, j = [ ( rand() - 0.5 ) * 0.2, ( rand() - 0.5 ) * 0.16, ( rand() - 0.5 ) * 0.2 ] );
		p.setXYZ( i, ( p.getX( i ) + j[ 0 ] ) * sx, ( p.getY( i ) + j[ 1 ] ) * sy, ( p.getZ( i ) + j[ 2 ] ) * sz );

	}

	g.computeBoundingBox();
	g.translate( 0, - g.boundingBox.min.y, 0 );
	const colors = new Float32Array( p.count * 3 );

	for ( let t = 0; t < p.count; t += 3 ) {

		const shade = block ? 0.95 + rand() * 0.3 : 0.85 + rand() * 0.25;
		for ( let v = 0; v < 3; v ++ ) colors.set( [ color.r * shade, color.g * shade, color.b * shade ], ( t + v ) * 3 );

	}

	g.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );
	g.computeVertexNormals(); // non-indexed: flat faces
	g.computeBoundingSphere();
	const box = g.boundingBox;
	g.userData.radius = Math.max( - box.min.x, box.max.x, - box.min.z, box.max.z ); // footprint, at scale 1
	return g;

}

function hash( gx, gz ) {

	let h = gx * 374761393 + gz * 668265263;
	h = ( h ^ ( h >> 13 ) ) * 1274126177;
	return ( h ^ ( h >> 16 ) ) >>> 0;

}

// Small seeded PRNG: the same cell always gets the same props
function mulberry32( seed ) {

	let t = seed >>> 0;

	return () => {

		t = ( t + 0x6D2B79F5 ) >>> 0;
		let r = Math.imul( t ^ ( t >>> 15 ), 1 | t );
		r = ( r + Math.imul( r ^ ( r >>> 7 ), 61 | r ) ) ^ r;
		return ( ( r ^ ( r >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

function formatTime( t ) {

	// Whole milliseconds first, so 59.9996 s shows 1:00.000, not 0:60.000
	const ms = Math.round( t * 1000 );
	const m = Math.floor( ms / 60000 );
	return `${ m }:${ ( ( ms - m * 60000 ) / 1000 ).toFixed( 3 ).padStart( 6, '0' ) }`;

}

export class RallyStage {

	// length: metres of stage, 0 = endless. onFinish( time ) fires once when
	// the car reaches the arrival arch of a limited stage.
	// options.props: false plants no trees or stones (performance mode).
	// The menu backdrop runs one too: world null (no colliders), hud false (no
	// HUD, no odometer), smaller tile radius and chunk window.
	constructor( scene, world, models, seed, landscape = 'varied', length = 0, { props = true, hud = true, tileRadius = TILE_BUILD_RADIUS, ahead = AHEAD, behind = BEHIND, ultra = false, seasonId = 'summer', forest = 1, forestBand = 1 } = {} ) {

		this.plantProps = props;
		this.forest = forest; // 2: a second wave of trees (solo; multiplayer keeps 1, the same stage for everyone)
		this.forestBand = FOREST_BAND * forestBand; // how far from the road the forest grows (lab/studio.html: twice as far)
		this.setReach( { tileRadius, ahead, behind } );
		this.scene = scene;
		this.world = world;
		this.models = models;
		this.seed = seed;
		this.length = length > 0 ? length : 0;
		this.finishS = null; // arc length of the arrival arch, once its chunk is built
		this.finished = false;
		this.onFinish = null;

		this.route = new RallyRoute( seed, ROAD_HALF, landscape, this.length || Infinity );
		this.route.growTo( this.lookahead );
		this.terrain = new RallyTerrain( this.route, ROAD_HALF );
		this.grid = new Map(); // grid vertex → terrain height (gridHeight)
		this.rocks = new Map(); // grid vertex → rock field (rockVertex)
		const height = ( i, j ) => this.gridHeight( i, j );
		this.rockVertexOf = ( i, j ) => vertexRock( height, i, j, TILE_STEP );
		this.rockAt = ( x, z ) => this.rockField( x, z );
		this.tiles = new Map(); // "ix,iz" → mesh

		const straight = extractTileGeometry( models[ 'track-straight' ] );
		this.straight = straight.geometry;
		this.finish = extractTileGeometry( models[ 'track-finish' ] ).geometry;
		this.material = straight.material;
		this.props = extractProps( models );

		// The season (Seasons.js): greens recoloured on the terrain and trees; the road painted in its colours, verge in its grass
		this.seasonId = seasonId;
		// Snow up high in the other seasons (RallyBiomes.js SNOW_LINE): white
		// ground cut sharp, the winter road on it, winter trees and bushes
		this.snow = seasonId !== 'winter';
		this.terrainMaterial = seasonMaterial( this.material, seasonId, { snow: this.snow, rock: ROCK_UV } );
		this.treeMaterial = seasonMaterial( this.props.material, seasonId );
		this.snowTreeMaterial = this.snow ? seasonMaterial( this.props.material, 'winter' ) : this.treeMaterial;
		this.dirtMaterial = createDirtMaterial( new THREE.Color( season( seasonId ).grass ), ultra, seasonId, { snow: this.snow } ); // Ultra: 4× the texture resolution
		this.kit = models.kit || null; // Kenney racing kit (Kit.js), optional
		this.nature = models.nature || null; // Kenney nature kit (Kit.js loadNature), optional
		this.ultra = ultra;
		// Ultra draws the terrain on a 1 m grid; the car's ground and every
		// placement decision stay on the 2 m one (the same stage and the same
		// collisions in every graphics mode), drawn props are lifted onto it
		this.drawStep = ultra ? FINE_STEP : TILE_STEP;
		this.fine = new Map(); // fine grid vertex → terrain height (fineHeight)
		this.natureGeometries = new Map(); // nature piece name → geometry (instanced)
		this.rockShapes = null; // 'b0'.. blocks, 's0'.. boulders (rockShape), made on first use
		this.rockMaterial = new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true } );
		const natureBase = new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true } );
		this.natureMaterial = this.nature ? seasonMaterial( natureBase, seasonId ) : null;
		this.snowNatureMaterial = this.nature && this.snow ? seasonMaterial( natureBase, 'winter' ) : this.natureMaterial;
		this.roadside = new Roadside( seed, this.terrain, this.route, ultra, seasonId, this.kit, this.nature );
		this.roadside.gridHeight = ( i, j ) => this.gridHeight( i, j ); // one cache for the stage and its roadside
		this.roadside.rockVertex = ( i, j ) => this.rockVertex( i, j );
		this.roadside.lift = ( x, z ) => this.lift( x, z ); // Ultra: items drawn on the 1 m terrain
		this.bodyItems = new WeakMap(); // roadside collider → { chunk, item }

		this.chunks = []; // built chunks, contiguous, oldest first
		this.nextIndex = 0; // index of the next chunk to build
		this.current = 0; // chunk index the car is on
		this.cells = new Map(); // "gx,gz" → { chunk, items: [ { key, index, x, z, clear, hidden } ] }

		this.pending = null; // the rest of the newest chunk's build (a generator), see stream()
		this.tileJob = null; // { key, steps }: the terrain tile being built
		this.clearings = new Map(); // "gx,gz" (decoration cell) → [ [ x, z, r ] ]: tents and campfires, kept free of forest props
		this.autoStream = true; // update() streams too; main.js turns it off and calls stream() once per frame

		for ( let i = 0; i <= this.ahead; i ++ ) {

			this.buildNext();
			this.flush();

		}

		this.updateTiles( 0, 0, Infinity );

		// Closes the road at the far end of the stretch drawn behind the start
		const n0 = this.route.nodes[ 0 ];
		this.addCap( { x: n0.x - Math.sin( n0.a ) * LEAD_IN, z: n0.z - Math.cos( n0.a ) * LEAD_IN, a: n0.a }, 0, - 1 );

		this.time = 0;
		this.running = false;
		this.distance = 0;
		// Endless mode only: lifetime kilometres, kept across sessions
		this.odometer = this.length || ! hud ? null : new Odometer();
		this.placed = false; // car located on the route at least once
		if ( hud ) this.buildUI();

	}

	// Invisible wall across the road at a node, `side` = -1 behind it, +1 past it
	addCap( node, y, side ) {

		if ( ! this.world ) return;
		const a = node.a;
		rigidBody.create( this.world, {
			shape: box.create( { halfExtents: [ ROAD_HALF, 1.5 * TRACK_SCALE, 0.25 ] } ),
			motionType: MotionType.STATIC,
			objectLayer: this.world._OL_STATIC,
			position: [ node.x + Math.sin( a ) * 0.5 * side, y + ( 0.5 + 1.5 ) * TRACK_SCALE - 0.5, node.z + Math.cos( a ) * 0.5 * side ],
			quaternion: [ 0, Math.sin( a / 2 ), 0, Math.cos( a / 2 ) ],
			friction: 0.0,
			restitution: 0.1,
		} );

	}

	// A static box collider (roadside item, trunk, rock), rot = heading
	addBox( c ) {

		return rigidBody.create( this.world, {
			shape: box.create( { halfExtents: [ c.hx, c.hy, c.hz ] } ),
			motionType: MotionType.STATIC,
			objectLayer: this.world._OL_STATIC,
			position: [ c.x, c.y, c.z ],
			quaternion: [ 0, Math.sin( c.rot / 2 ), 0, Math.cos( c.rot / 2 ) ],
			friction: 0.0,
			restitution: 0.1,
		} );

	}

	removeBody( body ) {

		if ( ! body || body.removed ) return;
		rigidBody.remove( this.world, body );
		body.removed = true;

	}

	// The start or finish arch at road frame f: the wooden gantry, or with the
	// racing kit one of its arches, picked by the stage seed (the start lights
	// arch only at the start, where it needs no banner). Returns the colliders
	// of its posts
	addArch( group, f, text, kind ) {

		const choices = this.kit ? ( kind === 'start' ? [ 'gantry', 'overhead', 'overheadLights', 'overheadRound', 'overheadRoundColored' ] : [ 'gantry', 'overhead', 'overheadRound', 'overheadRoundColored' ] ) : [ 'gantry' ];
		const rand = mulberry32( hash( this.seed, kind === 'start' ? 11 : 23 ) );
		const name = choices[ Math.floor( rand() * choices.length ) ];

		if ( name === 'gantry' ) {

			group.add( buildGantry( f, text ) );
			return [];

		}

		const arch = buildArch( this.kit, name, { ...f, y: f.y + ROAD_Y }, DIRT_HALF + 1.0, name === 'overheadLights' ? null : bannerTexture( text ) );
		group.add( arch.group );
		return arch.colliders; // the posts

	}

	// Start line: just behind the start banner
	spawn() {

		const path = this.chunks[ 0 ].path;
		path.frameAt( path.length / Math.max( 1, Math.round( path.length / TILE_LEN ) ) / 2, _f );
		return { position: [ _f.x, _f.y + 0.5, _f.z ], angle: Math.atan2( _f.tx, _f.tz ) };

	}

	// Builds the next chunk; false once a limited stage has no road left
	buildNext() {

		const next = this.route.chunk( CHUNK_LEN );
		if ( ! next ) return false;

		const index = this.nextIndex ++;
		const { nodes, startS, length, last } = next;
		const path = new TrackPath( nodes, false );

		// Elevation straight from the route's height function (not the per-chunk
		// Hermite), so grades match exactly across chunk joins. Bézier and arc
		// lengths differ by a hair: rescale so both ends land on the nodes.
		const k = length / path.length;

		for ( let i = 0; i < path.sampleCount; i ++ ) {

			const u = startS + path.s[ i ] * k;
			path.py[ i ] = this.route.heightAt( u );
			path.gy[ i ] = this.route.gradeAt( u ) * k;

		}

		const group = new THREE.Group();
		const archColliders = [];

		// The dirt track; start banner on the first chunk, and on a limited
		// stage the arrival banner near the end of the last one, with a wall past it
		const arrival = last && index > 0;
		const roadGeometry = buildDirtRoadGeometry( path, startS, k, index === 0 ? LEAD_IN : 0, arrival ? RUN_OUT : 0, ( u ) => this.route.heightAt( u ), ( u ) => this.route.widthAt( u ), this.snow ? ( x, y, z ) => this.terrain.snowField( x, y, z ) : null );
		const road = new THREE.Mesh( roadGeometry, this.dirtMaterial );
		road.receiveShadow = true;
		group.add( road );

		if ( index === 0 ) {

			path.frameAt( GANTRY_START, _f );
			archColliders.push( ...this.addArch( group, _f, t( 'race.bannerStart' ), 'start' ) );

		}

		if ( arrival ) {

			const at = Math.max( 0, path.length - FINISH_BACK );
			path.frameAt( at, _f );
			archColliders.push( ...this.addArch( group, _f, t( 'race.bannerFinish' ), 'finish' ) );
			this.finishS = startS + at * k;

			// The wall stands at the far end of the run-out, not on the line
			const out = this.route.runOut;
			if ( out ) this.addCap( { x: out.x, z: out.z, a: out.a }, this.route.heightAt( out.s ), 1 );
			else this.addCap( nodes[ nodes.length - 1 ], path.py[ path.sampleCount - 1 ], 1 );

		}

		// length / scale: route arc length of the chunk and route metres per path metre
		const chunk = { index, path, startS, length, scale: k, group, roadGeometry, bodies: [], props: {}, batches: [], roadside: [], roadsideMesh: null };
		if ( this.world ) for ( const c of archColliders ) chunk.bodies.push( this.addBox( c ) );

		// The straight stretches drawn before the start / past the end get their forest too
		const ends = [];
		if ( index === 0 ) ends.push( [ path.px[ 0 ] - path.tx[ 0 ] * LEAD_IN, path.pz[ 0 ] - path.tz[ 0 ] * LEAD_IN ] );
		if ( arrival && this.route.runOut ) ends.push( [ this.route.runOut.x, this.route.runOut.z ] );
		if ( ends.length ) chunk.extent = { minX: Math.min( ...ends.map( ( e ) => e[ 0 ] ) ), maxX: Math.max( ...ends.map( ( e ) => e[ 0 ] ) ), minZ: Math.min( ...ends.map( ( e ) => e[ 1 ] ) ), maxZ: Math.max( ...ends.map( ( e ) => e[ 1 ] ) ) };

		// The start and finish banners get a crowded control area around them
		const hubs = [];
		if ( index === 0 ) hubs.push( { s: startS + GANTRY_START * k, kind: 'start' } );
		if ( arrival && this.finishS !== null ) hubs.push( { s: this.finishS, kind: 'finish' } );

		// The road shows at once; the rest (forest, roadside) is built over
		// the next frames (stream()), long before the car gets there
		this.scene.add( group );
		this.chunks.push( chunk );
		this.pending = this.finishChunk( chunk, hubs );
		return true;

	}

	// The rest of a chunk's build, a step at a time: the props an earlier
	// stretch planted where this one runs, the forest row by row, then what
	// lines the road and its colliders
	* finishChunk( chunk, hubs ) {

		const { path, startS, scale: k, group } = chunk;

		this.clearDecorationOn( path, startS, k );
		yield;
		yield * this.decorate( chunk );

		// Posts, fences, spectators… (no people in performance mode)
		chunk.roadside = this.roadside.plan( path, startS, k, this.plantProps, hubs );
		for ( const it of chunk.roadside ) {

			if ( ! it.clearProps ) continue; // tents, campfires: no tree in them, now or in cells planted later
			this.hidePropsNear( it.x, it.z, it.clearProps );
			const key = Math.floor( it.x / CELL ) + ',' + Math.floor( it.z / CELL );
			const list = this.clearings.get( key );
			if ( list ) list.push( [ it.x, it.z, it.clearProps ] );
			else this.clearings.set( key, [ [ it.x, it.z, it.clearProps ] ] );

		}
		yield;
		chunk.roadsideMesh = this.roadside.build( chunk.roadside );
		group.add( chunk.roadsideMesh );
		yield;

		if ( this.world ) {

			for ( const it of chunk.roadside ) {

				if ( ! it.collider ) continue;
				it.body = this.addBox( it.collider );
				chunk.bodies.push( it.body );
				this.bodyItems.set( it.body, { chunk, item: it } );

			}

		}

	}

	// Runs the pending chunk build to its end
	flush() {

		if ( ! this.pending ) return;
		while ( ! this.pending.next().done );
		this.pending = null;

	}

	// Streaming, once per frame: the route laid ahead, chunks dropped behind,
	// then within STREAM_BUDGET ms (at least one step) the pending chunk's
	// next step, else the next chunk, else the next row of the terrain tile
	// being built (nearest missing first). Same order as a build all at once,
	// so the same stage.
	stream( position, budget = STREAM_BUDGET ) {

		const t0 = performance.now();
		this.route.growTo( this.distance + this.lookahead );
		while ( this.chunks.length && this.chunks[ 0 ].index < this.current - this.behind ) this.dispose( this.chunks.shift() );

		do {

			if ( this.pending ) {

				if ( this.pending.next().done ) this.pending = null;

			} else if ( this.nextIndex <= this.current + this.ahead && ! this.routeDone ) {

				if ( ! this.buildNext() ) this.routeDone = true; // limited stage: no road left

			} else if ( this.tileJob ) {

				const r = this.tileJob.steps.next();

				if ( r.done ) {

					this.tiles.set( this.tileJob.key, r.value );
					this.tileJob = null;

				}

			} else {

				// The nearest missing tile, built a row per step
				const next = this.missingTiles( position.x, position.z )[ 0 ];
				if ( ! next ) break;
				this.tileJob = { key: next[ 1 ] + ',' + next[ 2 ], steps: this.tileSteps( next[ 1 ], next[ 2 ] ) };

			}

		} while ( performance.now() - t0 < budget );

		this.dropTiles( position.x, position.z );

	}

	// Grid cells around a chunk's road, clamped to `margin` beyond its bounds
	// (extent: extra { minX, maxX, minZ, maxZ } to cover, the extensions)
	cellRange( path, margin, extent = null ) {

		let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

		for ( let i = 0; i < path.sampleCount; i ++ ) {

			minX = Math.min( minX, path.px[ i ] );
			maxX = Math.max( maxX, path.px[ i ] );
			minZ = Math.min( minZ, path.pz[ i ] );
			maxZ = Math.max( maxZ, path.pz[ i ] );

		}

		if ( extent ) {

			minX = Math.min( minX, extent.minX );
			maxX = Math.max( maxX, extent.maxX );
			minZ = Math.min( minZ, extent.minZ );
			maxZ = Math.max( maxZ, extent.maxZ );

		}

		return {
			gx0: Math.floor( ( minX - margin ) / CELL ), gx1: Math.ceil( ( maxX + margin ) / CELL ),
			gz0: Math.floor( ( minZ - margin ) / CELL ), gz1: Math.ceil( ( maxZ + margin ) / CELL ),
		};

	}

	// A new stretch can run through props planted for an earlier one (the
	// other leg of a switchback): hide the ones too close to it, and drop
	// their colliders. startS / scale: the new stretch's place on the route.
	clearDecorationOn( path, startS, scale ) {

		// The new stretch's bounds: anything farther than its clearance from
		// them is skipped before the exact (per sample) distance
		let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

		for ( let i = 0; i < path.sampleCount; i ++ ) {

			minX = Math.min( minX, path.px[ i ] ); maxX = Math.max( maxX, path.px[ i ] );
			minZ = Math.min( minZ, path.pz[ i ] ); maxZ = Math.max( maxZ, path.pz[ i ] );

		}

		const far = ( x, z, r ) => x < minX - r || x > maxX + r || z < minZ - r || z > maxZ + r;

		for ( const chunk of this.chunks ) {

			let dirty = false;

			for ( const it of chunk.roadside ) {

				if ( it.hidden || far( it.x, it.z, 3.7 + it.clear ) ) continue;
				const n = path.nearest( it.x, it.z, 2 );
				if ( n.dist >= 3.7 + it.clear || Math.abs( startS + n.s * scale - it.s ) < OWN_STRETCH ) continue;
				it.hidden = true;
				this.removeBody( it.body );
				dirty = true;

			}

			if ( dirty ) this.rebuildRoadside( chunk );

		}


		const { gx0, gx1, gz0, gz1 } = this.cellRange( path, CLEAR + CELL );

		for ( let gz = gz0; gz < gz1; gz ++ ) {

			for ( let gx = gx0; gx < gx1; gx ++ ) {

				const cell = this.cells.get( gx + ',' + gz );
				if ( ! cell ) continue;

				for ( const item of cell.items ) {

					if ( item.hidden || far( item.x, item.z, item.clear ) || path.nearest( item.x, item.z, 2 ).dist >= item.clear ) continue;

					item.hidden = true;
					this.removeBody( item.body );
					this.hideProp( cell.chunk, item );

				}

			}

		}

	}

	// Does (x, z) stand in a tent's or a campfire's clearing (the cell's and
	// its neighbours' lists: a clearing is at most 1.3 m, a cell 7.5 m)
	inClearing( x, z ) {

		if ( ! this.clearings.size ) return false;
		const gx = Math.floor( x / CELL ), gz = Math.floor( z / CELL );

		for ( let iz = gz - 1; iz <= gz + 1; iz ++ ) {

			for ( let ix = gx - 1; ix <= gx + 1; ix ++ ) {

				const list = this.clearings.get( ix + ',' + iz );
				if ( list ) for ( const [ cx, cz, r ] of list ) if ( Math.hypot( cx - x, cz - z ) < r + 0.4 ) return true;

			}

		}

		return false;

	}

	// Hides the forest props (trees, stones, Ultra's floor) within r of
	// (x, z) and drops their colliders: a tent or a campfire stands there
	hidePropsNear( x, z, r ) {

		const gx = Math.floor( x / CELL ), gz = Math.floor( z / CELL );

		for ( let iz = gz - 1; iz <= gz + 1; iz ++ ) {

			for ( let ix = gx - 1; ix <= gx + 1; ix ++ ) {

				const cell = this.cells.get( ix + ',' + iz );
				if ( ! cell ) continue;

				for ( const item of cell.items ) {

					if ( item.hidden || Math.hypot( item.x - x, item.z - z ) > r + 0.4 ) continue;
					item.hidden = true;
					this.removeBody( item.body );
					this.hideProp( cell.chunk, item );

				}

			}

		}

	}

	// Props planted one by one on the relief (no flat tiles): each tree or
	// stone sits at the ground height under it, turned and sized at random,
	// sunk a little on slopes, skipped where too steep or too close to the
	// road. Cells (the old tile
	// grid) are claimed once, so overlapping chunks never plant twice.
	* decorate( chunk ) {

		if ( ! this.plantProps ) return;

		const { gx0, gx1, gz0, gz1 } = this.cellRange( chunk.path, this.forestBand, chunk.extent );
		const { trees, stones } = this.props;
		const pines = this.nature ? NATURE_TREES : []; // the Nature Kit's pines and firs join the pool
		const lists = {}; // key → [ x, y, z, rotation, scale, ... ]; '*' + key: the same under snow

		// box: the collider when near the road (default by kind), null = never solid
		const add = ( cell, key, x, y, z, rot, scale, clear, box ) => {

			if ( this.inClearing( x, z ) ) return;

			const listKey = this.snowyAt( x, y, z ) ? '*' + key : key;
			const list = lists[ listKey ] || ( lists[ listKey ] = [] );
			const item = { key: listKey, index: list.length / 5, x, z, clear };
			cell.items.push( item );
			list.push( x, y + this.lift( x, z ), z, rot, scale ); // drawn on the drawn terrain, solid (below) on the 2 m one

			// Solid if the car can reach it: trunks and rocks near the road
			if ( box !== null && this.world && this.route.distanceTo( x, z, COLLIDE_RANGE ) < COLLIDE_RANGE ) {

				const k = scale / TRACK_SCALE;
				const c = box ? box : key.startsWith( 'tree' ) ? { x, y: y + 0.9 * k, z, hx: 0.14 * k, hy: 0.9 * k, hz: 0.14 * k, rot }
					: key.startsWith( 'stone' ) ? { x, y: y + 0.15 * k, z, hx: 0.3 * k, hy: 0.2 * k, hz: 0.3 * k, rot }
					: { x, y: y + 0.5, z, hx: 1.6, hy: 0.5, hz: 1.6, rot };
				item.body = this.addBox( c );
				chunk.bodies.push( item.body );

			}

		};

		// Ground height and steepness at a point, as drawn (the 2 m facets)
		const ground = ( x, z ) => {

			const y = this.terrainAt( x, z, _g3 );
			return { y, grad: Math.sqrt( Math.max( 0, 1 - _g3.y * _g3.y ) ) / _g3.y };

		};

		for ( let gz = gz0; gz < gz1; gz ++ ) {

			for ( let gx = gx0; gx < gx1; gx ++ ) {

				const key = gx + ',' + gz;
				if ( this.cells.has( key ) ) continue;

				const cx = ( gx + 0.5 ) * CELL, cz = ( gz + 0.5 ) * CELL;
				const d = this.route.distanceTo( cx, cz, this.forestBand );
				if ( d >= this.forestBand ) continue;

				const cell = { chunk, items: [] };
				this.cells.set( key, cell );
				yield; // a cell per step (stream() checks its time budget between steps)

				const rand = mulberry32( hash( gx, gz ) ^ this.seed );
				const roadside = d < CLEAR + CELL;

				// The biome's tree density (none on pastures and ridges)
				const nearS = this.route.nearestS( cx, cz, this.forestBand ); // the biome of the road nearest (the game's band: the same as before)
				const treeShare = nearS === null ? 1 : this.route.biomes.at( nearS ).trees;

				// The old tent-camp draw (the Kenney tents tile is never used any
				// more): still taken so every stage keeps its forest
				if ( roadside && d >= CLEAR ) rand();

				// Trees: sparse by the road, dense beyond, one per sub-square of a 3×3 grid
				const count = roadside ? Math.floor( rand() * ( ROADSIDE_TREES + 1 ) ) : FOREST_TREES[ 0 ] + Math.floor( rand() * ( FOREST_TREES[ 1 ] - FOREST_TREES[ 0 ] + 1 ) );
				const slots = [ 0, 1, 2, 3, 4, 5, 6, 7, 8 ];

				for ( let k = 0; k < count; k ++ ) {

					const pick = k + Math.floor( rand() * ( slots.length - k ) );
					[ slots[ k ], slots[ pick ] ] = [ slots[ pick ], slots[ k ] ];

					const x = gx * CELL + ( slots[ k ] % 3 + 0.2 + rand() * 0.6 ) * CELL / 3;
					const z = gz * CELL + ( Math.floor( slots[ k ] / 3 ) + 0.2 + rand() * 0.6 ) * CELL / 3;
					const variant = Math.floor( rand() * ( trees.length + pines.length ) );
					const pine = variant >= trees.length ? pines[ variant - trees.length ] : null;
					let scale = TRACK_SCALE * ( 0.8 + rand() * 0.45 );
					const rot = rand() * Math.PI * 2;
					if ( rand() >= treeShare ) continue;

					if ( this.route.distanceTo( x, z, TREE_CLEAR ) < TREE_CLEAR ) continue;
					const g = ground( x, z );
					if ( g.grad > MAX_TREE_SLOPE || this.onRock( x, z ) ) continue;

					if ( pine ) {

						// Same size spread, the Nature Kit's units
						scale *= NATURE_TREE_SCALE / TRACK_SCALE;
						const tpl = this.nature[ pine ];
						const y = g.y - 0.1 - g.grad * 0.3;
						const trunk = { x, y: y + tpl.size.y * scale * 0.3, z, hx: 0.1 * scale, hy: tpl.size.y * scale * 0.3, hz: 0.1 * scale, rot };
						add( cell, 'n:' + pine, x, y, z, rot, scale, TREE_CLEAR, trunk );

					} else add( cell, 'tree' + variant, x, g.y - 0.1 - g.grad * 0.3 * scale, z, rot, scale, TREE_CLEAR );

				}

				// Solo: as many trees again, from their own stream (the forest above
				// never moves), on the same 3×3 grid shifted half a square, kept
				// off the trees already planted
				if ( this.forest > 1 ) {

					const more = mulberry32( hash( gx, gz ) ^ this.seed ^ 0x7ee5 );
					const planted = cell.items.map( ( it ) => [ it.x, it.z ] );
					const target = planted.length + Math.round( planted.length * ( this.forest - 1 ) );
					const n = Math.round( count * ( this.forest - 1 ) ) * 4; // tries: many fall on a tree, a slope or the road

					for ( let k = 0; k < n && planted.length < target; k ++ ) {

						const slot = Math.floor( more() * 9 );
						const x = gx * CELL + ( ( slot % 3 + 0.5 + 0.2 + more() * 0.6 ) % 3 ) * CELL / 3;
						const z = gz * CELL + ( ( Math.floor( slot / 3 ) + 0.5 + 0.2 + more() * 0.6 ) % 3 ) * CELL / 3;
						const variant = Math.floor( more() * ( trees.length + pines.length ) );
						const pine = variant >= trees.length ? pines[ variant - trees.length ] : null;
						let scale = TRACK_SCALE * ( 0.8 + more() * 0.45 );
						const rot = more() * Math.PI * 2;
						if ( more() >= treeShare ) continue;
						if ( planted.some( ( [ px, pz ] ) => ( px - x ) ** 2 + ( pz - z ) ** 2 < 1.4 * 1.4 ) ) continue;
						if ( this.route.distanceTo( x, z, TREE_CLEAR ) < TREE_CLEAR ) continue;
						const g = ground( x, z );
						if ( g.grad > MAX_TREE_SLOPE || this.onRock( x, z ) ) continue;
						planted.push( [ x, z ] );

						if ( pine ) {

							scale *= NATURE_TREE_SCALE / TRACK_SCALE;
							const tpl = this.nature[ pine ];
							const y = g.y - 0.1 - g.grad * 0.3;
							const trunk = { x, y: y + tpl.size.y * scale * 0.3, z, hx: 0.1 * scale, hy: tpl.size.y * scale * 0.3, hz: 0.1 * scale, rot };
							add( cell, 'n:' + pine, x, y, z, rot, scale, TREE_CLEAR, trunk );

						} else add( cell, 'tree' + variant, x, g.y - 0.1 - g.grad * 0.3 * scale, z, rot, scale, TREE_CLEAR );

					}

				}

				// Stones: now and then, happy on steeper ground than trees
				if ( rand() < ( roadside ? 0.35 : 0.2 ) ) {

					const x = gx * CELL + rand() * CELL, z = gz * CELL + rand() * CELL;
					const variant = Math.floor( rand() * stones.length );
					const scale = TRACK_SCALE * ( 0.9 + rand() * 0.7 );
					const rot = rand() * Math.PI * 2;

					if ( this.route.distanceTo( x, z, STONE_CLEAR ) >= STONE_CLEAR ) {

						const g = ground( x, z );
						if ( g.grad <= MAX_STONE_SLOPE ) add( cell, 'stone' + variant, x, g.y - 0.05 - g.grad * 0.15 * scale, z, rot, scale, STONE_CLEAR );

					}

				}

				if ( this.nature ) this.forestFloor( cell, gx, gz, add );
				this.crag( cell, gx, gz, add );

			}

		}

		// One BatchedMesh per material for the whole chunk (the colormap trees
		// and stones, the Nature Kit pieces): every prop in one multi-draw
		// call, culled one by one against the camera and the shadow camera.
		// A mesh per kind was ~40 draw calls per chunk, twice with shadows:
		// the CPU spent ~20 ms per frame issuing them on an Intel HD 520.
		const base = ( key ) => key.startsWith( '*' ) ? key.slice( 1 ) : key;
		const geometryOf = ( key ) => ( key = base( key ), key.startsWith( 'n:' ) ? this.natureGeometry( key.slice( 2 ) ) : key.startsWith( 'r:' ) ? this.rockGeometry( key.slice( 2 ) ) : key.startsWith( 'tree' ) ? trees[ + key.slice( 4 ) ] : stones[ + key.slice( 5 ) ] );
		const rock = ( key ) => base( key ).startsWith( 'r:' );

		// [ nature, snowy ] per material, then the crags' rocks (one material, no snow look)
		for ( const [ nature, snowy ] of [ [ false, false ], [ true, false ], [ false, true ], [ true, true ], [ null, null ] ] ) {

			const keys = Object.keys( lists ).filter( ( key ) => nature === null ? rock( key ) : ! rock( key ) && base( key ).startsWith( 'n:' ) === nature && key.startsWith( '*' ) === snowy );
			if ( ! keys.length ) continue;

			let instances = 0, vertices = 0;

			for ( const key of keys ) {

				instances += lists[ key ].length / 5;
				vertices += geometryOf( key ).attributes.position.count;

			}

			const material = nature === null ? this.rockMaterial : nature ? ( snowy ? this.snowNatureMaterial : this.natureMaterial ) : snowy ? this.snowTreeMaterial : this.treeMaterial;
			const batch = new THREE.BatchedMesh( instances, vertices, 0, material );
			batch.sortObjects = false; // opaque: no need to sort, saves CPU
			batch.castShadow = true;
			batch.receiveShadow = true;

			for ( const key of keys ) {

				const list = lists[ key ];
				const geometryId = batch.addGeometry( geometryOf( key ) );
				const ids = [];

				for ( let i = 0; i < list.length / 5; i ++ ) {

					_dummy.position.set( list[ i * 5 ], list[ i * 5 + 1 ], list[ i * 5 + 2 ] );
					_dummy.rotation.set( 0, list[ i * 5 + 3 ], 0 );
					_dummy.scale.setScalar( list[ i * 5 + 4 ] );
					_dummy.updateMatrix();
					const id = batch.addInstance( geometryId );
					batch.setMatrixAt( id, _dummy.matrix );
					ids.push( id );

				}

				chunk.props[ key ] = { batch, ids };

			}

			chunk.group.add( batch );
			chunk.batches.push( batch );

		}

	}

	// Stops drawing a forest prop (its chunk's batch may not exist yet: see decorate)
	hideProp( chunk, item ) {

		const p = chunk.props[ item.key ];
		if ( p ) p.batch.setVisibleAt( p.ids[ item.index ], false );

	}

	// Does a prop standing at ( x, y, z ) stand in the snow drawn up high (not
	// in winter: everything is white already)
	snowyAt( x, y, z ) {

		return this.snow && this.terrain.snowAt( x, y, z ) > 0;

	}

	// Is the ground drawn as rock (the rock field buildTile's shader draws,
	// RockEdge.js) at (x, z) or within r of it: no tree, bush or stump grows there
	onRock( x, z, r = 0.6 ) {

		return onRockField( this.rockAt, x, z, r );

	}

	// Rock field of 2 m grid vertex (i, j) (its smooth normal), cached like
	// the heights
	rockVertex( i, j ) {

		const key = ( i + 0x8000 ) * 0x10000 + ( j + 0x8000 );
		let f = this.rocks.get( key );

		if ( f === undefined ) {

			if ( this.rocks.size >= GRID_CACHE_MAX ) this.rocks.clear();
			f = this.rockVertexOf( i, j );
			this.rocks.set( key, f );

		}

		return f;

	}

	// The rock field at (x, z) over the 2 m facets (every graphics mode)
	rockField( x, z ) {

		return rockField( this.rockVertex.bind( this ), x, z, TILE_STEP );

	}

	// A generated rock: 'b<n>' a block in the terrain's rock grey (part of the
	// face), 's<n>' a boulder in the roadside boulders' greys (rockShape)
	rockGeometry( name ) {

		if ( ! this.rockShapes ) {

			let color;

			try {

				color = texelColor( this.material.map, ROCK_UV );

			} catch {

				color = new THREE.Color( 0x5d6275 );

			}

			this.rockShapes = {};

			for ( let i = 0; i < ROCK_SHAPES; i ++ ) {

				this.rockShapes[ 'b' + i ] = rockShape( mulberry32( 0xb10c + i ), true, color );
				this.rockShapes[ 's' + i ] = rockShape( mulberry32( 0x5c1e + i ), false, new THREE.Color( SCREE_GREYS[ i % SCREE_GREYS.length ] ) );

			}

		}

		return this.rockShapes[ name ];

	}

	// Is (x, z) toward the game's fixed camera from a nearby stretch of road
	// (RallyTerrain.js keeps the ground under a plane there): nothing tall
	facesCamera( x, z ) {

		let toward = false;

		this.route.forEachNear( x, z, 30, ( sx, sz ) => {

			const a = ( x - sx ) * Math.SQRT1_2 + ( z - sz ) * Math.SQRT1_2;
			const b = ( x - sx ) * Math.SQRT1_2 - ( z - sz ) * Math.SQRT1_2;
			if ( a > 0 && Math.abs( b ) < 12 ) toward = true;

		} );

		return toward;

	}

	// What dresses the crags of a cell (see CRAG_TRIES): a spot on a steep
	// rock face may get a block standing out of it; a grass spot by the rock
	// (a crag's foot or ledge) scree, a bush or a small pine
	crag( cell, gx, gz, add ) {

		const rand = mulberry32( hash( gx, gz ) ^ this.seed ^ 0xc4a9 );
		const byRock = ( x, z ) => RING.some( ( [ dx, dz ] ) => this.rockField( x + dx, z + dz ) > 0.5 );
		const pick = ( list, u ) => list[ Math.min( list.length - 1, Math.floor( u * list.length ) ) ];
		// Lowest ground (as drawn: Ultra's finer facets too) under a footprint of radius r
		const footY = ( x, z, r ) => {

			let low = this.drawnAt( x, z );
			for ( let k = 0; k < 8; k ++ ) low = Math.min( low, this.drawnAt( x + Math.cos( k * Math.PI / 4 ) * r, z + Math.sin( k * Math.PI / 4 ) * r ) );
			return low - this.lift( x, z ); // add() lifts by the drawn terrain at the centre

		};

		for ( let i = 0; i < CRAG_TRIES; i ++ ) {

			const x = gx * CELL + rand() * CELL, z = gz * CELL + rand() * CELL;
			const a = rand(), b = rand(), c = rand(), rot = rand() * Math.PI * 2;
			if ( this.route.distanceTo( x, z, STONE_CLEAR + 1 ) < STONE_CLEAR + 1 ) continue;

			const y = this.terrainAt( x, z, _n );
			const grad = Math.sqrt( Math.max( 0, 1 - _n.y * _n.y ) ) / _n.y;
			const field = this.rockField( x, z );

			if ( field > 0.5 && grad > 0.9 ) {

				// A block, a third sunk into the face, its whole width off the road
				if ( a >= BLOCK_CHANCE || this.facesCamera( x, z ) ) continue;
				const h = BLOCK_HEIGHT[ 0 ] + b * ( BLOCK_HEIGHT[ 1 ] - BLOCK_HEIGHT[ 0 ] );
				// Standing out of the face: moved downhill by its own radius (its
				// back against the rock), its foot on the lowest ground under it
				// (never hanging over the slope), tall enough to rise h above
				// the face where it was drawn
				const key = 'b' + Math.floor( c * ROCK_SHAPES );
				const unit = this.rockGeometry( key ).userData.radius;
				const out = Math.hypot( _n.x, _n.z ) || 1;
				const ux = _n.x / out, uz = _n.z / out; // downhill
				const px = x + ux * unit * h, pz = z + uz * unit * h;
				let size = h, yb = 0;

				// The foot under the final size's footprint (the taller, the wider)
				for ( let pass = 0; pass < 3; pass ++ ) {

					yb = footY( px, pz, unit * size ) - 0.3;
					size = Math.min( BLOCK_HEIGHT[ 1 ] * 1.6, Math.max( size, y + h * 0.6 - yb ) );

				}

				yb = Math.min( yb, footY( px, pz, unit * size ) - 0.3 );
				const r = unit * size;
				const clear = STONE_CLEAR + 1 + r;
				if ( this.route.distanceTo( px, pz, clear ) < clear ) continue;
				add( cell, 'r:' + key, px, yb, pz, rot, size, STONE_CLEAR, { x: px, y: yb + size / 2, z: pz, hx: r * 0.8, hy: size / 2, hz: r * 0.8, rot } );

			} else if ( field + ROCK_EDGE * 0.5 < 0 && grad < 0.7 && byRock( x, z ) ) {

				if ( a < 0.5 ) {

					const size = SCREE_SIZE[ 0 ] + b * ( SCREE_SIZE[ 1 ] - SCREE_SIZE[ 0 ] );
					const key = 's' + Math.floor( c * ROCK_SHAPES );
					const r = this.rockGeometry( key ).userData.radius * size;
					const yb = footY( x, z, r ) - size * 0.15;
					add( cell, 'r:' + key, x, yb, z, rot, size, STONE_CLEAR, { x, y: yb + size * 0.35, z, hx: r * 0.8, hy: size * 0.35, hz: r * 0.8, rot } );

				} else if ( this.nature && b < 0.6 ) {

					add( cell, 'n:' + pick( NATURE_BUSHES, c ), x, y - 0.04 - grad * 0.12, z, rot, NATURE_SCALE * ( 0.8 + a * 0.6 ), STONE_CLEAR, null );

				} else if ( this.nature ) {

					const name = pick( LEDGE_PINES, c ), scale = NATURE_TREE_SCALE * ( 0.7 + a * 0.4 );
					const tpl = this.nature[ name ];
					const yt = y - 0.1 - grad * 0.3;
					add( cell, 'n:' + name, x, yt, z, rot, scale, TREE_CLEAR, { x, y: yt + tpl.size.y * scale * 0.3, z, hx: 0.1 * scale, hy: tpl.size.y * scale * 0.3, hz: 0.1 * scale, rot } );

				}

			}

		}

	}

	natureGeometry( name ) {

		let g = this.natureGeometries.get( name );
		if ( ! g ) this.natureGeometries.set( name, g = pieceGeometry( this.nature[ name ] ) );
		return g;

	}

	// What grows under the trees of a cell: the dead wood (deadWood, every
	// mode), then in Ultra bushes and spring flowers (their own random
	// streams, so the forest itself is the same in every graphics mode).
	// Everything sits on the ground as drawn (terrainAt: the 2 m facets),
	// sunk by its slope, never on rock; logs only where it is nearly flat,
	// since they are drawn level
	forestFloor( cell, gx, gz, add ) {

		const rand = mulberry32( hash( gx, gz ) ^ this.seed ^ 0x51f15e );
		const spot = ( clear, maxSlope ) => {

			const x = gx * CELL + rand() * CELL, z = gz * CELL + rand() * CELL;
			if ( this.route.distanceTo( x, z, clear ) < clear ) return null;
			const y = this.terrainAt( x, z, _n );
			const grad = Math.sqrt( Math.max( 0, 1 - _n.y * _n.y ) ) / _n.y;
			return grad <= maxSlope && ! this.onRock( x, z ) ? { x, y, z, grad } : null;

		};
		const range = ( [ a, b ] ) => a + Math.floor( rand() * ( b - a + 1 ) );
		const pick = ( list ) => list[ Math.floor( rand() * list.length ) ];

		this.deadWood( cell, gx, gz, add );
		if ( ! this.ultra ) return;

		for ( let i = 0, n = range( FLOOR_BUSHES ); i < n; i ++ ) {

			const name = pick( NATURE_BUSHES ), scale = NATURE_SCALE * ( 0.8 + rand() * 0.7 ), rot = rand() * Math.PI * 2;
			const p = spot( STONE_CLEAR, MAX_BUSH_SLOPE );
			if ( p ) add( cell, 'n:' + name, p.x, p.y - 0.04 - p.grad * 0.12, p.z, rot, scale, STONE_CLEAR, null );

		}

		if ( this.seasonId === 'spring' ) {

			for ( let i = 0, n = range( FLOOR_FLOWERS ); i < n; i ++ ) {

				const name = pick( NATURE_FLOWERS ), scale = NATURE_SCALE * ( 0.7 + rand() * 0.5 ), rot = rand() * Math.PI * 2;
				const p = spot( STONE_CLEAR, MAX_BUSH_SLOPE );
				if ( p && ! this.snowyAt( p.x, p.y, p.z ) ) add( cell, 'n:' + name, p.x, p.y - 0.02 - p.grad * 0.08, p.z, rot, scale, STONE_CLEAR, null );

			}

		}

	}

	// Stumps, fallen logs and (autumn) mushrooms of a cell, in every graphics
	// mode: their own random stream, so the same in Normal and Ultra
	deadWood( cell, gx, gz, add ) {

		const rand = mulberry32( hash( gx, gz ) ^ this.seed ^ 0x570b );
		const spot = ( clear, maxSlope ) => {

			const x = gx * CELL + rand() * CELL, z = gz * CELL + rand() * CELL;
			if ( this.route.distanceTo( x, z, clear ) < clear ) return null;
			const y = this.terrainAt( x, z, _n );
			const grad = Math.sqrt( Math.max( 0, 1 - _n.y * _n.y ) ) / _n.y;
			return grad <= maxSlope && ! this.onRock( x, z ) ? { x, y, z, grad } : null;

		};
		const range = ( [ a, b ] ) => a + Math.floor( rand() * ( b - a + 1 ) );
		const pick = ( list ) => list[ Math.floor( rand() * list.length ) ];

		const solid = ( name, p, rot, scale, sink ) => {

			const tpl = this.nature[ name ];
			const y = p.y - sink;
			add( cell, 'n:' + name, p.x, y, p.z, rot, scale, STONE_CLEAR, { x: p.x, y: y + tpl.size.y * scale / 2, z: p.z, hx: tpl.size.x * scale / 2 * 0.8, hy: tpl.size.y * scale / 2, hz: tpl.size.z * scale / 2 * 0.8, rot } );

		};

		if ( rand() < STUMP_CHANCE ) {

			const name = pick( NATURE_STUMPS ), scale = NATURE_SCALE * ( 0.9 + rand() * 0.5 ), rot = rand() * Math.PI * 2;
			const p = spot( STONE_CLEAR, MAX_STUMP_SLOPE );
			// Sunk so the downhill side of the base does not hang in the air
			if ( p ) solid( name, p, rot, scale, 0.03 + p.grad * this.nature[ name ].size.x * scale * 0.5 );

		}

		if ( rand() < LOG_CHANCE ) {

			const name = pick( NATURE_LOGS ), scale = NATURE_SCALE * ( 0.8 + rand() * 0.4 ), rot = rand() * Math.PI * 2;
			const p = spot( STONE_CLEAR, MAX_LOG_SLOPE );
			if ( p ) solid( name, p, rot, scale, 0.03 + p.grad * this.nature[ name ].size.z * scale * 0.5 );

		}

		if ( this.seasonId === 'autumn' ) {

			for ( let i = 0, n = range( FLOOR_MUSHROOMS ); i < n; i ++ ) {

				const name = pick( NATURE_MUSHROOMS ), scale = NATURE_SCALE * ( 0.8 + rand() * 0.5 ), rot = rand() * Math.PI * 2;
				const p = spot( STONE_CLEAR, MAX_MUSHROOM_SLOPE );
				if ( p && ! this.snowyAt( p.x, p.y, p.z ) ) add( cell, 'n:' + name, p.x, p.y - 0.02 - p.grad * 0.06, p.z, rot, scale, STONE_CLEAR, null );

			}

		}

	}

	// ─── Terrain tiles ────────────────────────────────────

	// Faceted low-poly ground: every triangle its own flat face, grass, with
	// the rock field per vertex (`aRock`): grey rock with a ragged edge where
	// the ground is steep (RockEdge.js)
	buildTile( ix, iz ) {

		const steps = this.tileSteps( ix, iz );
		let r;
		while ( ! ( r = steps.next() ).done );
		return r.value;

	}

	// buildTile a row of heights at a time (a tile near the road is tens of
	// ms of terrain heights); returns the mesh
	* tileSteps( ix, iz ) {

		const S = this.drawStep;
		const N = TILE / S;
		const x0 = ix * TILE, z0 = iz * TILE;
		const heights = new Float32Array( ( N + 1 ) * ( N + 1 ) );
		const snowAt = new Float32Array( ( N + 1 ) * ( N + 1 ) ).fill( - 1 ); // snow field per grid vertex, none in winter (all white already)
		const rockAt = new Float32Array( ( N + 1 ) * ( N + 1 ) ); // rock field per drawn vertex (from the 2 m grid's)
		const shift = new Float32Array( ( N + 1 ) * ( N + 1 ) * 2 ); // steep faces: each vertex off the grid (x, z)
		const steepAt = new Uint8Array( ( N + 1 ) * ( N + 1 ) ); // 1 = a steep vertex
		const winter = this.seasonId === 'winter';

		for ( let j = 0; j <= N; j ++ ) {

			for ( let i = 0; i <= N; i ++ ) {

				const gi = ix * N + i, gj = iz * N + j;
				let h = this.drawnHeight( gi, gj );
				const steep = Math.max( Math.abs( this.drawnHeight( gi + 1, gj ) - this.drawnHeight( gi - 1, gj ) ), Math.abs( this.drawnHeight( gi, gj + 1 ) - this.drawnHeight( gi, gj - 1 ) ) ) / ( 2 * S );
				const w = THREE.MathUtils.smoothstep( steep, STEEP_FROM, STEEP_FULL );
				if ( w > 0 ) {

					steepAt[ j * ( N + 1 ) + i ] = 1;
					const r = mulberry32( hash( gi, gj ) ^ 0x51e7 );
					const a = r() * Math.PI * 2, d = ( 0.5 + 0.5 * r() ) * STEEP_JITTER * S * w;
					shift[ ( j * ( N + 1 ) + i ) * 2 ] = Math.cos( a ) * d;
					shift[ ( j * ( N + 1 ) + i ) * 2 + 1 ] = Math.sin( a ) * d;
					h += ( r() * 2 - 1 ) * STEEP_RISE * w;

				}

				heights[ j * ( N + 1 ) + i ] = h + ROAD_Y + TERRAIN_SINK;
				rockAt[ j * ( N + 1 ) + i ] = this.rockField( x0 + i * S, z0 + j * S );
				if ( ! winter ) snowAt[ j * ( N + 1 ) + i ] = this.terrain.snowField( x0 + i * S, h, z0 + j * S );

			}

			yield;

		}

		const positions = new Float32Array( N * N * 6 * 3 );
		const uvs = new Float32Array( N * N * 6 * 2 );
		const snow = new Float32Array( N * N * 6 ); // snow field per vertex, cut sharp by the shader (Seasons.js SNOW_FRAGMENT)
		const rock = new Float32Array( N * N * 6 );
		const corner = [ [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ] ];
		let v = 0;

		const tri = ( i0, j0, i1, j1, i2, j2 ) => {

			const ij = [ i0, j0, i1, j1, i2, j2 ];

			for ( let c = 0; c < 3; c ++ ) {

				const i = ij[ c * 2 ], j = ij[ c * 2 + 1 ], k = j * ( N + 1 ) + i;
				corner[ c ][ 0 ] = x0 + i * S + shift[ k * 2 ];
				corner[ c ][ 1 ] = heights[ k ];
				corner[ c ][ 2 ] = z0 + j * S + shift[ k * 2 + 1 ];

			}

			for ( let c = 0; c < 3; c ++ ) {

				const k = ij[ c * 2 + 1 ] * ( N + 1 ) + ij[ c * 2 ];
				positions.set( corner[ c ], v * 3 );
				uvs.set( GRASS_UV, v * 2 );
				rock[ v ] = rockAt[ k ];
				// less snow on the rock: it shows through at the edges
				snow[ v ] = snowAt[ k ] - ROCK_SNOW * THREE.MathUtils.clamp( rockAt[ k ] * 0.5 + 0.5, 0, 1 );
				v ++;

			}

		};

		for ( let j = 0; j < N; j ++ ) {

			for ( let i = 0; i < N; i ++ ) {

				// Counter-clockwise seen from above (+Y); a steep quad may take the other diagonal
				const k = j * ( N + 1 ) + i;
				const steep = steepAt[ k ] + steepAt[ k + 1 ] + steepAt[ k + N + 1 ] + steepAt[ k + N + 2 ] >= 3;
				if ( steep && hash( ix * N + i + 7, iz * N + j + 3 ) & 1 ) {

					tri( i, j, i, j + 1, i + 1, j + 1 );
					tri( i, j, i + 1, j + 1, i + 1, j );

				} else {

					tri( i, j, i, j + 1, i + 1, j );
					tri( i + 1, j, i, j + 1, i + 1, j + 1 );

				}

			}

		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
		geometry.setAttribute( 'aSnow', new THREE.BufferAttribute( snow, 1 ) );
		geometry.setAttribute( 'aRock', new THREE.BufferAttribute( rock, 1 ) );
		flatNormals( geometry ); // non-indexed: flat face normals
		geometry.computeBoundingSphere();

		const mesh = new THREE.Mesh( geometry, this.terrainMaterial );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		this.scene.add( mesh );

		return mesh;

	}

	// Builds the missing tiles around (x, z), nearest first, at most `budget`;
	// returns how many
	updateTiles( x, z, budget ) {

		const missing = this.missingTiles( x, z );
		const count = Math.min( budget, missing.length );

		for ( let k = 0; k < count; k ++ ) {

			const [ , ix, iz ] = missing[ k ];
			this.tiles.set( ix + ',' + iz, this.buildTile( ix, iz ) );

		}

		return count;

	}

	// How far the stage is built around the car: terrain tiles within
	// tileRadius, chunks ahead / behind. Changed on the fly (main.js: Ultra's
	// third-person view sees twice as far): streaming catches up over the next
	// frames, and the stage itself stays the same (chunks are built in order)
	setReach( { tileRadius = TILE_BUILD_RADIUS, ahead = AHEAD, behind = BEHIND } = {} ) {

		this.tileBuild = tileRadius;
		this.tileDrop = tileRadius + TILE_DROP_RADIUS - TILE_BUILD_RADIUS;
		this.ahead = ahead;
		this.behind = behind;
		this.lookahead = Math.max( LOOKAHEAD, LOOKAHEAD * tileRadius / TILE_BUILD_RADIUS );
		// Further at once: no tile of the new reach built before its road is laid
		if ( this.route ) this.route.growTo( ( this.distance || 0 ) + this.lookahead );

	}

	// The tiles within tileBuild of (x, z) not built yet, nearest first: [ d, ix, iz ]
	missingTiles( x, z ) {

		const r = Math.ceil( this.tileBuild / TILE );
		const cx = Math.floor( x / TILE ), cz = Math.floor( z / TILE );
		const missing = [];

		for ( let iz = cz - r; iz <= cz + r; iz ++ ) {

			for ( let ix = cx - r; ix <= cx + r; ix ++ ) {

				const d = Math.hypot( ( ix + 0.5 ) * TILE - x, ( iz + 0.5 ) * TILE - z );
				if ( d <= this.tileBuild && ! this.tiles.has( ix + ',' + iz ) ) missing.push( [ d, ix, iz ] );

			}

		}

		missing.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );
		return missing;

	}

	// Drops the tiles past tileDrop of (x, z)
	dropTiles( x, z ) {

		for ( const [ key, mesh ] of this.tiles ) {

			const [ ix, iz ] = key.split( ',' ).map( Number );

			if ( Math.hypot( ( ix + 0.5 ) * TILE - x, ( iz + 0.5 ) * TILE - z ) > this.tileDrop ) {

				this.scene.remove( mesh );
				mesh.geometry.dispose();
				this.tiles.delete( key );

			}

		}

	}

	// Terrain height at grid vertex (i, j) (TILE_STEP apart), cached: tiles,
	// trees, the roadside, the car's ground and onRock all read the same
	// vertices. A vertex is only read once the road near it is laid (the
	// route runs LOOKAHEAD ahead), so it never changes afterwards; the cache
	// starts over past GRID_CACHE_MAX entries.
	gridHeight( i, j ) {

		const key = ( i + 0x8000 ) * 0x10000 + ( j + 0x8000 );
		let h = this.grid.get( key );

		if ( h === undefined ) {

			if ( this.grid.size >= GRID_CACHE_MAX ) this.grid.clear();
			h = this.terrain.heightAt( i * TILE_STEP, j * TILE_STEP );
			this.grid.set( key, h );

		}

		return h;

	}

	// Terrain height at vertex (i, j) of the drawn grid (drawStep apart): the
	// 2 m grid's own vertices come from gridHeight, the others are cached apart
	drawnHeight( i, j ) {

		if ( this.drawStep === TILE_STEP ) return this.gridHeight( i, j );
		const k = TILE_STEP / this.drawStep;
		if ( i % k === 0 && j % k === 0 ) return this.gridHeight( i / k, j / k );

		const key = ( i + 0x8000 ) * 0x10000 + ( j + 0x8000 );
		let h = this.fine.get( key );

		if ( h === undefined ) {

			if ( this.fine.size >= GRID_CACHE_MAX * 3 ) this.fine.clear();
			h = this.terrain.heightAt( i * this.drawStep, j * this.drawStep );
			this.fine.set( key, h );

		}

		return h;

	}

	// The terrain exactly as buildTile draws it (drawStep facets, sunk); same
	// as terrainAt outside Ultra
	drawnAt( x, z ) {

		if ( this.drawStep === TILE_STEP ) return this.terrainAt( x, z );
		const S = this.drawStep;
		const i = Math.floor( x / S ), j = Math.floor( z / S );
		const u = x / S - i, v = z / S - j;
		const h01 = this.drawnHeight( i, j + 1 ), h10 = this.drawnHeight( i + 1, j );
		let h;

		// Same diagonal as buildTile: (i, j+1) – (i+1, j)
		if ( u + v <= 1 ) {

			const h00 = this.drawnHeight( i, j );
			h = h00 + u * ( h10 - h00 ) + v * ( h01 - h00 );

		} else {

			const h11 = this.drawnHeight( i + 1, j + 1 );
			h = h11 + ( 1 - u ) * ( h01 - h11 ) + ( 1 - v ) * ( h10 - h11 );

		}

		return h + ROAD_Y + TERRAIN_SINK;

	}

	// How much higher the drawn terrain is than the 2 m one at (x, z): what a
	// drawn prop is lifted by (placed and made solid on the 2 m terrain)
	lift( x, z ) {

		return this.drawStep === TILE_STEP ? 0 : this.drawnAt( x, z ) - this.terrainAt( x, z );

	}

	// The terrain on the 2 m grid (sunk): the car's ground (groundAt) and every
	// placement decision, in every graphics mode; height, and the facet's
	// normal into `normal` if given
	terrainAt( x, z, normal ) {

		const S = TILE_STEP;
		const i = Math.floor( x / S ), j = Math.floor( z / S );
		const u = x / S - i, v = z / S - j;
		const h01 = this.gridHeight( i, j + 1 ), h10 = this.gridHeight( i + 1, j );
		let h, dx, dz;

		if ( u + v <= 1 ) {

			const h00 = this.gridHeight( i, j );
			dx = ( h10 - h00 ) / S;
			dz = ( h01 - h00 ) / S;
			h = h00 + u * S * dx + v * S * dz;

		} else {

			const h11 = this.gridHeight( i + 1, j + 1 );
			dx = ( h11 - h01 ) / S;
			dz = ( h11 - h10 ) / S;
			h = h11 - ( 1 - u ) * S * dx - ( 1 - v ) * S * dz;

		}

		if ( normal ) normal.set( - dx, 1, - dz ).normalize();
		return h + ROAD_Y + TERRAIN_SINK;

	}

	// Nearest point of the built road to (x, z): the chunk, the path frame
	// (in _g), the route arc length, the signed lateral offset (+ = left) and
	// the dirt half-width on that side
	roadNear( x, z ) {

		let best = null;

		for ( const chunk of this.chunks ) {

			if ( Math.abs( chunk.index - this.current ) > 1 ) continue;
			const n = chunk.path.nearest( x, z, 1 );
			if ( ! best || n.dist < best.n.dist ) best = { chunk, n };

		}

		if ( ! best ) return null;

		const { chunk, n } = best;
		const path = chunk.path, i = n.index;
		const sPath = Math.max( 0, Math.min( path.length, n.s + ( x - path.px[ i ] ) * path.tx[ i ] + ( z - path.pz[ i ] ) * path.tz[ i ] ) );
		path.frameAt( sPath, _g );
		const lateral = ( x - _g.x ) * _g.tz - ( z - _g.z ) * _g.tx;
		const s = chunk.startS + sPath * chunk.scale;

		return { chunk, s, lateral, half: dirtHalfAt( s, lateral > 0 ? - 1 : 1, this.route.widthAt( s ) ), y: _g.y + ROAD_Y, frame: _g };

	}

	// Is (x, z) on the dirt (for the grip)
	onRoad( x, z ) {

		const r = this.roadNear( x, z );
		return !! r && Math.abs( r.lateral ) <= r.half + 0.2;

	}

	// For main.js: where the road is, to tell a fall and put the car back
	nearestRoad( x, z ) {

		const r = this.roadNear( x, z );
		return r ? { s: r.s, y: r.y, dist: Math.max( 0, Math.abs( r.lateral ) - r.half ) } : null;

	}

	// Car placed on the road centre at route arc length s, facing along it
	respawnAt( s ) {

		let chunk = this.chunks[ 0 ];
		for ( const c of this.chunks ) if ( s >= c.startS ) chunk = c;
		const local = Math.max( 0.5, Math.min( chunk.path.length - 0.5, ( s - chunk.startS ) / chunk.scale ) );
		chunk.path.frameAt( local, _f );
		return { position: [ _f.x, _f.y + ROAD_Y + 0.6, _f.z ], angle: Math.atan2( _f.tx, _f.tz ) };

	}

	// Height of what is drawn at (x, z): the faceted terrain exactly as
	// buildTile triangulates it (drawnAt), or the road surface if the
	// point is on the road. For the menu camera, which must stay above it.
	surfaceAt( x, z ) {

		let h = this.drawnAt( x, z );
		if ( this.route.distanceTo( x, z, ROAD_HALF ) < ROAD_HALF ) h = Math.max( h, this.groundAt( x, z, _n ) );
		return h;

	}

	// Ground for the car (the ground proxy and the vehicle's up): the road
	// surface on the dirt (pitched by the grade), the terrain as drawn off it,
	// eased between the two across the verge
	groundAt( x, z, normal ) {

		const r = this.roadNear( x, z );

		if ( ! r ) return this.terrainAt( x, z, normal );

		const g = r.frame;
		const off = Math.abs( r.lateral ) - r.half;
		_a.set( - g.gy * g.tx, 1, - g.gy * g.tz ).normalize(); // road normal

		if ( off <= 0 ) {

			normal.copy( _a );
			return r.y;

		}

		const h = this.terrainAt( x, z, _b );
		if ( off >= VERGE ) {

			normal.copy( _b );
			return h;

		}

		const t = off / VERGE;
		normal.copy( _a ).lerp( _b, t ).normalize();
		return r.y + ( h - r.y ) * t;

	}

	dispose( chunk ) {

		this.scene.remove( chunk.group );
		chunk.roadGeometry.dispose();
		disposeGeometries( chunk.roadsideMesh );

		for ( const batch of chunk.batches ) batch.dispose();
		for ( const body of chunk.bodies ) this.removeBody( body );

		for ( const [ key, cell ] of this.cells ) if ( cell.chunk === chunk ) {

			this.cells.delete( key );
			this.clearings.delete( key ); // its tents are gone with it

		}

	}

	// Call after the physics step (bodies are removed here)
	update( dt, position, hasInput ) {

		// Which chunk the car is on: nearest among the few around the current one
		let best = Infinity, bestChunk = null, bestS = 0;

		for ( const chunk of this.chunks ) {

			if ( Math.abs( chunk.index - this.current ) > 1 ) continue;

			const n = chunk.path.nearest( position.x, position.z, 2 );

			if ( n.dist < best ) {

				best = n.dist;
				bestChunk = chunk;
				bestS = chunk.startS + n.s;

			}

		}

		if ( bestChunk ) {

			this.current = bestChunk.index;
			const progress = bestS - this.distance;

			if ( progress > 0 ) {

				// The first fix is the spawn point, not driven distance
				if ( this.odometer && this.placed ) this.odometer.add( progress );
				this.distance = bestS;

			}

			this.placed = true;

		}

		if ( this.autoStream ) this.stream( position );

		if ( ! this.running && hasInput && ! this.finished ) this.running = true;
		SPECTATOR_TIME.value += dt; // Ultra: the crowd moves
		if ( this.running ) this.time += dt;

		// Arrival: the clock stops as the car passes under the arch
		if ( this.running && this.finishS !== null && this.distance >= this.finishS ) {

			this.running = false;
			this.finished = true;
			if ( this.onFinish ) this.onFinish( this.time );

		}

		if ( ! this.timeEl ) return;

		const shown = this.finished ? this.length : Math.min( this.distance, this.length || Infinity );
		setText( this.timeEl, formatTime( this.time ) );
		setText( this.distanceEl, ( shown / 1000 ).toFixed( 2 ) + ( this.length ? ` / ${ ( this.length / 1000 ).toFixed( 0 ) } km` : ' km' ) );
		if ( this.odometer ) setText( this.totalEl, formatKm( this.odometer.total ) );
		if ( this.barEl ) {

			const width = ( 100 * shown / this.length ).toFixed( 1 ) + '%';
			if ( this.barEl.style.width !== width ) this.barEl.style.width = width;

		}

	}

	// Is this body a spectator still standing?
	isSpectator( body ) {

		const e = this.bodyItems.get( body );
		return !! e && e.item.spectator && ! e.item.fallen;

	}

	// The car ran into a spectator: they fall over, the car goes through now.
	// Call outside the physics step (removes a body). True if it was one.
	hitSpectator( body ) {

		if ( ! this.isSpectator( body ) ) return false;
		const { chunk, item } = this.bodyItems.get( body );
		item.fallen = true;
		this.removeBody( body );
		this.rebuildRoadside( chunk );
		return true;

	}

	rebuildRoadside( chunk ) {

		chunk.group.remove( chunk.roadsideMesh );
		disposeGeometries( chunk.roadsideMesh );
		chunk.roadsideMesh = this.roadside.build( chunk.roadside );
		chunk.group.add( chunk.roadsideMesh );

	}

	// Removes everything from the scene (the menu rebuilds its stage for another season)
	destroy() {

		this.pending = null;
		this.tileJob = null; // never added to the scene
		for ( const chunk of this.chunks ) this.dispose( chunk );
		this.chunks = [];

		for ( const mesh of this.tiles.values() ) {

			this.scene.remove( mesh );
			mesh.geometry.dispose();

		}

		this.tiles.clear();
		this.dirtMaterial.map.dispose();
		this.dirtMaterial.userData.snowMap?.dispose();
		this.dirtMaterial.dispose();

	}

	// Seconds added to the clock (off the road and put back, a spectator hit)
	addPenalty( seconds ) {

		if ( this.finished ) return;
		this.time += seconds;
		this.penalties = ( this.penalties || 0 ) + seconds;

	}

	buildUI() {

		useHudTheme();
		const el = document.createElement( 'div' );
		el.id = 'rally-hud';
		el.className = 'hud-timer hud-float';
		el.innerHTML =
			`<div class="head">${ t( 'hud.stage' ) } #${ this.seed }</div>` +
			'<div class="time hud-num">0:00.000</div>' +
			( this.length ? '<div class="bar"><i></i></div>' : '' ) +
			'<div class="rows">' +
			`<div class="row"><span class="hud-label">${ t( 'hud.distance' ) }</span><b class="dist">0.00 km</b><small></small></div>` +
			( this.odometer ? `<div class="row"><span class="hud-label">${ t( 'hud.total' ) }</span><b class="total">${ formatKm( this.odometer.total ) }</b><small></small></div>` : '' ) +
			'</div>';
		document.body.appendChild( el );

		this.timeEl = el.querySelector( '.time' );
		this.distanceEl = el.querySelector( '.dist' );
		this.barEl = el.querySelector( '.bar i' );
		this.totalEl = el.querySelector( '.total' );

	}

}

// A mesh or a group of meshes (roadside in Ultra)
function disposeGeometries( object ) {

	object.traverse( ( o ) => { if ( o.geometry ) o.geometry.dispose(); } );

}

// HUD text is written only when it changes (no DOM work on most frames)
function setText( el, text ) {

	if ( el.textContent !== text ) el.textContent = text;

}
