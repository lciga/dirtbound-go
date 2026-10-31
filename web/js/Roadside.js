import * as THREE from 'three';
import { ROAD_Y } from './SplineTrack.js';
import { vertexRock, rockField, onRockField } from './RockEdge.js';
import { dirtHalfAt } from './DirtRoad.js';
import { season, SEASONS } from './Seasons.js';
import { KIT_SCALE, flatNormals, kitAdd, kitBox, texturedMeshes, NATURE_SCALE, NATURE_TENT_SCALE, NATURE_TENTS, NATURE_FIRES } from './Kit.js';

// What lines a rally stage: red and white marker posts on the outside of the
// bends, wooden fences with spectators behind them (on the safe side, never
// above the drop), sponsor banners, tape along the cliff edges, straw bales
// at the hairpins, boulders and bushes on the verge. Everything is built in
// code, low-poly with vertex colours, and merged into one mesh per chunk.
// With the Kenney racing kit loaded (Kit.js) the start / finish areas also
// get low barriers, cones, start lights, kit flags, marquees and a TV
// camera (no grandstands nor billboards on a stage); along the
// stage, cones at the hairpins, a single low barrier now and then and
// kit trees.
//
// plan() is seeded by the route arc length, so a stage is always dressed the
// same way. Items keep their position and clearance so RallyStage can hide
// the ones a later stretch of road runs through (and drop their colliders).

const STATION = 6; // m between placement decisions along the road
const CORNER = 1 / 26; // 1/m: curvature above which a stretch is a bend
const HAIRPIN = 1 / 11;
const TERRAIN_SINK = - 0.15;
const TILE_STEP = 2; // m, the terrain facets as RallyStage draws them
const ROAD_CLEAR = 3.7; // m from another stretch's centreline: its dirt, whatever the width noise
const OWN_STRETCH = 22; // m of arc length around an item that count as its own road
const CROWD_GAP = 16; // m of road at least between two crowds
const MAX_FIRE_SLOPE = 0.5; // campfires and tents only on gentle ground (the top of a bank)
const MAX_TENT_SLOPE = 0.3;
const MAX_STAND_SLOPE = 1; // rise per metre (45°) above which nobody stands (the rock face of a bank)
const SKIRT = 0.8; // m of verge past the dirt edge, rising to the road (DirtRoad.js)

const WOOD = [ 0x7a5534, 0x6b4a2f, 0x86603b ];
const JACKETS = [ 0xe8590c, 0x2f6bd8, 0xd93b3b, 0xf2c230, 0x2e9e5b, 0xffffff, 0x1f2430, 0x8e44ad, 0x00a3c4 ];
const TROUSERS = [ 0x34425a, 0x2b2b2b, 0x4a4f57, 0x5b4636 ];
const SKIN = [ 0xf0cda8, 0xd9a77e, 0xa9714b, 0x7a4b2e ];
const SPONSORS = [ [ 0xe8590c, 0xffffff ], [ 0x2f6bd8, 0xf2c230 ], [ 0xffffff, 0xd93b3b ], [ 0x1f2430, 0xe8590c ], [ 0xf2c230, 0x1f2430 ] ];

function hash( a, b ) {

	let h = Math.imul( a | 0, 374761393 ) + Math.imul( b | 0, 668265263 );
	h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
	return ( h ^ ( h >>> 16 ) ) >>> 0;

}

