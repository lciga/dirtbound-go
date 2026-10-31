// Bonus races (lobby mode 'bonus', menu Expérimental): rows of item boxes
// across the circuit, one every 10 to 20 s of driving (Layout.js), and boost
// pads (BoostPads.js) here and there, the same for every racer; a bonus held and climbing a level each time a box
// is picked again (max BONUS_LEVELS), fired with the `fire` key. Rocket: level 1
// straight ahead, level 2 homing on the next car ahead, level 3 one homing
// rocket on every other racer (Rockets.js flies them). Lightning (Lightning.js,
// drawn by Zap.js): level 1 a ball of lightning straight ahead, level 2 a strike
// from the sky on the two leading racers, level 3 on everyone; a car struck
// gets a malus (controls reversed, half size and speed, or a 2 s flashbang).
// Turbo (Turbo.js): level 1 3 s of turbo, level 2 5 s in a shield bubble,
// level 3 a rift that carries the car TURBO.warp m along the road.
// Boxes are this player's own (picked here, back after BOX_RESPAWN). A shot is
// sent to the server, which relays it; each player flies every rocket and
// judges only their own car: hit = the car blows up and is put back on the
// road, stopped, after WRECK.

import * as THREE from 'three';
import { rigidBody } from 'crashcat';
import { ROAD_HALF, ROAD_Y } from '../SplineTrack.js';
import { BONUS_LEVELS, BONUS_KINDS, rocketId } from '../multi/Protocol.js';
import { ROCKET, shotRockets, stepRocket, rocketHits, shotTargets, pickUp } from './Rockets.js';
import { LIGHTNING, lightningTargets, malusOf } from './Lightning.js';
import { Zaps } from './Zap.js';
import { Turbos, warpTarget, TURBO } from './Turbo.js';
import { boxRows, boostPads, layoutSeed } from './Layout.js';
import { BoostPads } from './BoostPads.js';
import { RocketSounds } from './RocketSounds.js';
import { t, list } from '../i18n.js';
import { useHudTheme } from '../HudTheme.js';

const BOX_LATERAL = [ - 2.4, - 0.8, 0.8, 2.4 ]; // m across the road
const BOX_SIZE = 0.45; // m
const BOX_HEIGHT = 0.6; // m: centre above the road
const BOX_RESPAWN = 3; // s
const PICK_RADIUS = 1.4; // m from the car (ground distance)
const ROW_CLEAR = 8; // m: one box per row, the row can be picked again once the car is this far from it
const WRECK = 0.9; // s: the car is gone after a hit, then back on the road, stopped
const IMMUNE = 1.8; // s after a hit
const WALL = ROAD_HALF - 0.3; // m from the centreline: a straight rocket meets the barrier
const NO_INPUT = Object.freeze( { x: 0, z: 0, handbrake: false, fire: false, touchActive: false } );
const PUFFS = 1400; // smoke puffs alive at once
const FIRES = 400; // fire puffs (unlit, glowing)
const DEBRIS = 240; // bits flung by an explosion
const LIGHTS = 2; // point lights flashing with the explosions (kept in the scene: no shader recompile)
const LIGHT_POWER = 260; // peak intensity of an explosion's light
const LIGHT_RANGE = 16; // m
const LIGHT_TIME = 0.4; // s
const SHAKE_RANGE = 35; // m from my car: past this an explosion no longer shakes the camera
const GRAVITY = 18; // m/s² on the debris
const FIRE_COLORS = [ 0xfff2a8, 0xffc23d, 0xff7a1f, 0xd8401a, 0x5a2a1a ]; // over a fire puff's life
const DEBRIS_COLORS = [ 0x2b2b2b, 0x444444, 0x6b6b6b, 0x8f8f8f, 0xe5383b ];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3( 0, 0, 1 );
const _d = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

// The bonus held, bottom right, only while there is one: its name and what it
// does on the left, a round icon (one per kind and level) ringed by the level
const RING = 2 * Math.PI * 44; // the ring's length (r 44 in a 96 box)
const CSS = `
	#bonus-hud { position: fixed; right: 28px; bottom: 28px; z-index: 20; display: flex; align-items: center; gap: 16px;
		opacity: 0; transform: translateY(16px); transition: opacity 0.25s, transform 0.25s; }
	#bonus-hud.full { opacity: 1; transform: none; }
	#bonus-hud .info { text-align: right; }
	#bonus-hud .info b { display: block; font-size: 22px; font-weight: 900; font-style: italic; text-transform: uppercase; line-height: 1.1; }
	#bonus-hud small { display: block; margin-top: 4px; font-size: 14px; opacity: 0.9; }
	#bonus-hud kbd { margin-left: 4px; padding: 1px 7px; min-width: 0; font-size: 12px; }
	#bonus-hud .slot { position: relative; width: 96px; height: 96px; flex: none; display: grid; place-items: center; transition: transform 0.16s; }
	#bonus-hud.pop .slot { transform: scale(1.14); }
	#bonus-hud .disc { width: 74px; height: 74px; border-radius: 50%; display: grid; place-items: center; box-shadow: 0 6px 22px rgba(20, 24, 36, 0.4);
		background: linear-gradient(135deg, var(--accent-light), #e5383b); }
	#bonus-hud.lightning .disc { background: linear-gradient(135deg, #6fb6ff, #4a3dff); }
	#bonus-hud.boost .disc { background: linear-gradient(135deg, #ffd23d, #ff5a1f); }
	#bonus-hud .disc svg { width: 44px; height: 44px; fill: #fff; }
	#bonus-hud .ring { position: absolute; inset: 0; transform: rotate(-90deg); filter: drop-shadow(0 2px 6px rgba(20, 24, 36, 0.4)); }
	#bonus-hud .ring circle { fill: none; stroke-width: 6; stroke-linecap: round; }
	#bonus-hud .ring .track { stroke: rgba(255, 255, 255, 0.3); }
	#bonus-hud .ring .level { stroke: #fff; stroke-dasharray: ${ RING }; transition: stroke-dashoffset 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
	#rift-flash { position: fixed; inset: 0; z-index: 17; pointer-events: none; opacity: 0; transition: opacity 0.45s ease-out;
		background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.9), rgba(180,107,255,0.65) 30%, rgba(40,15,110,0.85) 75%); }
	#rift-flash.on { opacity: 1; transition: none; }
`;

// One icon per kind and level (index 0 unused): one rocket, a homing one in
// its sights, a salvo; a bolt, two, a storm; a flame, a shielded one, a rift
const ROCKET_PATH = 'M12 2c3 2.5 4.5 6 4.5 10v4h-9v-4C7.5 8 9 4.5 12 2zm0 6.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM7.5 13.5 4 17v3l3.5-2zm9 0L20 17v3l-3.5-2zM10 17.5h4l-.6 3.5h-2.8z';
const BOLT_PATH = 'M14 2 4.5 13.5h6L9 22l10-12.5h-6.2z';
const FLAME_PATH = 'M12 2c1 3.5 5 5.5 5 10.5A5 5 0 0 1 7 12.5c0-2 1-3.6 2.3-4.8.2 1.8 1 3 2.2 3.3C11 8 11.2 4.8 12 2zm0 12.2c-.9 1-1.6 2-1.6 3.1a1.6 1.6 0 0 0 3.2 0c0-1.1-.7-2.1-1.6-3.1z';
const icon = ( body ) => `<svg viewBox="0 0 24 24">${ body }</svg>`;
const placed = ( path, x, y, k ) => `<path transform="translate(${ x } ${ y }) scale(${ k })" d="${ path }"/>`;
const LINE = 'fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"';
const ICONS = {
	rocket: [ '', icon( `<path d="${ ROCKET_PATH }"/>` ),
		icon( `<circle cx="12" cy="12" r="10" ${ LINE }/><path d="M12 0.5v3M12 20.5v3M0.5 12h3M20.5 12h3" ${ LINE }/>` + placed( ROCKET_PATH, 5.4, 5.2, 0.55 ) ),
		icon( placed( ROCKET_PATH, - 2.2, 12.4, 0.55 ) + placed( ROCKET_PATH, 5.4, - 1.1, 0.55 ) + placed( ROCKET_PATH, 13, 12.4, 0.55 ) ) ],
	lightning: [ '', icon( `<path d="${ BOLT_PATH }"/>` ),
		icon( placed( BOLT_PATH, -1, 2, 0.8 ) + placed( BOLT_PATH, 7.5, 3.5, 0.8 ) ),
		icon( '<path d="M6.5 11.5a4.2 4.2 0 0 1 .4-8.4A5.6 5.6 0 0 1 17.7 4.6a3.5 3.5 0 0 1-.2 6.9z"/><path d="M12.8 12 8.6 17.6h3l-1.2 5L15.6 16h-3l1.6-4z"/>' ) ],
	boost: [ '', icon( `<path d="${ FLAME_PATH }"/>` ),
		icon( `<path d="M12 1.5 3.5 4.8v6.4c0 5.4 3.6 9.6 8.5 11.3 4.9-1.7 8.5-5.9 8.5-11.3V4.8z" ${ LINE }/>` + placed( FLAME_PATH, 6.3, 5.6, 0.48 ) ),
		icon( `<ellipse cx="12" cy="12" rx="10" ry="10" ${ LINE }/><ellipse cx="12" cy="12" rx="6.5" ry="6.5" ${ LINE } opacity="0.8"/><path d="M12 8.5a3.5 3.5 0 1 1-3.4 4.3c1.6.9 3.8.2 4.2-1.6.3-1.2-.3-2.2-.8-2.7z"/>` ) ],
};
// Per kind, level 1 to 3 (index 0 unused): bonus.names.<kind>, bonus.hints.<kind> in the locales
const LEVEL_NAMES = Object.fromEntries( [ 'rocket', 'lightning', 'boost' ].map( ( k ) => [ k, [ '', ...list( 'bonus.names.' + k ) ] ] ) );
const LEVEL_HINTS = Object.fromEntries( [ 'rocket', 'lightning', 'boost' ].map( ( k ) => [ k, [ '', ...list( 'bonus.hints.' + k ) ] ] ) );

// 'KeyE' → 'E', 'Enter' → 'Entrée'
function keyLabel( code ) {

	if ( ! code ) return '';
	if ( code.startsWith( 'Key' ) ) return code.slice( 3 );
	if ( code.startsWith( 'Digit' ) ) return code.slice( 5 );
	return { Enter: t( 'keys.Enter' ), Space: t( 'keys.Space' ), ShiftLeft: t( 'keys.Shift' ), ShiftRight: t( 'keys.Shift' ) }[ code ] || code;

}

// The "?" on the boxes
function boxTexture() {

	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = 128;
	const g = canvas.getContext( '2d' );
	g.fillStyle = '#ffffff';
	g.fillRect( 0, 0, 128, 128 );
	g.strokeStyle = '#d8d8d8';
	g.lineWidth = 10;
	g.strokeRect( 5, 5, 118, 118 );
	g.fillStyle = '#1f2430';
	g.font = '900 96px system-ui, sans-serif';
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.fillText( '?', 64, 70 );
	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;

}

// Shared by every rocket (built once: no new shader on the first shot)
let parts = null;

function rocketParts() {

	parts ??= {
		white: new THREE.MeshStandardMaterial( { color: 0xf2f2f2, roughness: 0.5 } ),
		red: new THREE.MeshStandardMaterial( { color: 0xe5383b, roughness: 0.5 } ),
		flame: new THREE.MeshBasicMaterial( { color: 0xffb03d } ),
		body: new THREE.CylinderGeometry( 0.09, 0.09, 0.55, 8 ),
		nose: new THREE.ConeGeometry( 0.09, 0.22, 8 ),
		fin: new THREE.BoxGeometry( 0.02, 0.14, 0.16 ),
		exhaust: new THREE.ConeGeometry( 0.08, 0.35, 8 ),
	};
	return parts;

}

// A small rocket along +Z: white body, red nose and fins, a flame at the back
function rocketMesh() {

	const { white, red, flame: flameMaterial } = rocketParts();
	const group = new THREE.Group();

	const body = new THREE.Mesh( parts.body, white );
	body.rotation.x = Math.PI / 2;
	const nose = new THREE.Mesh( parts.nose, red );
	nose.rotation.x = Math.PI / 2;
	nose.position.z = 0.385;
	group.add( body, nose );

	for ( let i = 0; i < 4; i ++ ) {

		const fin = new THREE.Mesh( parts.fin, red );
		const a = i * Math.PI / 2;
		fin.position.set( Math.cos( a ) * 0.12, Math.sin( a ) * 0.12, - 0.2 );
		fin.rotation.z = a;
		group.add( fin );

	}

	const flame = new THREE.Mesh( parts.exhaust, flameMaterial );
	flame.rotation.x = - Math.PI / 2;
	flame.position.z = - 0.45;
	group.add( flame );
	group.userData.flame = flame;
	group.traverse( ( o ) => { if ( o.isMesh ) o.castShadow = true; } );
	return group;

}