function mulberry( seed ) {

	let t = seed >>> 0;

	return () => {

		t = ( t + 0x6D2B79F5 ) >>> 0;
		let r = Math.imul( t ^ ( t >>> 15 ), 1 | t );
		r = ( r + Math.imul( r ^ ( r >>> 7 ), 61 | r ) ) ^ r;
		return ( ( r ^ ( r >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

const pick = ( rand, list ) => list[ Math.floor( rand() * list.length ) ];

// ─── Geometry: flat-shaded boxes and blobs into shared arrays ────

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

const BOX = new THREE.BoxGeometry( 1, 1, 1 ).toNonIndexed();
const BLOB = new THREE.IcosahedronGeometry( 1, 0 ); // already non-indexed

class Builder {

	// animated: also records, per vertex, what the spectator shader needs
	// (see SPECTATOR_MATERIAL): feet, shoulder, sideways axis, phase / cheer /
	// body part / on
	constructor( animated = false ) {

		this.positions = [];
		this.colors = [];
		this.textured = new Map(); // kit pieces with a texture (Kit.js)
		this.animated = animated;

		if ( animated ) {

			this.pivot = [];
			this.shoulder = [];
			this.side = [];
			this.anim = [];
			this.current = null;
			this.part = 0;

		}

	}

	// Where every array of vertices stands, before an item is drawn
	mark() {

		return {
			positions: this.positions.length,
			pivot: this.animated ? this.pivot.length : 0,
			shoulder: this.animated ? this.shoulder.length : 0,
			textured: new Map( [ ...this.textured ].map( ( [ map, t ] ) => [ map, t.positions.length ] ) ),
		};

	}

	// Raises everything added since liftFrom (mark()) by dy
	liftBy( dy ) {

		const from = this.liftFrom;
		const raise = ( list, start ) => { for ( let i = start + 1; i < list.length; i += 3 ) list[ i ] += dy; };
		raise( this.positions, from.positions );

		if ( this.animated ) {

			raise( this.pivot, from.pivot );
			raise( this.shoulder, from.shoulder );

		}

		for ( const [ map, t ] of this.textured ) raise( t.positions, from.textured.get( map ) || 0 );
		this.liftFrom = null;

	}

	// The spectator the next parts belong to: { pivot, shoulders: [ left, right ], side, phase, cheer, on }
	animate( rec ) {

		if ( ! this.animated ) return;
		this.current = rec;
		this.part = 0;

	}

	// 0 body, 1 left arm, 2 right arm
	setPart( part ) {

		if ( this.animated ) this.part = part;

	}

	// A template (non-indexed unit geometry) placed by position / rotation / scale
	add( template, x, y, z, sx, sy, sz, color, rotY = 0, rotX = 0, rotZ = 0 ) {

		_c.set( color ); // sRGB hex → working (linear) colour
		_m.compose( _p.set( x, y, z ), _q.setFromEuler( _e.set( rotX, rotY, rotZ, 'YXZ' ) ), _s.set( sx, sy, sz ) );
		const pos = template.attributes.position;

		for ( let i = 0; i < pos.count; i ++ ) {

			_v.fromBufferAttribute( pos, i ).applyMatrix4( _m );
			this.positions.push( _v.x, _v.y, _v.z );
			this.colors.push( _c.r, _c.g, _c.b );

			if ( this.animated ) {

				const r = this.current;
				const sh = this.part > 0 ? r.shoulders[ this.part - 1 ] : r.pivot;
				this.pivot.push( ...r.pivot );
				this.shoulder.push( ...sh );
				this.side.push( ...r.side );
				this.anim.push( r.phase, r.cheer, this.part, r.on );

			}

		}

	}

	// A racing kit piece (Kit.js kitAdd)
	kit( tpl, x, y, z, rot, scale, opts ) {

		kitAdd( this, tpl, x, y, z, rot, scale, opts );

	}

	geometry() {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.positions, 3 ) );
		g.setAttribute( 'color', new THREE.Float32BufferAttribute( this.colors, 3 ) );
		flatNormals( g ); // non-indexed: flat faces

		if ( this.animated ) {

			g.setAttribute( 'aPivot', new THREE.Float32BufferAttribute( this.pivot, 3 ) );
			g.setAttribute( 'aShoulder', new THREE.Float32BufferAttribute( this.shoulder, 3 ) );
			g.setAttribute( 'aSide', new THREE.Float32BufferAttribute( this.side, 2 ) );
			g.setAttribute( 'aAnim', new THREE.Float32BufferAttribute( this.anim, 4 ) );

		}

		g.computeBoundingSphere();
		g.boundingSphere.radius += 0.3; // room for the hops and waves
		return g;

	}

}

// Local frame helpers: a point `lat` to the left of the road and `along` it
function place( f, lat, along ) {

	return { x: f.x + f.tz * lat + f.tx * along, z: f.z - f.tx * lat + f.tz * along };

}

export const ROADSIDE_MATERIAL = new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true } );
const FLAME_MATERIAL = new THREE.MeshBasicMaterial( { vertexColors: true } ); // campfire flames: glow, no shading

// ─── Animated spectators (Ultra) ──────────────────────────
// Moved on the GPU from per-vertex data: cheering ones hop and wave their
// arms over their heads, the others sway and swing their arms a little; the
// fallen stay still. RallyStage advances SPECTATOR_TIME.

export const SPECTATOR_TIME = { value: 0 };

const SPECTATOR_VERTEX = /* glsl */`
	{ // own scope: no clash with three's variables
	vec3 p = transformed;
	float t = uSpectatorTime + aAnim.x;
	float cheer = aAnim.y, part = aAnim.z, on = aAnim.w;
	vec3 S = vec3( aSide.x, 0.0, aSide.y );

	if ( part > 0.5 ) {

		// Arm: turned about the shoulder in the body's side plane
		float dir = part < 1.5 ? - 1.0 : 1.0;
		float ang = on * ( cheer * sin( t * 7.0 ) * 0.55 + ( 1.0 - cheer ) * sin( t * 2.2 ) * 0.12 ) * dir;
		vec3 d = p - aShoulder;
		float du = d.y, ds = dot( d, S );
		vec3 rest = d - S * ds - vec3( 0.0, du, 0.0 );
		float c = cos( ang ), s = sin( ang );
		p = aShoulder + S * ( du * s + ds * c ) + vec3( 0.0, du * c - ds * s, 0.0 ) + rest;

	}

	// Whole body: hops for the cheering, a slow sway for the others
	float hop = on * cheer * max( 0.0, sin( t * 4.6 ) ) * 0.07;
	float sway = on * ( 1.0 - cheer ) * sin( t * 1.4 ) * 0.06 * ( p.y - aPivot.y );
	p.y += hop;
	p += S * sway;
	transformed = p;
	}
`;

function animateSpectators( material ) {

	material.onBeforeCompile = ( shader ) => {

		shader.uniforms.uSpectatorTime = SPECTATOR_TIME;
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nuniform float uSpectatorTime;\nattribute vec3 aPivot;\nattribute vec3 aShoulder;\nattribute vec2 aSide;\nattribute vec4 aAnim;' )
			.replace( '#include <begin_vertex>', '#include <begin_vertex>\n' + SPECTATOR_VERTEX );

	};

	material.customProgramCacheKey = () => 'spectators';
	return material;

}

export const SPECTATOR_MATERIAL = animateSpectators( new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true } ) );
const SPECTATOR_DEPTH = animateSpectators( new THREE.MeshDepthMaterial( { depthPacking: THREE.RGBADepthPacking } ) ); // shadows move too

export class Roadside {

	// terrain: RallyTerrain (heightAt), route: RallyRoute (distanceTo)
	// ultra: spectators animated (their own mesh and shader); seasonId: the
	// bushes' colours, spring flowers, winter snowbanks (Seasons.js)
	// kit: the racing kit pieces (Kit.js loadKit), or null
	// nature: the Nature Kit pieces (Kit.js loadNature), or null: tents and
	// campfires by the crowds (its pines are in the forest, RallyStage)
	constructor( seed, terrain, route, ultra = false, seasonId = 'summer', kit = null, nature = null ) {

		this.kit = kit;
		this.nature = nature;
		this.ultra = ultra;
		this.season = season( seasonId );
		this.seasonId = seasonId;
		this.seed = seed;
		this.terrain = terrain;
		this.route = route;
		this.lastCrowd = - Infinity;
		this.vertices = new Map(); // terrain grid heights (groundY), emptied at each plan()

	}

	// The season's colours at p, winter's where the snow up high lies
	// (RallyTerrain.snowAt, as the terrain draws it)
	seasonAt( p ) {

		return this.snowy( p ) ? SEASONS.winter : this.season;

	}

	snowy( p ) {

		return this.seasonId !== 'winter' && this.terrain.snowAt( p.x, this.groundY( p.x, p.z ), p.z ) > 0;

	}

	// Half-width of the dirt at s on `side` (-1 left, +1 right), the biome's width included
	half( s, side ) {

		return dirtHalfAt( s, side, this.route.widthAt( s ) );

	}

	// Ground as drawn: the 2 m terrain facets exactly as RallyStage.buildTile
	// triangulates them (same diagonal as RallyStage.terrainAt), not the
	// smooth relief: on steep banks the two differ by tens of cm, and people
	// stood half in the ground. Grid heights are cached during a plan().
	groundY( x, z ) {

		const S = TILE_STEP;
		const i = Math.floor( x / S ), j = Math.floor( z / S );
		const u = x / S - i, v = z / S - j;
		const h01 = this.vertex( i, j + 1 ), h10 = this.vertex( i + 1, j );
		const h = u + v <= 1
			? this.vertex( i, j ) * ( 1 - u - v ) + h10 * u + h01 * v
			: this.vertex( i + 1, j + 1 ) * ( u + v - 1 ) + h01 * ( 1 - u ) + h10 * ( 1 - v );
		return h + ROAD_Y + TERRAIN_SINK;

	}

	// Is the ground drawn as rock here (RallyStage's rock field, RockEdge.js),
	// or within r: no tree there
	onRock( x, z, r = 0.6 ) {

		const rock = this.rockVertex || ( ( i, j ) => vertexRock( ( a, b ) => this.vertex( a, b ), i, j, TILE_STEP ) );
		return onRockField( ( px, pz ) => rockField( rock, px, pz, TILE_STEP ), x, z, r );

	}

	vertex( i, j ) {

		if ( this.gridHeight ) return this.gridHeight( i, j ); // RallyStage's cache
		const key = ( i + 0x8000 ) * 0x10000 + ( j + 0x8000 );
		let h = this.vertices.get( key );
		if ( h === undefined ) this.vertices.set( key, h = this.terrain.heightAt( i * TILE_STEP, j * TILE_STEP ) );
		return h;

	}

	// Highest ground under a footprint of radius r around (x, z): what feet stand on
	footY( x, z, r ) {

		let y = this.groundY( x, z );
		for ( const [ dx, dz ] of [ [ r, 0 ], [ - r, 0 ], [ 0, r ], [ 0, - r ] ] ) y = Math.max( y, this.groundY( x + dx, z + dz ) );
		return y;

	}

	// Items for a chunk: its path, route arc length at its start, route m per
	// path m; hubs: arc lengths of a start / finish banner in this chunk, dressed
	// as a crowded rally control (hub)
	plan( path, startS, scale, people = true, hubs = [] ) {

		this.vertices.clear(); // the relief near this chunk is final now (the route is laid far ahead)
		const items = [];
		const endS = startS + path.length * scale;
		const f = {}, fa = {}, fb = {};

		// Road frame at arc length s. Past this chunk's ends the road belongs to
		// another chunk and bends its own way: the frame is clamped to the end
		// and `false` returned, so runs of posts / fences / tape stop there
		// (carried on straight, they cut across the road). Only the stretches
		// drawn straight before the start and after the finish are carried on
		// (a hub spreads over them).
		const routeEnd = this.route.finished ? this.route.length : Infinity;
		const frame = ( s, out ) => {

			const edge = s < startS ? startS : s > endS ? endS : s;
			path.frameAt( ( edge - startS ) / scale, out );
			if ( edge === s ) return true;
			if ( s > 0 && s < routeEnd ) return false;
			const d = s - edge;
			out.x += out.tx * d;
			out.z += out.tz * d;
			return true;

		};

		for ( const { s: hubS, kind } of hubs ) {

			const first = items.length;
			this.hub( items, frame, hubS, people, mulberry( hash( this.seed ^ 0x5eed, Math.round( hubS ) ) ) );
			if ( this.kit ) this.kitHub( items, frame, hubS, kind, mulberry( hash( this.seed ^ 0xc1c, Math.round( hubS ) ) ) );
			for ( let i = first; i < items.length; i ++ ) items[ i ].s = hubS;

		}

		for ( let s = Math.ceil( startS / STATION ) * STATION; s < endS; s += STATION ) {

			if ( s < 14 ) continue; // the start area stays clear

			frame( s, f );
			frame( s - 3, fa );
			frame( s + 3, fb );
			let turn = Math.atan2( fb.tx, fb.tz ) - Math.atan2( fa.tx, fa.tz );
			turn = Math.atan2( Math.sin( turn ), Math.cos( turn ) );
			const k = turn / 6; // > 0: bending left
			const station = Math.round( s / STATION );
			const first = items.length;

			for ( const side of [ 1, - 1 ] ) { // + = left of the road

				const rand = mulberry( hash( this.seed ^ station, side > 0 ? 7 : 13 ) );
				const extra = mulberry( hash( this.seed ^ station, side > 0 ? 29 : 31 ) ); // season-only decor: never shifts the obstacles
				const kitRand = mulberry( hash( this.seed ^ station, side > 0 ? 37 : 41 ) ); // racing kit pieces: their own draws too
				const half = this.half( s, side > 0 ? - 1 : 1 );
				const lat = ( d ) => side * ( half + d );
				const biome = this.route.biomes.at( s ); // crowd and tree shares of the biome

				// What is on this side: the drop, a bank, or flat ground
				const probe = place( f, lat( 3.5 ), 0 );
				const rel = this.terrain.heightAt( probe.x, probe.z ) - f.y;
				const cliff = rel < - 1.2;
				const bank = rel > 0.8;

				const corner = Math.abs( k ) > CORNER;
				const outside = corner && Math.sign( k ) !== side;
				const add = ( item ) => items.push( item );
				const plant = ( item ) => { if ( ! this.onRock( item.x, item.z, 0.3 ) ) items.push( item ); }; // bushes, flowers: not on rock

				if ( outside ) {

					if ( cliff ) {

						if ( rand() < 0.9 ) this.tape( items, frame, s, side, half, rand );

					} else {

						add( this.post( f, lat( 0.55 ), - 1.5 ) );
						if ( rand() < 0.8 ) add( this.post( f, lat( 0.55 ), 1.5 ) );
						if ( Math.abs( k ) > HAIRPIN && rand() < 0.9 ) this.bales( items, f, lat( 0.9 ), side, rand );

						// Cones along the outside of a hairpin
						if ( this.kit && Math.abs( k ) > HAIRPIN && kitRand() < 0.6 ) for ( const along of [ - 2.2, 0, 2.2 ] ) {

							const p = place( f, lat( 0.3 ), along );
							add( this.piece( 'pylon', p, kitRand() * 6, KIT_SCALE * 1.2, { clear: 0.15, y: this.edgeY( p, f, 0.3 ) } ) );

						}

					}

				} else if ( ! corner && station % 2 === 0 && ! cliff && rand() < 0.85 ) {

					add( this.post( f, lat( 0.6 ), 0 ) );

				}

				// Spectators: at the bends, on the inside or a bank, never above the drop
				if ( people && ! cliff && corner && ( ! outside || bank ) && s - this.lastCrowd > CROWD_GAP && rand() < Math.min( 0.95, 0.7 * biome.crowd ) ) {

					this.lastCrowd = s;
					this.crowd( items, frame, s, side, half, rand );
					if ( this.kit ) kitRand(); // was a kit flag: none mid-stage (start / finish only); the draw keeps the stream

				} else if ( people && ! cliff && ! corner && rand() < ( bank ? 0.15 : 0.06 ) * biome.crowd ) {

					const n = 1 + Math.floor( rand() * 3 );
					for ( let i = 0; i < n; i ++ ) this.spectator( items, place( f, lat( 1.8 + rand() * 1.5 ), ( rand() - 0.5 ) * 4 ), f, side, rand );

				}

				// Rocks and bushes on the verge, two or three times the old count
				if ( ! cliff ) {

					for ( let i = 0; i < 2; i ++ ) if ( rand() < 0.1 ) add( this.boulder( place( f, lat( 0.8 + rand() * 1.2 ), ( rand() - 0.5 ) * 5 ), rand ) );
					for ( let i = 0; i < 3; i ++ ) if ( rand() < 0.22 ) plant( this.bush( place( f, lat( 1.0 + rand() * 3 ), ( rand() - 0.5 ) * 6 ), rand ) );
					if ( this.season.moreBushes ) for ( let i = 0; i < 3; i ++ ) if ( extra() < 0.3 ) plant( this.bush( place( f, lat( 1.0 + extra() * 3.5 ), ( extra() - 0.5 ) * 6 ), extra ) );
					if ( this.season.flowers ) for ( let i = 0; i < 3; i ++ ) if ( extra() < 0.5 ) {

						const bloom = this.flowers( place( f, lat( 0.8 + extra() * 3.2 ), ( extra() - 0.5 ) * 6 ), extra );
						if ( ! this.snowy( bloom ) ) plant( bloom ); // none in the snow

					}

				}

				// Racing kit: a low barrier now and then, trees on the verge
				if ( this.kit && ! cliff ) {

					const standing = ( p ) => this.groundY( p.x, p.z ) > f.y + ROAD_Y - 0.6;

					// Now and then a single low barrier on the verge
					if ( kitRand() < 0.03 ) this.lowBarrier( items, frame, s + ( kitRand() - 0.5 ) * 4, side, 0.6, kitRand );

					if ( kitRand() < 0.2 * biome.trees ) {

						const p = place( f, lat( 2.6 + kitRand() * 3.4 ), ( kitRand() - 0.5 ) * 5 );
						if ( standing( p ) && ! this.onRock( p.x, p.z ) ) add( this.kitTree( p, kitRand ) );

					}

				}

				// Winter, or the snow up high: snow ploughed onto the verges
				if ( ( this.seasonId === 'winter' || this.snowy( f ) ) && extra() < 0.6 ) add( this.snowbank( place( f, lat( 0.55 + extra() * 0.3 ), ( extra() - 0.5 ) * 3 ), extra ) );

				if ( cliff && rand() < 0.2 ) {

					add( this.boulder( place( f, lat( 0.7 + rand() * 0.3 ), ( rand() - 0.5 ) * 4 ), rand ) ); // a rock on the lip

				}

			}

			for ( let i = first; i < items.length; i ++ ) items[ i ].s = s;

		}

		// Nothing on another stretch of road (switchbacks)
		return items.filter( ( it ) => this.route.distanceToOther( it.x, it.z, ROAD_CLEAR + it.clear, it.s, OWN_STRETCH ) >= ROAD_CLEAR + it.clear );

	}