export class BonusRace {

	// path: the circuit's centreline (closed TrackPath); finishS: arc length of the start line
	// localHits: the other cars are judged here (test mode bots, TestBench.js)
	// shake( amount ): camera shake (Camera.shake); audio: the GameAudio (the incoming beep)
	// onWarp( points ): my car went through a rift, the road it skipped ([ { x, z } ], for the lap counter)
	constructor( { client, sync, scene, path, finishS, vehicle, world, fireKey, localHits = false, shake = null, audio = null, onWarp = null } ) {

		this.client = client;
		this.localHits = localHits;
		this.onWarp = onWarp;
		this.warpDue = null; // the rift's exit, taken in the next physics step
		this.shake = shake;
		this.audio = audio;
		this.sounds = new RocketSounds( audio ); // launches and blasts
		this.beepIn = 0; // s to the next incoming beep
		this.sync = sync;
		this.scene = scene;
		this.path = path;
		this.vehicle = vehicle;
		this.world = world;
		this.item = null; // { kind: 'rocket' | 'lightning', level }
		this.strikes = []; // sky strikes on their way: { key, target, at (race time), level }
		this.shotKinds = new Map(); // 'shooter.n' → kind of that shot (a hit names a rocket id)
		this.rockets = new Map(); // id → { r, mesh, trail }
		this.shots = 0;
		this.firing = false; // the fire key is held (one shot per press)
		this.wreck = 0; // s left before the car is back after a hit
		this.immune = 0;
		this.time = 0;
		this.flashes = [];
		this.roadCache = { x: NaN, z: NaN, value: null };

		// Race direction along the path (the grid starts facing it)
		const start = path.frameAt( finishS );
		this.ahead = start.tx * Math.sin( vehicle.spawnAngle ) + start.tz * Math.cos( vehicle.spawnAngle ) < 0 ? - 1 : 1;
		this.wrecked = new Map(); // remote id → s left hidden

		const seed = layoutSeed( path );
		const rows = boxRows( path.length, seed );
		this.buildBoxes( finishS, rows );
		this.pads = new BoostPads( { scene, path, pads: boostPads( path, finishS, this.ahead, rows, seed ), finishS, ahead: this.ahead, vehicle, shake } );
		this.buildPuffs();
		this.zaps = new Zaps( { scene, host: this } );
		this.turbos = new Turbos( { scene, host: this } );
		this.flashEl = document.createElement( 'div' );
		this.flashEl.id = 'rift-flash';
		document.body.appendChild( this.flashEl );
		this.buildHud( fireKey );

		// Drawn once out of sight so main.js compiles their shaders with the rest
		this.warmup = rocketMesh();
		this.warmup.position.set( 0, - 1000, 0 );
		this.flash( this.warmup.position );
		this.flashes[ 0 ].age = - 2; // lasts until the race is under way
		this.warmup.add( this.zaps.ballMesh() );
		scene.add( this.warmup );

		client.addEventListener( 'fire', ( e ) => this.onFire( e.detail ) );
		client.addEventListener( 'hit', ( e ) => this.onHit( e.detail ) );

	}

	// ─── Boxes ───

	// rows: distances past the start line in the race direction (Layout.js boxRows)
	buildBoxes( finishS, rows ) {

		this.boxMaterial = new THREE.MeshStandardMaterial( { map: boxTexture(), transparent: true, opacity: 0.88, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.25 } );
		const geometry = new THREE.BoxGeometry( BOX_SIZE, BOX_SIZE, BOX_SIZE );
		this.boxes = [];
		this.rows = []; // { x, z, taken }: a row gives one box per pass
		const L = this.path.length;

		for ( const d of rows ) {

			const f = this.path.frameAt( ( ( finishS + this.ahead * d ) % L + L ) % L );
			const row = { x: f.x, z: f.z, taken: false };
			this.rows.push( row );

			for ( const lateral of BOX_LATERAL ) {

				const mesh = new THREE.Mesh( geometry, this.boxMaterial );
				const x = f.x + f.tz * lateral, z = f.z - f.tx * lateral;
				mesh.position.set( x, f.y + ROAD_Y + BOX_HEIGHT, z );
				mesh.castShadow = true;
				this.scene.add( mesh );
				this.boxes.push( { mesh, row, x, z, y: mesh.position.y, phase: lateral, away: 0 } );

			}

		}

	}

	updateBoxes( dt ) {

		const hue = ( this.time * 0.15 ) % 1;
		this.boxMaterial.color.setHSL( hue, 0.85, 0.72 );
		this.boxMaterial.emissive.setHSL( hue, 0.9, 0.5 );
		const me = this.vehicle.spherePos;
		const canPick = this.sync.started && ! this.sync.finished;
		for ( const row of this.rows ) if ( row.taken && Math.hypot( me.x - row.x, me.z - row.z ) > ROW_CLEAR ) row.taken = false;

		for ( const box of this.boxes ) {

			if ( box.away > 0 ) {

				box.away = Math.max( 0, box.away - dt );
				const grow = box.away === 0 ? 1 : Math.max( 0, 1 - box.away / 0.3 ); // pops back in its last 0.3 s
				box.mesh.visible = box.away < 0.3;
				box.mesh.scale.setScalar( Math.max( 0.001, grow ) );

			} else if ( canPick && ! box.row.taken && Math.hypot( me.x - box.x, me.z - box.z ) < PICK_RADIUS && Math.abs( me.y - box.y ) < 2.5 ) {

				box.row.taken = true; // the row's other boxes stay, but not for this pass
				box.away = BOX_RESPAWN;
				box.mesh.visible = false;
				this.burst( box.mesh.position, 10, 0xffffff, 4 );
				this.pick();

			}

			box.mesh.rotation.set( 0.45, this.time * 1.6 + box.phase, 0.3 );
			box.mesh.position.y = box.y + Math.sin( this.time * 2.4 + box.phase ) * 0.06;

		}

	}

	pick() {

		const before = this.item?.level ?? 0;
		this.item = pickUp( this.item, BONUS_LEVELS, BONUS_KINDS[ Math.floor( Math.random() * BONUS_KINDS.length ) ] );
		this.drawHud( this.item.level > before );

	}

	// Test mode: a bonus of that kind and level in hand
	give( level, kind = 'rocket' ) {

		this.item = { kind, level: Math.max( 1, Math.min( BONUS_LEVELS, level ) ) };
		this.drawHud( true );

	}

	// ─── HUD ───

	buildHud( fireKey ) {

		useHudTheme();
		const style = document.createElement( 'style' );
		style.textContent = CSS;
		document.head.appendChild( style );

		this.hud = document.createElement( 'div' );
		this.hud.id = 'bonus-hud';
		this.hud.className = 'hud-float';
		this.hud.innerHTML = '<div class="info"><b></b><small></small></div>' +
			`<div class="slot"><svg class="ring" viewBox="0 0 96 96"><circle class="track" cx="48" cy="48" r="44"/><circle class="level" cx="48" cy="48" r="44" stroke-dashoffset="${ RING }"/></svg><div class="disc"></div></div>`;
		document.body.appendChild( this.hud );
		this.fireKey = keyLabel( fireKey );
		this.drawHud( false );

	}

	drawHud( pop ) {

		const level = this.item?.level ?? 0;
		const kind = this.item?.kind ?? 'rocket';
		this.hud.classList.toggle( 'full', level > 0 );
		if ( ! level ) return; // nothing held: nothing shown (it fades out as it was)
		this.hud.classList.toggle( 'lightning', kind === 'lightning' );
		this.hud.classList.toggle( 'boost', kind === 'boost' );
		this.hud.querySelector( '.disc' ).innerHTML = ICONS[ kind ][ level ];
		this.hud.querySelector( '.ring .level' ).style.strokeDashoffset = RING * ( 1 - level / BONUS_LEVELS );
		this.hud.querySelector( 'b' ).textContent = LEVEL_NAMES[ kind ][ level ];
		const small = this.hud.querySelector( 'small' );
		small.textContent = LEVEL_HINTS[ kind ][ level ];
		const kbd = document.createElement( 'kbd' );
		kbd.className = 'hud-key';
		kbd.textContent = this.fireKey || '?';
		small.append( kbd );

		if ( pop ) {

			this.hud.classList.add( 'pop' );
			setTimeout( () => this.hud.classList.remove( 'pop' ), 160 );

		}

	}

	// ─── Firing ───

	// What another racer's car looks like here (its centre), null when gone
	remoteCar( id ) {

		const remote = this.sync.remotes.get( id );
		if ( ! remote || ! remote.ghost.container.visible ) return null;
		const p = remote.ghost.container.position;
		return { x: p.x, y: p.y + 0.5, z: p.z };

	}

	myCar() {

		const p = this.vehicle.spherePos;
		return { x: p.x, y: p.y, z: p.z };

	}

	fire() {

		const { level, kind } = this.item;
		const finishes = this.sync.lobby.race?.finishes || {};
		const me = this.vehicle.spherePos;
		const others = [];

		for ( const [ id, remote ] of this.sync.remotes ) {

			const car = this.remoteCar( id );
			if ( ! car || finishes[ id ] !== undefined ) continue;
			others.push( { id, progress: remote.track.latest()?.p ?? 0, distance: Math.hypot( car.x - me.x, car.z - me.z ) } );

		}

		_d.set( 0, 0, 1 ).applyQuaternion( this.vehicle.container.quaternion );
		_d.y = 0;
		_d.normalize();
		const round = ( v, n ) => Math.round( v * 10 ** n ) / 10 ** n;
		const shot = {
			kind,
			level,
			n: this.shots ++ % 1e6,
			rt: round( this.sync.raceTime, 3 ),
			x: round( me.x, 2 ), y: round( me.y - 0.5, 2 ), z: round( me.z, 2 ),
			dx: round( _d.x, 4 ), dz: round( _d.z, 4 ),
			targets: kind === 'boost' ? [] : kind === 'lightning' ? lightningTargets( level, others ) : shotTargets( level, { id: this.sync.you, progress: this.sync.progress() }, others ),
		};

		// The rift's exit, so the others draw it (and the server lets the jump count)
		if ( kind === 'boost' && level >= 3 ) {

			const exit = warpTarget( this.path, this.path.nearest( me.x, me.z, 2 ).s, this.ahead );
			shot.wx = round( exit.x, 2 );
			shot.wz = round( exit.z, 2 );

		}

		this.item = null;
		this.drawHud( false );
		if ( kind === 'lightning' ) this.sounds.spell( me );
		this.client.fire( shot );
		this.launch( { ...shot, id: this.sync.you } );

	}

	// shot: as sent, with id = the shooter (kind missing: a rocket, older clients)
	launch( shot ) {

		const kind = shot.kind ?? 'rocket';
		this.shotKinds.set( shot.id + '.' + shot.n, kind );
		if ( this.shotKinds.size > 300 ) this.shotKinds.delete( this.shotKinds.keys().next().value );

		// Turbo: flames (and a shield) on the shooter's car, or a rift
		if ( kind === 'boost' ) {

			if ( shot.level >= 3 && shot.wx !== undefined ) {

				const exit = warpTarget( this.path, this.path.nearest( shot.wx, shot.wz, 2 ).s, this.ahead, 0 );
				this.turbos.rift( shot.id, shot, exit );
				this.sounds.spell( shot ); // the rift opens with the electric spell's sound, where it opens

			} else {

				this.turbos.start( shot.id, shot.level, shot.rt );
				const mine = shot.id === this.sync.you;
				const left = TURBO.time[ shot.level ] - Math.max( 0, ( this.sync.raceTime ?? shot.rt ) - shot.rt );
				this.sounds.boost( () => ( mine ? this.myCar() : this.remoteCar( shot.id ) ), left );

			}
			return;

		}

		// Lightning from the sky: a warning ring under each car, then the strike
		if ( kind === 'lightning' && shot.level > 1 ) {

			shot.targets.forEach( ( target, i ) => {

				const key = rocketId( shot.id, shot.n, i );
				if ( this.strikes.some( ( s ) => s.key === key ) ) return;
				const at = shot.rt + LIGHTNING.strikeDelay;
				this.strikes.push( { key, target, at, level: shot.level } );
				this.zaps.warn( target, at );

			} );
			return;

		}

		let launched = 0;
		for ( const r of shotRockets( { ...shot, kind, from: shot.id }, ( i ) => rocketId( shot.id, shot.n, i ) ) ) {

			if ( this.rockets.has( r.id ) ) continue;
			const mesh = kind === 'lightning' ? this.zaps.ballMesh() : rocketMesh();
			mesh.position.fromArray( r.pos );
			this.scene.add( mesh );
			this.rockets.set( r.id, { r, mesh, trailAt: 0 } );
			launched ++;

		}

		if ( launched && kind === 'rocket' ) this.sounds.launch( shot, launched );

	}