	// ─── Items: { x, z, clear = own radius, draw( builder ), collider?, s (set by plan) } ────

	post( f, lat, along ) {

		const p = place( f, lat, along );
		const y = this.groundY( p.x, p.z );

		return { x: p.x, z: p.z, clear: 0.1,
			collider: { x: p.x, y: y + 0.35, z: p.z, hx: 0.05, hy: 0.35, hz: 0.05, rot: 0 },
			draw: ( b ) => {

			b.add( BOX, p.x, y + 0.14, p.z, 0.07, 0.28, 0.07, 0xf4f4f4 );
			b.add( BOX, p.x, y + 0.38, p.z, 0.07, 0.2, 0.07, 0xd93b3b );
			b.add( BOX, p.x, y + 0.56, p.z, 0.07, 0.16, 0.07, 0xf4f4f4 );
			b.add( BOX, p.x, y + 0.66, p.z, 0.075, 0.04, 0.075, 0xd93b3b );

		} };

	}

	bales( items, f, lat, side, rand ) {

		const a = Math.atan2( f.tx, f.tz );

		for ( let i = - 1; i <= 1; i ++ ) {

			const p = place( f, lat + side * rand() * 0.1, i * 0.55 );
			const y = this.groundY( p.x, p.z );

			items.push( { x: p.x, z: p.z, clear: 0.3,
				collider: { x: p.x, y: y + 0.16, z: p.z, hx: 0.27, hy: 0.16, hz: 0.17, rot: a },
				draw: ( b ) => {

					b.add( BOX, p.x, y + 0.16, p.z, 0.52, 0.3, 0.32, 0xd9b54a, a );
					b.add( BOX, p.x, y + 0.16, p.z, 0.04, 0.31, 0.33, 0xb28c30, a );

				} } );

		}

	}

	tape( items, frame, s, side, half, rand ) {

		const f = {};
		const len = 10 + rand() * 8;
		let prev = null;

		for ( let d = 0; d <= len; d += 1.5 ) {

			if ( ! frame( s + d, f ) ) break; // the chunk ends here
			const p = place( f, side * ( this.half( s + d, side > 0 ? - 1 : 1 ) + 0.7 ), 0 );
			p.y = this.groundY( p.x, p.z );

			items.push( { x: p.x, z: p.z, clear: 0.1,
				collider: { x: p.x, y: p.y + 0.25, z: p.z, hx: 0.03, hy: 0.25, hz: 0.03, rot: 0 },
				draw: ( b ) => b.add( BOX, p.x, p.y + 0.25, p.z, 0.035, 0.5, 0.035, 0xf4f4f4 ) } );

			if ( prev ) {

				const a = prev, c = p;
				const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot( dx, dz );
				const rot = Math.atan2( dx, dz );

				items.push( { x: ( a.x + c.x ) / 2, z: ( a.z + c.z ) / 2, clear: 0.1,
					collider: { x: ( a.x + c.x ) / 2, y: ( a.y + c.y ) / 2 + 0.3, z: ( a.z + c.z ) / 2, hx: 0.03, hy: 0.3, hz: l / 2, rot },
					draw: ( b ) => {

					// Red and white stripes, sagging a little
					const n = 3;

					for ( let i = 0; i < n; i ++ ) {

						const t = ( i + 0.5 ) / n;
						const sag = Math.sin( t * Math.PI ) * 0.05;
						b.add( BOX, a.x + dx * t, a.y + ( c.y - a.y ) * t + 0.42 - sag, a.z + dz * t, 0.01, 0.05, l / n, i % 2 ? 0xf4f4f4 : 0xd93b3b, rot );

					}

				} } );

			}

			prev = p;

		}

	}

	// A start / finish area around the banner at arc length s: on both sides
	// fences covered in sponsor banners (a gap at the banner's poles), a thick
	// crowd behind them, flags, a marquee, straw bales at the poles
	hub( items, frame, s, people, rand ) {

		const f = {};
		const SPAN = 15, GAP = 1.6;

		for ( const side of [ 1, - 1 ] ) {

			const lat = ( si, d ) => side * ( this.half( si, side > 0 ? - 1 : 1 ) + d );

			this.fence( items, frame, s - SPAN, s - GAP, side, 1.4, rand, 1 );
			this.fence( items, frame, s + GAP, s + SPAN, side, 1.4, rand, 1 );

			// Flags on poles along the fences
			for ( let d = - SPAN + 1; d <= SPAN - 1; d += 3 ) {

				if ( Math.abs( d ) < GAP + 0.5 || rand() < 0.3 || ! frame( s + d, f ) ) continue;
				this.flag( items, place( f, lat( s + d, 1.25 ), 0 ), f, rand );

			}

			// Bales at the foot of the banner
			frame( s, f );
			for ( const along of [ - 1.3, 1.3 ] ) this.bales( items, { ...f, x: f.x + f.tx * along * 1.8, z: f.z + f.tz * along * 1.8 }, lat( s, 0.9 ), side, rand );

			// Nobody stands on a slope falling away from the road (the cliff side)
			const standing = ( p, fr ) => this.groundY( p.x, p.z ) > fr.y + ROAD_Y - 0.6;

			// A marquee behind the crowd, one side ahead, the other behind
			const tentOk = frame( s + side * 9, f );
			const tent = place( f, lat( s + side * 9, 5.2 ), 0 );
			if ( tentOk && standing( tent, f ) ) this.marquee( items, tent, f, rand );

			if ( ! people ) continue;

			for ( let i = 0, n = 14 + Math.floor( rand() * 8 ); i < n; i ++ ) {

				const si = s - SPAN + rand() * SPAN * 2, d = 1.9 + rand() * 2.4;
				if ( Math.abs( si - s ) < GAP || ! frame( si, f ) ) continue;
				const p = place( f, lat( si, d ), 0 );
				if ( standing( p, f ) ) this.spectator( items, p, f, side, rand );

			}

			if ( this.nature ) this.camp( items, frame, s, SPAN * 1.6, side, mulberry( hash( this.seed ^ 0xca3f, Math.round( s ) * 2 + ( side > 0 ? 1 : 0 ) ) ), 0.8, 0.7, 7.2 ); // tents past the marquee

		}

	}

	// A flag on a pole: a pennant in a sponsor's colours
	flag( items, p, f, rand ) {

		const y = this.groundY( p.x, p.z );
		const [ a, b2 ] = pick( rand, SPONSORS );
		const rot = Math.atan2( f.tx, f.tz );

		items.push( { x: p.x, z: p.z, clear: 0.1,
			collider: { x: p.x, y: y + 0.6, z: p.z, hx: 0.04, hy: 0.6, hz: 0.04, rot: 0 },
			draw: ( b ) => {

				b.add( BOX, p.x, y + 0.6, p.z, 0.035, 1.2, 0.035, 0xdadde3 );
				const ox = f.tx * 0.2, oz = f.tz * 0.2;
				b.add( BOX, p.x + ox, y + 1.08, p.z + oz, 0.012, 0.22, 0.38, a, rot );
				b.add( BOX, p.x + ox * 1.1, y + 1.08, p.z + oz * 1.1, 0.014, 0.07, 0.38, b2, rot );

			} } );

	}

	// A marquee (gazebo): four legs, a coloured roof, a table
	marquee( items, p, f, rand ) {

		const y = this.groundY( p.x, p.z );
		const rot = Math.atan2( f.tx, f.tz );
		const [ roof, trim ] = pick( rand, SPONSORS );
		const c = Math.cos( rot ), s = Math.sin( rot ), H = 0.75, R = 0.7;

		items.push( { x: p.x, z: p.z, clear: 1,
			collider: { x: p.x, y: y + 0.45, z: p.z, hx: R, hy: 0.45, hz: R, rot },
			draw: ( b ) => {

				for ( const [ lx, lz ] of [ [ - R, - R ], [ R, - R ], [ - R, R ], [ R, R ] ] ) b.add( BOX, p.x + lx * c + lz * s, y + H / 2, p.z - lx * s + lz * c, 0.035, H, 0.035, 0xdadde3 );
				b.add( BOX, p.x, y + H + 0.03, p.z, R * 2.1, 0.06, R * 2.1, roof, rot );
				b.add( BOX, p.x, y + H + 0.14, p.z, R * 1.4, 0.16, R * 1.4, roof, rot, 0, 0 );
				b.add( BOX, p.x, y + H - 0.03, p.z, R * 2.12, 0.08, R * 2.12, trim, rot );
				b.add( BOX, p.x, y + 0.24, p.z, R * 1.1, 0.04, R * 0.5, 0xf4f4f4, rot );

			} } );

	}

	// banner: chance of a sponsor banner per rail segment (true = 0.5)
	fence( items, frame, s0, s1, side, offset, rand, banner ) {

		const f = {};
		const wood = pick( rand, WOOD );
		let prev = null;
		const step = 1.6;

		for ( let s = s0; s <= s1 + 1e-6; s += step ) {

			if ( ! frame( s, f ) ) {

				if ( prev ) break; // left the chunk
				continue; // not in it yet

			}

			const p = place( f, side * ( this.half( s, side > 0 ? - 1 : 1 ) + offset ), 0 );
			p.y = this.groundY( p.x, p.z );
			items.push( { x: p.x, z: p.z, clear: 0.1, draw: ( b ) => b.add( BOX, p.x, p.y + 0.28, p.z, 0.08, 0.56, 0.08, wood ) } );

			if ( prev ) {

				const a = prev, c = p;
				const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot( dx, dz );
				const rot = Math.atan2( dx, dz );
				const mx = ( a.x + c.x ) / 2, mz = ( a.z + c.z ) / 2, my = ( a.y + c.y ) / 2;
				const colors = banner && rand() < ( banner === true ? 0.5 : banner ) ? pick( rand, SPONSORS ) : null;

				items.push( { x: mx, z: mz, clear: 0.1,
					collider: { x: mx, y: my + 0.28, z: mz, hx: 0.06, hy: 0.3, hz: l / 2, rot },
					draw: ( b ) => {

						b.add( BOX, mx, my + 0.2, mz, 0.04, 0.06, l, wood, rot );
						b.add( BOX, mx, my + 0.42, mz, 0.04, 0.06, l, wood, rot );

						if ( colors ) {

							// Sponsor banner on the road side of the rails: ( cos, -sin ) of the
							// rail heading is the road's left, and this fence stands `side` of it
							const ox = - Math.cos( rot ) * 0.06 * side, oz = Math.sin( rot ) * 0.06 * side;
							b.add( BOX, mx + ox, my + 0.31, mz + oz, 0.015, 0.28, l * 0.9, colors[ 0 ], rot );
							b.add( BOX, mx + ox * 1.3, my + 0.31, mz + oz * 1.3, 0.012, 0.08, l * 0.6, colors[ 1 ], rot );

						}

					} } );

			}

			prev = p;

		}

	}

	crowd( items, frame, s, side, half, rand ) {

		const len = 7 + rand() * 7;
		const s0 = s - len / 2, s1 = s + len / 2;
		this.fence( items, frame, s0, s1, side, 1.5, rand, true );

		const f = {};
		const count = 4 + Math.floor( rand() * 10 );

		for ( let i = 0; i < count; i ++ ) {

			const si = s0 + rand() * len;
			const inChunk = frame( si, f );
			const p = place( f, side * ( this.half( si, side > 0 ? - 1 : 1 ) + 2.0 + rand() * 1.4 ), 0 );
			if ( inChunk ) this.spectator( items, p, f, side, rand );

		}

		if ( this.nature ) this.camp( items, frame, s, len, side, mulberry( hash( this.seed ^ 0xca3f, Math.round( s * 4 ) * 2 + ( side > 0 ? 1 : 0 ) ) ) );

	}