	onFire( shot ) {

		const rt = this.sync.raceTime;
		if ( rt === null || rt - shot.rt > ROCKET.maxLate ) return;
		this.launch( shot );

	}

	kindOf( rocket ) {

		return this.shotKinds.get( rocket.slice( 0, rocket.lastIndexOf( '.' ) ) ) ?? 'rocket';

	}

	// Another racer says one of these rockets hit them: their car blows up
	// (a ball of lightning: their car gets its malus)
	onHit( { id, rocket } ) {

		const car = this.remoteCar( id );

		if ( this.kindOf( rocket ) === 'lightning' ) {

			const flying = this.rockets.get( rocket );

			if ( flying ) {

				this.rockets.delete( rocket );
				this.scene.remove( flying.mesh );

			}

			if ( ! car ) return;
			this.zaps.zap( _p.set( car.x, car.y, car.z ) );
			this.sounds.struck( _p );
			this.zaps.apply( id, malusOf( rocket, id ) );
			return;

		}

		if ( this.rockets.has( rocket ) ) this.explode( rocket, car ? _p.set( car.x, car.y, car.z ) : null );
		if ( ! car ) return;
		this.carExplosion( _p.set( car.x, car.y, car.z ) );
		this.wrecked.set( id, WRECK );

	}

	carExplosion( at ) {

		this.sounds.blast( at, true );
		this.burst( at, 70, 0x3a3a3a, 9 );
		this.fireball( at, 36, 7 );
		this.debris( at, 28, 9 );
		this.flash( at );
		this.light( at, 1 );
		this.shakeFrom( at, 1 );

	}

	// ─── Flight ───

	// Road under ( x, z ): its height and whether that is past the barriers
	roadAt( x, z ) {

		const c = this.roadCache;
		if ( Math.abs( c.x - x ) < 0.3 && Math.abs( c.z - z ) < 0.3 ) return c.value;
		const near = this.path.nearest( x, z, 2 );
		const y = this.path.frameAt( near.s ).y + ROAD_Y;
		c.x = x;
		c.z = z;
		c.value = { y, off: near.dist > WALL };
		return c.value;

	}

	flyRockets( now ) {

		if ( now === null ) return;
		const me = this.myCar();
		const world = {
			targetAt: ( id ) => id === this.sync.you ? me : this.remoteCar( id ),
			roadAt: ( x, z ) => this.roadAt( x, z ),
		};

		for ( const [ id, flying ] of this.rockets ) {

			const { r } = flying;
			let end = null;

			while ( r.t < now && ! end ) {

				end = stepRocket( r, ROCKET.step, world );
				if ( end ) break;

				// My car: I judge it (never my own rocket)
				if ( r.from !== this.sync.you && ( ! r.homing || r.target === this.sync.you ) && rocketHits( r, me ) ) {

					end = 'me';
					this.hitMe( id );
					break;

				}

				// The others' cars: only drawn, they judge it themselves
				for ( const [ other ] of this.sync.remotes ) {

					if ( other === r.from || ( r.homing && r.target !== other ) ) continue;
					if ( rocketHits( r, this.remoteCar( other ) ) ) {

						end = 'them';
						if ( this.localHits ) this.onHit( { id: other, rocket: id } ); // a bot: blown up here
						break;

					}

				}

			}

			if ( end ) this.explode( id );
			else this.drawRocket( flying );

		}

	}

	drawRocket( flying ) {

		const { r, mesh } = flying;
		mesh.position.fromArray( r.pos );

		if ( r.kind === 'lightning' ) {

			this.zaps.crackle( mesh, mesh.position );
			return;

		}

		_d.fromArray( r.dir );
		mesh.quaternion.setFromUnitVectors( _z, _d );
		const flame = mesh.userData.flame;
		flame.scale.set( 1, 0.8 + Math.random() * 0.6, 1 );

		// Smoke behind it
		if ( r.age - flying.trailAt > 0.006 ) {

			flying.trailAt = r.age;
			_p.fromArray( r.pos ).addScaledVector( _d, - 0.6 );
			this.puff( _p, null, 0.42 + Math.random() * 0.15, 0.8 + Math.random() * 0.5, r.homing ? 0xdddddd : 0xeeeeee );
			_p.addScaledVector( _d, - 0.25 ).x += ( Math.random() - 0.5 ) * 0.2;
			this.puff( _p, null, 0.3, 0.6 + Math.random() * 0.4, 0xcfcfcf );
			if ( Math.random() < 0.5 ) this.firePuff( _p.addScaledVector( _d, 0.3 ), null, 0.22, 0.12 );

		}

	}

	explode( id, at = null ) {

		const flying = this.rockets.get( id );
		if ( ! flying ) return;
		this.rockets.delete( id );
		this.scene.remove( flying.mesh );
		const where = at || flying.mesh.position;

		if ( flying.r.kind === 'lightning' ) {

			this.zaps.zap( where, false );
			return;

		}

		this.sounds.blast( where );
		this.burst( where, 40, 0x4a4a4a, 6 );
		this.fireball( where, 18, 5 );
		this.debris( where, 12, 7 );
		this.flash( where );
		this.light( where, 0.6 );
		this.shakeFrom( where, 0.55 );

	}

	// ─── Being hit ───

	hitMe( rocket ) {

		if ( this.turbos.shielded( this.sync.you, this.sync.raceTime ) ) return; // it burst on the bubble
		this.client.hit( rocket );

		// A ball of lightning: no explosion, a malus
		if ( this.kindOf( rocket ) === 'lightning' ) {

			if ( this.wreck > 0 || this.sync.finished ) return;
			this.zaps.zap( this.myCar() );
			this.sounds.shock( this.myCar() );
			this.applyMine( malusOf( rocket, this.sync.you ) );
			return;

		}

		if ( this.immune > 0 || this.sync.finished ) return;

		// The car blows up where it is, and is put back at once (hidden) on the
		// road's centreline, stopped, facing the race
		const v = this.vehicle;
		this.carExplosion( _p.copy( v.spherePos ) );
		this.immune = IMMUNE;
		this.wreck = WRECK;
		this.respawnDue = true; // in the next physics step: the frame puts the drawn car back afterwards
		v.container.visible = false;

	}

	// No control while the car is gone
	gate( input ) {

		return this.wreck > 0 ? NO_INPUT : this.zaps.gate( this.pads.gate( this.turbos.gate( input, this.sync.raceTime ), this.sync.raceTime ) );

	}

	// Turbo.js: through the rift, in the next physics step
	warpMe( exit ) {

		this.warpDue = exit;

	}

	// Turbo.js: the car pulled into / out of a portal (k: size, stretch: along its length)
	setCarStretch( k, stretch ) {

		const model = this.vehicle.container.children[ 0 ];
		if ( ! model ) return;
		model.userData.baseScale ??= model.scale.clone();
		model.scale.copy( model.userData.baseScale ).multiply( _s.set( k, k, k * stretch ) );
		model.visible = k > 0.001;

	}

	riftFlash() {

		this.flashEl.classList.add( 'on' );
		this.flashLeft = 0.06; // s held full, then it fades (frame)

	}

	// Every physics step, after vehicle.update
	afterVehicle( step ) {

		this.immune = Math.max( 0, this.immune - step );

		if ( this.warpDue ) {

			// Out at the exit, facing the race, at the speed it went in
			const exit = this.warpDue;
			this.warpDue = null;
			const v = this.vehicle;
			const from = this.path.nearest( v.spherePos.x, v.spherePos.z, 2 ).s;
			const speed = v.linearSpeed, ground = Math.hypot( v.sphereVel.x, v.sphereVel.z );
			v.respawn( [ exit.x, exit.y, exit.z ], exit.angle );
			v.linearSpeed = speed;
			v.sphereVel.set( Math.sin( exit.angle ) * ground, 0, Math.cos( exit.angle ) * ground );
			if ( v.rigidBody ) rigidBody.setLinearVelocity( v.physicsWorld, v.rigidBody, [ v.sphereVel.x, 0, v.sphereVel.z ] );

			// The road skipped, for my lap counter
			if ( this.onWarp ) {

				const L = this.path.length;
				const length = ( ( ( exit.s - from ) * this.ahead ) % L + L ) % L;
				const points = [];

				for ( let d = 0; d <= length; d += 2 ) {

					const f = this.path.frameAt( ( ( from + this.ahead * d ) % L + L ) % L );
					points.push( { x: f.x, z: f.z } );

				}

				this.onWarp( points );

			}

		}

		if ( this.respawnDue ) {

			this.respawnDue = false;
			const v = this.vehicle;
			const f = this.path.frameAt( this.path.nearest( v.spherePos.x, v.spherePos.z, 2 ).s );
			v.respawn( [ f.x, f.y + ROAD_Y + 0.5, f.z ], Math.atan2( f.tx * this.ahead, f.tz * this.ahead ) );

		}

		if ( this.wreck <= 0 ) return;
		this.wreck = Math.max( 0, this.wreck - step );
		if ( this.wreck === 0 ) this.vehicle.container.visible = true;

	}

	// ─── Effects ───

	buildPuffs() {

		const puffGeometry = new THREE.IcosahedronGeometry( 0.5, 0 );
		const pool = ( geometry, material, count ) => {

			const mesh = new THREE.InstancedMesh( geometry, material, count );
			mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
			mesh.frustumCulled = false;
			for ( let i = 0; i < count; i ++ ) mesh.setColorAt( i, _c.set( 0xffffff ) );
			mesh.count = 0;
			this.scene.add( mesh );
			return mesh;

		};

		this.puffMesh = pool( puffGeometry, new THREE.MeshStandardMaterial( { roughness: 1, flatShading: true } ), PUFFS );
		// Fire: unlit, its colour is its light (yellow → orange → red → soot)
		this.fireMesh = pool( puffGeometry, new THREE.MeshBasicMaterial( { toneMapped: false } ), FIRES );
		this.debrisMesh = pool( new THREE.BoxGeometry( 1, 1, 1 ), new THREE.MeshStandardMaterial( { roughness: 0.7, metalness: 0.2, flatShading: true } ), DEBRIS );
		this.debrisMesh.castShadow = true;
		this.puffs = [];
		this.fires = [];
		this.bits = [];

		// Pooled point lights, always in the scene (adding one later would
		// recompile every material): moved to an explosion and flared up
		this.lights = [];

		for ( let i = 0; i < LIGHTS; i ++ ) {

			const light = new THREE.PointLight( 0xff9a3d, 0, LIGHT_RANGE, 1.6 );
			light.position.set( 0, - 1000, 0 );
			this.scene.add( light );
			this.lights.push( { light, age: Infinity, power: 0 } );

		}

	}

	// delay: s before it shows (an explosion's smoke rolls out of the fireball)
	puff( at, velocity, size, life, color, delay = 0 ) {

		if ( this.puffs.length >= PUFFS ) this.puffs.shift();
		this.puffs.push( { p: at.clone(), v: velocity ? velocity.clone() : new THREE.Vector3( 0, 0.6, 0 ), size, life, age: - delay, color, spin: Math.random() * 6 } );

	}

	// colors: the palette it goes through over its life (fire, or Zap.js sparks)
	firePuff( at, velocity, size, life, colors = FIRE_COLORS ) {

		if ( this.fires.length >= FIRES ) this.fires.shift();
		this.fires.push( { p: at.clone(), v: velocity ? velocity.clone() : new THREE.Vector3( 0, 0.4, 0 ), size, life, age: 0, spin: Math.random() * 6, colors } );

	}

	// Smoke thrown out of an explosion, thick and lasting
	burst( at, count, color, speed ) {

		for ( let i = 0; i < count; i ++ ) {

			_d.set( Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5 ).normalize().multiplyScalar( speed * ( 0.3 + Math.random() * 0.7 ) );
			this.puff( at, _d, 0.6 + Math.random() * 0.7, 0.8 + Math.random() * 0.9, Math.random() < 0.3 ? 0x777777 : color, 0.1 + Math.random() * 0.15 );

		}

	}