	// Behind a crowd (arc length s, `len` m long, on `side`): now and then a
	// campfire just behind the people, and tents further back (not in
	// winter). Only on ground flat enough and not falling away from the road;
	// drawn with its own random stream (the crowd keeps its looks)
	camp( items, frame, s, len, side, rand, fireChance = 0.5, tentChance = 0.45, tentLat = 5.8 ) {

		const f = {};
		const lat = ( si, d ) => side * ( this.half( si, side > 0 ? - 1 : 1 ) + d );

		// Ground under a footprint of radius r: its lowest / highest point and slope
		const footprint = ( p, r ) => {

			let lo = Infinity, hi = - Infinity;

			for ( const [ dx, dz ] of [ [ 0, 0 ], [ r, 0 ], [ - r, 0 ], [ 0, r ], [ 0, - r ], [ r * 0.7, r * 0.7 ], [ - r * 0.7, - r * 0.7 ], [ r * 0.7, - r * 0.7 ], [ - r * 0.7, r * 0.7 ] ] ) {

				const y = this.groundY( p.x + dx, p.z + dz );
				lo = Math.min( lo, y );
				hi = Math.max( hi, y );

			}

			return { lo, hi, slope: ( hi - lo ) / ( 2 * r ) };

		};

		// The first spot flat enough going away from the road (past a bank:
		// its top), never below the road's edge
		const spot = ( si, from, to, r, maxSlope ) => {

			if ( ! frame( si, f ) ) return null;

			for ( let d = from; d <= to; d += 0.8 ) {

				const p = place( f, lat( si, d ), 0 );
				const g = footprint( p, r );
				if ( g.slope <= maxSlope && g.lo > f.y + ROAD_Y - 0.6 ) return { p, g };

			}

			return null;

		};

		if ( rand() < fireChance ) {

			const at = spot( s + ( rand() - 0.5 ) * len * 0.6, 4.2, 8.2, 0.5, MAX_FIRE_SLOPE );
			if ( at ) this.campfire( items, at.p, ( at.g.lo + at.g.hi ) / 2 - 0.02, rand );

		}

		if ( this.seasonId !== 'winter' && rand() < tentChance ) {

			for ( let i = 0, n = 1 + Math.floor( rand() * 2 ); i < n; i ++ ) {

				const name = pick( rand, NATURE_TENTS );
				const turn = ( rand() - 0.5 ) * 0.9;
				const at = spot( s + ( rand() - 0.5 ) * len, tentLat, tentLat + 3.5, 0.75, MAX_TENT_SLOPE );
				// Sunk a bit into the uphill side so the downhill edge does not hang
				if ( ! at ) continue;
				const tent = this.piece( name, at.p, this.facing( f, side ) + turn, NATURE_TENT_SCALE, { y: at.g.lo + ( at.g.hi - at.g.lo ) * 0.35 } );
				tent.clearProps = 1.3; // RallyStage hides the forest props standing in it
				items.push( tent );

			}

		}

	}

	// A campfire on the ground at p (height y): a ring of stones or bricks,
	// logs, and the flames (drawn unlit, see build)
	campfire( items, p, y, rand ) {

		const ring = pick( rand, NATURE_FIRES ), rot = rand() * Math.PI * 2;
		const ringItem = this.piece( ring, p, rot, NATURE_SCALE, { y: y - 0.01, clear: 0.6 } );
		ringItem.clearProps = 1.2;
		const logs = this.nature.campfire_logs;
		const draw = ringItem.draw;
		ringItem.draw = ( b ) => {

			draw( b );
			b.kit( logs, p.x, y, p.z, rot + 0.7, NATURE_SCALE );

		};
		items.push( ringItem );

		const flames = [ [ 0, 0.2, 0, 0.16, 0.32, 0xff6a14 ], [ 0.06, 0.3, 0.03, 0.11, 0.27, 0xff9a24 ], [ - 0.05, 0.33, - 0.05, 0.1, 0.24, 0xffb83a ], [ 0, 0.47, 0, 0.06, 0.19, 0xffe08a ] ];
		items.push( { x: p.x, z: p.z, clear: 0.3, flame: true, draw: ( b ) => {

			for ( const [ dx, dy, dz, r, h, color ] of flames ) b.add( BLOB, p.x + dx, y + dy, p.z + dz, r, h, r, color, rot );

		} } );

	}

	// A low-poly spectator facing the road, cheering or not
	spectator( items, p, f, side, rand ) {

		const y = this.footY( p.x, p.z, 0.12 ); // feet never in the slope
		const face = Math.atan2( - f.tz * side, f.tx * side ) + ( rand() - 0.5 ) * 0.8; // towards the road
		const jacket = pick( rand, JACKETS ), trousers = pick( rand, TROUSERS ), skin = pick( rand, SKIN );
		const cheering = rand() < 0.45;
		const hat = rand() < 0.35 ? pick( rand, JACKETS ) : null;
		const h = 0.9 + rand() * 0.2; // height scale
		const phase = rand() * 20; // so a crowd never moves in step

		// Not on the rock face of a bank (after every draw: the others keep their looks)
		const slope = Math.hypot( this.groundY( p.x + 0.5, p.z ) - this.groundY( p.x - 0.5, p.z ), this.groundY( p.x, p.z + 0.5 ) - this.groundY( p.x, p.z - 0.5 ) );
		if ( slope > MAX_STAND_SLOPE ) return;

		const item = { x: p.x, z: p.z, clear: 0.2, spectator: true, fallen: false,
			collider: { x: p.x, y: y + 0.38 * h, z: p.z, hx: 0.12, hy: 0.38 * h, hz: 0.12, rot: face },
			draw: ( b ) => {

				// Knocked over (RallyStage.hitSpectator): on the back, away from the
				// road, lying along the slope (lay())
				const { fall, lift } = item.fallen ? this.lay( p, face, h, y ) : { fall: 0, lift: 0 };
				const fc = Math.cos( fall ), fs = Math.sin( fall );
				const sin = Math.sin( face ), cos = Math.cos( face );
				const at = ( lx, ly, lz ) => {

					const ty = ly * h * fc - lz * fs, tz = ly * h * fs + lz * fc; // tilt about the feet
					return [ p.x + lx * cos + tz * sin, y + ty + lift, p.z - lx * sin + tz * cos ];

				};
				const box = ( lx, ly, lz, sx, sy, sz, color, tilt = 0 ) => {

					const [ x, yy, z ] = at( lx, ly, lz );
					b.add( BOX, x, yy, z, sx, sy * h, sz, color, face, fall, tilt );

				};

				b.animate( { pivot: at( 0, 0, 0 ), shoulders: [ at( - 0.11, 0.56, 0 ), at( 0.11, 0.56, 0 ) ], side: [ cos, - sin ], phase, cheer: cheering ? 1 : 0, on: item.fallen ? 0 : 1 } );

				box( - 0.045, 0.16, 0, 0.07, 0.32, 0.08, trousers );
				box( 0.045, 0.16, 0, 0.07, 0.32, 0.08, trousers );
				box( 0, 0.45, 0, 0.2, 0.28, 0.12, jacket );

				if ( cheering ) {

					b.setPart( 1 );
					box( - 0.13, 0.66, 0, 0.05, 0.24, 0.05, jacket, 0.35 );
					b.setPart( 2 );
					box( 0.13, 0.66, 0, 0.05, 0.24, 0.05, jacket, - 0.35 );

				} else {

					b.setPart( 1 );
					box( - 0.125, 0.43, 0, 0.05, 0.24, 0.05, jacket );
					b.setPart( 2 );
					box( 0.125, 0.43, 0, 0.05, 0.24, 0.05, jacket );

				}

				b.setPart( 0 );

				const [ hx, hy, hz ] = at( 0, 0.66, 0 );
				b.add( BLOB, hx, hy, hz, 0.075, 0.08 * h, 0.075, skin, face, fall );
				if ( hat && ! item.fallen ) b.add( BOX, hx, hy + 0.07 * h, hz, 0.15, 0.035, 0.15, hat, face );

			} };

		items.push( item );

	}