	// The glowing core: fire puffs bursting out fast and burning out quickly
	fireball( at, count, speed ) {

		for ( let i = 0; i < count; i ++ ) {

			_d.set( Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5 ).normalize().multiplyScalar( speed * ( 0.2 + Math.random() * 0.8 ) );
			this.firePuff( at, _d, 0.7 + Math.random() * 0.7, 0.3 + Math.random() * 0.35 );

		}

	}

	// Bits flung out, bouncing on the road around the explosion
	debris( at, count, speed ) {

		const ground = this.roadAt( at.x, at.z ).y;

		for ( let i = 0; i < count; i ++ ) {

			if ( this.bits.length >= DEBRIS ) this.bits.shift();
			const a = Math.random() * Math.PI * 2, out = speed * ( 0.35 + Math.random() * 0.65 );
			this.bits.push( {
				p: at.clone(),
				v: new THREE.Vector3( Math.cos( a ) * out, 3 + Math.random() * speed * 0.8, Math.sin( a ) * out ),
				spin: new THREE.Vector3( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 ).normalize(),
				spinSpeed: 6 + Math.random() * 14,
				q: new THREE.Quaternion().setFromAxisAngle( _d.set( Math.random() - 0.5, 1, Math.random() - 0.5 ).normalize(), Math.random() * 6 ),
				size: new THREE.Vector3( 0.06 + Math.random() * 0.14, 0.03 + Math.random() * 0.06, 0.06 + Math.random() * 0.16 ),
				color: DEBRIS_COLORS[ Math.floor( Math.random() * DEBRIS_COLORS.length ) ],
				ground, age: 0, life: 1.6 + Math.random() * 1.2,
			} );

		}

	}

	flash( at, color = 0xffc04d ) {

		this.flashGeometry ??= new THREE.IcosahedronGeometry( 1, 1 );
		const mesh = new THREE.Mesh( this.flashGeometry, new THREE.MeshBasicMaterial( { color, transparent: true, depthWrite: false, toneMapped: false } ) );
		mesh.position.copy( at );
		this.scene.add( mesh );
		this.flashes.push( { mesh, age: 0 } );

	}

	// The light that has been out longest flares up at the explosion
	light( at, power, color = 0xff9a3d ) {

		const slot = this.lights.reduce( ( a, b ) => ( a.age > b.age ? a : b ) );
		slot.light.color.set( color );
		slot.light.position.set( at.x, at.y + 0.8, at.z );
		slot.age = 0;
		slot.power = power;

	}

	// Camera shake, weaker the farther the explosion is from my car
	shakeFrom( at, amount ) {

		if ( ! this.shake ) return;
		const me = this.vehicle.spherePos;
		const near = 1 - Math.min( 1, Math.hypot( at.x - me.x, at.z - me.z ) / SHAKE_RANGE );
		if ( near > 0 ) this.shake( amount * near );

	}

	// A homing rocket after my car: a beep, quicker and higher as it closes in
	warnIncoming( dt ) {

		let closest = Infinity;
		const me = this.vehicle.spherePos;

		for ( const { r } of this.rockets.values() ) {

			if ( r.homing && r.target === this.sync.you ) closest = Math.min( closest, Math.hypot( r.pos[ 0 ] - me.x, r.pos[ 1 ] - me.y, r.pos[ 2 ] - me.z ) );

		}

		const now = this.sync.raceTime;
		for ( const strike of this.strikes ) if ( strike.target === this.sync.you && now !== null ) closest = Math.min( closest, Math.max( 0, strike.at - now ) * 60 );

		if ( closest === Infinity ) {

			this.beepIn = 0;
			return;

		}

		this.beepIn -= dt;
		if ( this.beepIn > 0 ) return;
		const near = 1 - Math.min( 1, closest / 45 );
		this.beepIn = 0.55 - 0.47 * near; // 0.55 s apart far away, 0.08 s on top of the car
		this.beep( 880 + 700 * near );

	}

	// A short square-wave blip, straight to the listener (not positional)
	beep( frequency ) {

		const audio = this.audio;
		if ( ! audio || ! audio.unlocked || audio.paused || ! audio.listener ) return;
		const ctx = audio.listener.context;
		if ( ctx.state !== 'running' ) return;

		const t = ctx.currentTime;
		const osc = ctx.createOscillator();
		osc.type = 'square';
		osc.frequency.setValueAtTime( frequency, t );
		const tone = ctx.createBiquadFilter();
		tone.type = 'lowpass';
		tone.frequency.value = 3200;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime( 0, t );
		gain.gain.linearRampToValueAtTime( 0.09, t + 0.005 );
		gain.gain.setValueAtTime( 0.09, t + 0.05 );
		gain.gain.exponentialRampToValueAtTime( 0.0001, t + 0.085 );
		osc.connect( tone ).connect( gain ).connect( audio.listener.getInput() );
		osc.start( t );
		osc.stop( t + 0.1 );

	}