	// How a knocked-over spectator lies: the tilt about the feet (negative =
	// back, away from the road, the way they face is `face`) that lays the
	// body along the ground from the feet (at y) to under the head — 1.4 rad
	// on flat ground as before — and how much to lift it so the middle and
	// the shoulders stay out of a hump or a sideways slope
	lay( p, face, h, y ) {

		const L = 0.72 * h; // feet to the top of the head
		const ax = - Math.sin( face ), az = - Math.cos( face ); // away from the road
		let theta = 1.4, along = L;

		for ( let k = 0; k < 2; k ++ ) {

			const head = this.groundY( p.x + ax * along, p.z + az * along );
			theta = Math.atan2( 1, ( head - y ) / along + 1 / Math.tan( 1.4 ) );
			along = L * Math.sin( theta );

		}

		// Above the ground along the body: the middle, and across the shoulders
		const rise = L * Math.cos( theta );
		const mx = p.x + ax * along / 2, mz = p.z + az * along / 2;
		let lift = 0.08 + Math.max( 0, this.groundY( mx, mz ) - ( y + rise / 2 ) );
		const sx = - az * 0.15, sz = ax * 0.15;
		lift += Math.abs( this.groundY( mx + sx, mz + sz ) - this.groundY( mx - sx, mz - sz ) ) * 0.5;

		return { fall: - theta, lift };

	}

	boulder( p, rand ) {

		const y = this.groundY( p.x, p.z );
		const r = 0.25 + rand() * 0.35;
		const rot = rand() * Math.PI * 2;
		const grey = pick( rand, [ 0x8a8f96, 0x7d7a74, 0x9a9690 ] );

		return { x: p.x, z: p.z, clear: r,
			collider: { x: p.x, y: y + r * 0.5, z: p.z, hx: r * 0.8, hy: r * 0.6, hz: r * 0.8, rot },
			draw: ( b ) => {

				b.add( BLOB, p.x, y + r * 0.35, p.z, r, r * 0.7, r * ( 0.8 + rand() * 0.3 ), grey, rot, rand() * 0.4, rand() * 0.4 );
				b.add( BLOB, p.x + r * 0.5, y + r * 0.15, p.z + r * 0.3, r * 0.45, r * 0.35, r * 0.4, grey, rot + 1 );

			} };

	}

	bush( p, rand ) {

		const y = this.groundY( p.x, p.z );
		const r = 0.22 + rand() * 0.25;
		const greens = this.seasonAt( p ).bushes;

		return { x: p.x, z: p.z, clear: r, draw: ( b ) => {

			const n = 2 + Math.floor( rand() * 3 );

			for ( let i = 0; i < n; i ++ ) {

				const a = rand() * Math.PI * 2, d = rand() * r * 0.8;
				b.add( BLOB, p.x + Math.cos( a ) * d, y + r * ( 0.5 + rand() * 0.3 ), p.z + Math.sin( a ) * d, r * ( 0.7 + rand() * 0.4 ), r * ( 0.6 + rand() * 0.3 ), r * ( 0.7 + rand() * 0.4 ), pick( rand, greens ), rand() * 6 );

			}

		} };

	}

	// Spring: a patch of little flowers in the grass
	flowers( p, rand ) {

		const y = this.groundY( p.x, p.z );
		const colors = this.season.flowers;
		const blooms = [];

		for ( let i = 0, n = 5 + Math.floor( rand() * 8 ); i < n; i ++ ) {

			const a = rand() * Math.PI * 2, d = rand() * 0.45;
			blooms.push( [ p.x + Math.cos( a ) * d, p.z + Math.sin( a ) * d, colors[ Math.floor( rand() * colors.length ) ], 0.03 + rand() * 0.025, 0.05 + rand() * 0.06 ] );

		}

		return { x: p.x, z: p.z, clear: 0.5, draw: ( b ) => {

			for ( const [ x, z, color, r, h ] of blooms ) {

				b.add( BOX, x, y + h / 2, z, 0.012, h, 0.012, 0x3e8a3a );
				b.add( BLOB, x, y + h, z, r, r * 0.6, r, color );

			}

		} };

	}

	// Winter: a low bank of ploughed snow
	snowbank( p, rand ) {

		const y = this.groundY( p.x, p.z );
		const len = 0.8 + rand() * 1.6, rot = rand() * Math.PI;

		return { x: p.x, z: p.z, clear: 0.4, draw: ( b ) => {

			b.add( BLOB, p.x, y + 0.04, p.z, 0.35, 0.16, len / 2, 0xf4f7fc, rot );
			b.add( BLOB, p.x + 0.15, y + 0.03, p.z + 0.2, 0.25, 0.12, len / 3, 0xe8eef8, rot + 0.4 );

		} };

	}

	// ─── Racing kit pieces (Kit.js) ───────────────────────────

	// Heading that turns a kit piece (front = +Z) to face the road from `side`
	facing( f, side ) {

		return Math.atan2( - f.tz * side, f.tx * side );

	}

	// Height of what is drawn `off` m past the dirt edge at road frame f: the
	// verge eases from the road down to the grass over SKIRT
	edgeY( p, f, off ) {

		const road = f.y + ROAD_Y;
		return road + ( this.groundY( p.x, p.z ) - road ) * Math.min( 1, Math.max( 0, off ) / SKIRT );

	}

	// A kit piece standing on the ground at p, turned by rot; solid unless
	// opts.solid is false
	piece( name, p, rot, scale = KIT_SCALE, { solid = true, clear, recolor, y } = {} ) {

		const tpl = this.kit?.[ name ] ?? this.nature[ name ]; // racing kit or nature kit (no shared names)
		const gy = y ?? this.groundY( p.x, p.z );
		const sx = typeof scale === 'number' ? scale : scale[ 0 ], sz = typeof scale === 'number' ? scale : scale[ 2 ];
		const item = { x: p.x, z: p.z, clear: clear ?? Math.hypot( tpl.size.x * sx, tpl.size.z * sz ) / 2,
			draw: ( b ) => b.kit( tpl, p.x, gy, p.z, rot, scale, { recolor } ) };
		if ( solid ) item.collider = kitBox( tpl, p.x, gy, p.z, rot, scale, 0.85 );
		return item;

	}

	// A kit flag on its pole, the cloth facing the road
	kitFlag( p, f, side, rand, name = pick( rand, [ 'flagRed', 'flagGreen', 'flagTankco', 'flagCheckers' ] ) ) {

		const item = this.piece( name, p, this.facing( f, side ), KIT_SCALE, { clear: 0.15 } );
		item.collider = { x: p.x, y: this.groundY( p.x, p.z ) + 0.9, z: p.z, hx: 0.05, hy: 0.9, hz: 0.05, rot: 0 }; // just the pole
		return item;

	}

	// A kit tree, its leaves in the season's colours, solid at the trunk
	kitTree( p, rand ) {

		const scale = 1.3 + rand() * 0.8;
		const y = this.groundY( p.x, p.z ) - 0.05;

		const item = this.piece( rand() < 0.6 ? 'treeLarge' : 'treeSmall', p, rand() * Math.PI * 2, scale, { solid: false, clear: 0.5, recolor: { grass: pick( rand, this.seasonAt( p ).leaves ) }, y } );
		item.collider = { x: p.x, y: y + 0.4, z: p.z, hx: 0.07 * scale, hy: 0.4, hz: 0.07 * scale, rot: 0 };
		return item;

	}

	// One low barrier at arc length s, `offset` m past the dirt edge, along
	// the road: a red and white wall, or a single red or white block
	lowBarrier( items, frame, s, side, offset, rand ) {

		const f = {};
		if ( ! frame( s, f ) ) return;
		const p = place( f, side * ( this.half( s, side > 0 ? - 1 : 1 ) + offset ), 0 );
		const name = rand() < 0.6 ? 'barrierWall' : rand() < 0.5 ? 'barrierRed' : 'barrierWhite';
		items.push( this.piece( name, p, Math.atan2( - f.tz, f.tx ), name === 'barrierWall' ? KIT_SCALE : KIT_SCALE * 1.6, { clear: 0.2, y: this.edgeY( p, f, offset ) - 0.02 } ) );

	}

	// The kit's dressing of a start / finish area at arc length s (see hub):
	// cones and a single low barrier per side, kit flags and banner towers by
	// the arch, marquees (no grandstands, no billboards); start lights at the start, a TV camera and timing gear at
	// the finish
	kitHub( items, frame, s, kind, rand ) {

		const f = {};
		const SPAN = 15, GAP = 1.6;
		const standing = ( p, fr ) => this.groundY( p.x, p.z ) > fr.y + ROAD_Y - 0.6;

		for ( const side of [ 1, - 1 ] ) {

			const lat = ( si, d ) => side * ( this.half( si, side > 0 ? - 1 : 1 ) + d );
			const face = ( fr ) => this.facing( fr, side );

			// Cones by the arch and at the ends of the area, one low barrier
			for ( const d of [ - SPAN - 0.6, - GAP - 0.4, GAP + 0.4, SPAN + 0.6 ] ) {

				if ( ! frame( s + d, f ) ) continue;
				const p = place( f, lat( s + d, 0.45 ), 0 );
				items.push( this.piece( 'pylon', p, rand() * 6, KIT_SCALE * 1.2, { clear: 0.15, y: this.edgeY( p, f, 0.45 ) } ) );

			}

			if ( rand() < 0.7 ) this.lowBarrier( items, frame, s + ( rand() < 0.5 ? - 1 : 1 ) * ( 6 + rand() * 6 ), side, 0.5, rand );

			// Banner towers either side of the arch, kit flags along the barriers
			if ( frame( s - side * 2.6, f ) ) items.push( this.piece( side > 0 ? 'bannerTowerRed' : 'bannerTowerGreen', place( f, lat( s - side * 2.6, 1.1 ), 0 ), face( f ), KIT_SCALE ) );

			for ( let d = - SPAN + 2; d <= SPAN - 2; d += 4.5 ) {

				if ( Math.abs( d ) < 4 || rand() < 0.35 || ! frame( s + d, f ) ) continue;
				const name = Math.abs( d ) < 8 ? 'flagCheckers' : undefined;
				items.push( this.kitFlag( place( f, lat( s + d, 1.0 ), 0 ), f, side, rand, name ) );

			}

			// A marquee or two behind the crowd (the code one stands at s + side * 9)
			for ( const along of [ - side * 11, side * 14 ] ) {

				if ( rand() < 0.35 || ! frame( s + along, f ) ) continue;
				const p = place( f, lat( s + along, 5.4 + rand() * 1.5 ), 0 );
				const name = pick( rand, [ 'tent', 'tentLong', 'tentClosed', 'tentClosedLong', 'tentRoof', 'tentRoofDouble' ] );
				if ( standing( p, f ) ) items.push( this.piece( name, p, face( f ) + ( rand() < 0.5 ? 0 : Math.PI ), KIT_SCALE ) );

			}


		}

		const left = 1, right = - 1;

		if ( kind === 'start' && frame( s - 1.2, f ) ) {

			// Start lights facing the car on the grid
			const p = place( f, left * ( this.half( s, - 1 ) + 0.45 ), 0 );
			items.push( this.piece( 'lightRedDouble', p, Math.atan2( - f.tx, - f.tz ), KIT_SCALE * 1.8, { clear: 0.2, y: this.edgeY( p, f, 0.45 ) } ) );

		}

		if ( kind === 'finish' ) {

			if ( frame( s + 2.5, f ) ) items.push( this.piece( 'camera', place( f, right * ( this.half( s, 1 ) + 1.0 ), 0 ), Math.atan2( - f.tx, - f.tz ) + 0.5, KIT_SCALE * 1.6, { clear: 0.25 } ) );
			if ( frame( s - 3, f ) ) {

				const p = place( f, left * ( this.half( s, - 1 ) + 2.4 ), 0 );
				if ( standing( p, f ) ) items.push( this.piece( 'radarEquipment', p, this.facing( f, left ), KIT_SCALE ) );

			}

		}

	}

	// One merged mesh of the visible items; in Ultra a group: that mesh and
	// the spectators' animated one
	build( items ) {

		const b = new Builder();
		const crowd = this.ultra ? new Builder( true ) : b;
		const fire = new Builder();

		for ( const it of items ) {

			if ( it.hidden ) continue;
			const target = it.flame ? fire : it.spectator ? crowd : b;
			// Ultra draws the terrain on a finer grid than the 2 m one items are
			// placed (and made solid) on: the drawn item is lifted onto it, as a whole
			const lift = this.lift && Number.isFinite( it.x ) ? this.lift( it.x, it.z ) : 0;
			if ( lift ) target.liftFrom = target.mark();
			it.draw( target );
			if ( lift ) target.liftBy( lift );

		}

		const mesh = new THREE.Mesh( b.geometry(), ROADSIDE_MATERIAL );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		const textured = texturedMeshes( b.textured );
		if ( ! this.ultra && ! textured.length && ! fire.positions.length ) return mesh;

		const group = new THREE.Group();
		group.add( mesh );
		for ( const m of textured ) group.add( m );
		if ( fire.positions.length ) group.add( new THREE.Mesh( fire.geometry(), FLAME_MATERIAL ) ); // no shadow, unlit
		if ( ! this.ultra ) return group;

		if ( crowd.positions.length ) {

			const people = new THREE.Mesh( crowd.geometry(), SPECTATOR_MATERIAL );
			people.customDepthMaterial = SPECTATOR_DEPTH;
			people.castShadow = true;
			people.receiveShadow = true;
			group.add( people );

		}

		return group;

	}

}