	updateEffects( dt ) {

		// Smoke: swells, drifts up, thins out
		let n = 0;
		this.puffs = this.puffs.filter( ( p ) => ( p.age += dt ) < p.life );

		for ( const p of this.puffs ) {

			if ( p.age < 0 ) continue; // not out yet
			p.p.addScaledVector( p.v, dt );
			p.v.multiplyScalar( Math.max( 0, 1 - dt * 3 ) );
			p.v.y += dt * 0.8;
			const t = p.age / p.life;
			const grow = t < 0.12 ? t / 0.12 : 1 + 0.35 * ( t - 0.12 ) - 1.35 * Math.max( 0, t - 0.6 ) / 0.4;
			_q.setFromAxisAngle( _z, p.spin + t * 3 );
			_m.compose( p.p, _q, _s.setScalar( Math.max( 0.001, p.size * grow ) ) );
			this.puffMesh.setMatrixAt( n, _m );
			this.puffMesh.setColorAt( n, _c.set( p.color ) );
			n ++;

		}

		this.puffMesh.count = n;
		this.puffMesh.instanceMatrix.needsUpdate = true;
		this.puffMesh.instanceColor.needsUpdate = true;

		// Fire: pops out big, cools from yellow to soot while it shrinks
		n = 0;
		this.fires = this.fires.filter( ( p ) => ( p.age += dt ) < p.life );

		for ( const p of this.fires ) {

			p.p.addScaledVector( p.v, dt );
			p.v.multiplyScalar( Math.max( 0, 1 - dt * 5 ) );
			p.v.y += dt * 2;
			const t = p.age / p.life;
			const grow = t < 0.1 ? 0.4 + 6 * t : 1 - 0.85 * ( t - 0.1 ) / 0.9;
			_q.setFromAxisAngle( _z, p.spin + t * 5 );
			_m.compose( p.p, _q, _s.setScalar( Math.max( 0.001, p.size * grow ) ) );
			this.fireMesh.setMatrixAt( n, _m );
			const colors = p.colors;
			const k = Math.min( colors.length - 1.001, t * ( colors.length - 1 ) );
			_c.set( colors[ Math.floor( k ) ] ).lerp( _c2.set( colors[ Math.floor( k ) + 1 ] ), k % 1 ).multiplyScalar( 1.6 - t ); // brighter than white while hot
			this.fireMesh.setColorAt( n, _c );
			n ++;

		}

		this.fireMesh.count = n;
		this.fireMesh.instanceMatrix.needsUpdate = true;
		this.fireMesh.instanceColor.needsUpdate = true;

		// Debris: thrown, spinning, bouncing on the road, then shrinking away
		n = 0;
		this.bits = this.bits.filter( ( b ) => ( b.age += dt ) < b.life );

		for ( const b of this.bits ) {

			b.v.y -= GRAVITY * dt;
			b.p.addScaledVector( b.v, dt );
			const floor = b.ground + b.size.y / 2;

			if ( b.p.y < floor ) {

				b.p.y = floor;
				b.v.y = b.v.y < - 1.5 ? - b.v.y * 0.35 : 0;
				b.v.x *= 0.6;
				b.v.z *= 0.6;
				b.spinSpeed *= 0.5;

			}

			b.q.premultiply( _q.setFromAxisAngle( b.spin, b.spinSpeed * dt ) );
			const fade = Math.min( 1, ( b.life - b.age ) / 0.3 );
			_m.compose( b.p, b.q, _s.copy( b.size ).multiplyScalar( Math.max( 0.001, fade ) ) );
			this.debrisMesh.setMatrixAt( n, _m );
			this.debrisMesh.setColorAt( n, _c.set( b.color ) );
			n ++;

		}

		this.debrisMesh.count = n;
		this.debrisMesh.instanceMatrix.needsUpdate = true;
		this.debrisMesh.instanceColor.needsUpdate = true;

		// Lights: a hard flare, then a flickering fall
		for ( const slot of this.lights ) {

			slot.age += dt;
			const t = slot.age / LIGHT_TIME;
			slot.light.intensity = t < 1 ? LIGHT_POWER * slot.power * ( 1 - t ) * ( 1 - t ) * ( 0.85 + Math.random() * 0.3 ) : 0;

		}

		this.flashes = this.flashes.filter( ( f ) => {

			f.age += dt;
			const t = f.age / 0.35;

			if ( t >= 1 ) {

				this.scene.remove( f.mesh );
				f.mesh.material.dispose();
				return false;

			}

			f.mesh.scale.setScalar( 0.4 + t * 2.6 );
			f.mesh.material.opacity = 1 - t;
			return true;

		} );

	}

	// A lightning malus on my car (electrified wheels: their own sound)
	applyMine( malus ) {

		if ( malus === 'reverse' ) this.sounds.reversed( this.myCar() );
		this.zaps.apply( this.sync.you, malus );

	}

	// Sky strikes due: the bolt on each car still there; mine gets its malus
	landStrikes( now ) {

		if ( now === null ) return;
		const you = this.sync.you;
		let thunder = null, closest = Infinity; // one thunderclap a frame for the others' strikes: the nearest
		const me = this.myCar();

		this.strikes = this.strikes.filter( ( strike ) => {

			if ( now < strike.at ) return true;
			const mine = strike.target === you;
			const car = mine ? me : this.remoteCar( strike.target );
			if ( ! car ) return false;
			this.zaps.strike( car );
			if ( ! mine ) {

				const d = me ? Math.hypot( car.x - me.x, car.z - me.z ) : 0;
				if ( d < closest ) { closest = d; thunder = car; }

			}
			if ( this.turbos.shielded( strike.target, now ) ) return false; // the bubble takes it
			if ( ! mine ) this.zaps.apply( strike.target, malusOf( strike.key, strike.target ) );
			else if ( this.wreck === 0 && ! this.sync.finished ) {

				this.sounds.shock( car, strike.level );
				this.applyMine( malusOf( strike.key, you ) );

			}
			return false;

		} );

		if ( thunder ) this.sounds.struck( thunder );

	}

	// ─── Every frame ───

	// input: this frame's controls (fire = the key held)
	frame( input, dt ) {

		this.time += dt;

		if ( this.warmup && this.time > 2 ) {

			this.scene.remove( this.warmup );
			this.warmup = null;

		}

		const pressed = !! input.fire && ! this.firing;
		this.firing = !! input.fire;
		if ( pressed && this.item && this.sync.started && ! this.sync.finished && this.wreck === 0 ) this.fire();

		// Remote cars blown up: hidden for a moment (their state already jumped back on the road)
		for ( const [ id, left ] of this.wrecked ) {

			const car = this.sync.remotes.get( id )?.ghost.container.children[ 0 ];
			if ( car ) car.visible = left - dt <= 0;
			if ( left - dt <= 0 ) this.wrecked.delete( id );
			else this.wrecked.set( id, left - dt );

		}

		this.updateBoxes( dt );
		this.flyRockets( this.sync.raceTime );
		this.landStrikes( this.sync.raceTime );
		this.sounds.update();
		this.zaps.frame( dt, this.sync.raceTime );
		this.turbos.frame( dt, this.sync.raceTime );
		this.pads.frame( dt, this.sync.started && ! this.sync.finished && this.wreck === 0 ? this.sync.raceTime : null );
		if ( this.flashLeft > 0 && ( this.flashLeft -= dt ) <= 0 ) this.flashEl.classList.remove( 'on' );
		this.updateEffects( dt );

		this.warnIncoming( dt );

	}

}
