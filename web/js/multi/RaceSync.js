// Game side of a multiplayer race (play.html?lobby=): holds the car until the
// common start, sends its state 20 times a second, draws the other cars a
// little in the past (RemoteTrack, delay fitted to the lag) as see-through cars
// (GhostCar), keeps the live order, reports the finish and shows the podium.
// A late state that moves where a car should be is not shown as a jump: the
// gap is drawn as an offset that fades out (SMOOTHING).
// The race clock is the server's: ( serverNow - startAt ).

import * as THREE from 'three';
import { GhostCar } from '../Ghost.js';
import { formatTime } from '../Settings.js';
import { RemoteTrack } from './RemoteTrack.js';
import { rank, ordinal } from './Standings.js';
import { trackFinish } from '../Stats.js';
import { RaceHud } from './RaceHud.js';
import { STATES_PER_SECOND } from './Protocol.js';
import { collisionActive, pushLimit, pushBaseline, COLLISION } from './Collisions.js';
import { leavePage } from '../PageTransition.js';
import { t } from '../i18n.js';

const NO_INPUT = Object.freeze( { x: 0, z: 0, handbrake: false, touchActive: false } );
const SEND_EVERY = 1 / STATES_PER_SECOND; // s of race time
const SMOOTHING = 0.12; // s: time constant of the fade of a correction
const MAX_SMOOTHED = 3; // m: a bigger correction (respawn) is shown at once
const LABEL_HEIGHT = 1.4; // m above a remote car
const _v = new THREE.Vector3();
const round = ( v, digits ) => Math.round( v * 10 ** digits ) / 10 ** digits;

export class RaceSync {

	constructor( { client, lobby, you, race, scene, camera, loadCar, progress, world } ) {

		this.client = client;
		this.lobby = lobby;
		this.you = you;
		this.race = race;
		this.names = new Map( race.grid.map( ( g ) => [ g.id, g.name ] ) ); // the live standings' names
		this.scene = scene;
		this.camera = camera;
		this.world = world;
		this.bodies = null; // RemoteBodies when the lobby plays with collisions
		this.loadCar = loadCar;
		this.progress = progress; // () → 0 at the start, 1 at the finish
		this.remotes = new Map(); // id → { ghost, track, label, name }
		this.hud = new RaceHud( { laps: race.kind === 'rally' ? 0 : race.laps } );
		this.finished = false;
		this.pendingFinish = false; // finish sent, not confirmed by the server yet
		this.resynced = false;
		this.leaving = false;
		this.lapsDone = 0;
		this.nextSend = - Infinity; // race time of the next state to send
		this.lastFrame = null; // performance.now() of the last render

		client.addEventListener( 'states', ( e ) => this.onStates( e.detail.states ) );
		client.addEventListener( 'lobby', ( e ) => this.onLobby( e.detail.lobby ) );
		client.addEventListener( 'left', () => this.backToMenu( t( 'race.notInLobby' ) ) );
		client.addEventListener( 'error', ( e ) => this.onError( e.detail.message ) );
		client.addEventListener( 'status', () => {

			if ( client.status === 'lost' || client.status === 'idle' ) this.backToMenu( t( 'race.lostConnection' ) );

		} );

		// Page reloaded after crossing the line: the server already has the time
		const mine = lobby.race?.finishes?.[ you ];
		if ( mine !== undefined ) this.confirmFinish( mine );

	}

	// The other racers' cars (see-through), before telling the server we're ready
	async prepare() {

		const solid = !! this.race.collisions;

		if ( solid ) {

			const { RemoteBodies } = await import( './RemoteBodies.js' );
			this.bodies = new RemoteBodies( this.world );

		}

		for ( const g of this.race.grid ) {

			if ( g.id === this.you ) continue;
			const model = await this.loadCar( g.car || 'truck', g.color ).catch( () => this.loadCar( 'truck', 1 ) );
			const ghost = new GhostCar( model, { seeThrough: ! solid } );
			if ( this.bodies ) this.bodies.add( g.id );
			this.scene.add( ghost.container );
			this.remotes.set( g.id, { ghost, track: new RemoteTrack(), label: this.hud.label( g.name ), name: g.name, offset: [ 0, 0, 0 ] } );

		}

	}

	// Every physics step, before updateWorld: the other cars' boxes follow
	// where those cars are now (collisions only)
	beforePhysics( vehicle, dt ) {

		if ( ! this.bodies ) return;
		const rt = this.raceTime;
		const me = vehicle.spherePos;
		const selfJump = this.lastSelf ? Math.hypot( me.x - this.lastSelf[ 0 ], me.y - this.lastSelf[ 1 ], me.z - this.lastSelf[ 2 ] ) : 0;
		this.lastSelf = [ me.x, me.y, me.z ];
		const v = vehicle.rigidBody.motionProperties.linearVelocity;
		let nearSpeed = - 1; // fastest solid car within guardDistance, -1 = none

		for ( const [ id, remote ] of this.remotes ) {

			const state = rt === null ? null : remote.track.predict( rt );
			const distance = state ? Math.hypot( state.x - vehicle.spherePos.x, state.z - vehicle.spherePos.z ) : Infinity;
			const last = remote.lastTarget;
			const jump = state && last ? Math.hypot( state.x - last.x, state.y - last.y, state.z - last.z ) : 0;
			remote.lastTarget = state;
			const finished = this.lobby.race?.finishes?.[ id ] !== undefined;
			const active = collisionActive( { rt, latestRt: remote.track.latest()?.rt ?? null, distance, wasActive: this.bodies.isActive( id ), jump, finished, selfJump } );
			const velocity = remote.track.velocity();
			this.bodies.update( id, state, velocity, active, dt );
			remote.active = active; // what you see is what you hit: only while solid, draw exactly where the collisions see it
			remote.ghost.setSeeThrough( ! active );
			if ( active && distance < COLLISION.guardDistance ) nearSpeed = Math.max( nearSpeed, Math.hypot( velocity[ 0 ], velocity[ 2 ] ) );

		}

		this.pushBase = pushBaseline( this.pushBase ?? null, nearSpeed >= 0, Math.hypot( v[ 0 ], v[ 2 ] ) );
		this.guard = nearSpeed < 0 ? null : { before: this.pushBase, remoteSpeed: nearSpeed };

	}

	// Right after updateWorld: no speed beyond what a real crash could give
	afterPhysics( vehicle ) {

		const guard = this.guard;
		this.guard = null;
		if ( guard ) this.bodies.limitSpeed( vehicle.rigidBody, pushLimit( guard ) );

	}

		loaded() {

		this.client.loaded();
		this.client.resync(); // the page was busy loading: fresh pings for the start

	}

	get startAt() {

		return this.lobby.state === 'racing' || this.lobby.state === 'results' ? this.lobby.race.startAt : null;

	}

	// Race time in s (negative during the countdown), null before the start is known
	get raceTime() {

		return this.startAt === null ? null : ( this.client.serverNow() - this.startAt ) / 1000;

	}

	get started() {

		const rt = this.raceTime;
		return rt !== null && rt >= 0;

	}

	gate( input ) {

		return this.started && ! this.finished ? input : NO_INPUT;

	}

	// lag: time not simulated yet (s): the car's physics state is that old, its
	// race time is stamped accordingly (not the time of the frame, up to a step later)
	step( vehicle, lag = 0 ) {

		if ( ! this.started ) return;
		const rt = this.raceTime - lag;
		if ( rt < this.nextSend ) return;
		this.nextSend = ( Math.floor( rt / SEND_EVERY ) + 1 ) * SEND_EVERY; // steady 20/s whatever the frame rate

		const p = vehicle.container.position;
		const q = vehicle.container.quaternion;
		this.client.sendState( {
			rt: round( rt, 3 ),
			x: round( p.x, 2 ), y: round( p.y, 2 ), z: round( p.z, 2 ),
			qx: round( q.x, 4 ), qy: round( q.y, 4 ), qz: round( q.z, 4 ), qw: round( q.w, 4 ),
			st: round( vehicle.wheelFL ? vehicle.wheelFL.rotation.y : 0, 3 ),
			sp: round( Math.min( 200, Math.abs( vehicle.linearSpeed || 0 ) ), 1 ),
			p: round( Math.max( 0, Math.min( 2, this.progress() ) ), 4 ),
		} );

	}

	// vehicle: to send the last state (progress 1) just before the finish
	finish( vehicle ) {

		if ( this.finished || ! this.started ) return;
		trackFinish( this.race.bonus ? 'bonus' : 'multi' );
		const time = round( this.raceTime, 3 );
		this.nextSend = - Infinity;
		this.step( vehicle );
		this.finished = true;
		this.pendingFinish = true;
		const at = vehicle.container.position;
		this.client.finish( time, round( Math.min( 2, this.progress() ), 4 ), { x: round( at.x, 2 ), z: round( at.z, 2 ) } );
		this.hud.showCard( t( 'race.finish' ), t( 'race.checking', { time: formatTime( time ) } ) );

	}

	confirmFinish( time ) {

		this.finished = true;
		this.pendingFinish = false;
		if ( this.lobby.state !== 'results' ) this.hud.showCard( t( 'race.finish' ), t( 'race.waitingOthers', { time: formatTime( time ) } ) );

	}

	// A finish the server refused: say why and give the car back
	onError( message ) {

		if ( ! this.pendingFinish ) return;
		this.pendingFinish = false;
		this.finished = false;
		this.hud.showCard( t( 'race.refused' ), message );
		setTimeout( () => this.hud.hideCard(), 3000 );

	}

	backToMenu( message ) {

		if ( this.leaving ) return;
		this.leaving = true;
		this.hud.showCard( message, t( 'race.backToMenu' ) );
		setTimeout( () => leavePage( 'index.html' ), 2500 );

	}

	// Where a remote car is drawn now, before the fading offset
	target( remote, rt ) {

		// Solid (close enough to collide): drawn where it is now, no interpolation lag
		// (what you see is what you hit). Not solid (most of the race): smoothly
		// interpolated like without collisions, it can't hit the player anyway.
		return this.bodies && remote.active ? remote.track.predict( rt ) : remote.track.display( rt );

	}

	onStates( states ) {

		const rt = this.raceTime;

		for ( const s of states ) {

			const remote = this.remotes.get( s.id );
			if ( ! remote ) continue;
			const before = rt === null ? null : this.target( remote, rt );
			if ( ! remote.track.push( s, rt ) || ! before ) continue;

			// The new state moved the car: keep it drawn where it was, the gap fades out
			const after = this.target( remote, rt );
			const o = remote.offset;
			o[ 0 ] += before.x - after.x;
			o[ 1 ] += before.y - after.y;
			o[ 2 ] += before.z - after.z;
			if ( Math.hypot( o[ 0 ], o[ 1 ], o[ 2 ] ) > MAX_SMOOTHED ) o.fill( 0 );

		}

	}

	onLobby( lobby ) {

		this.lobby = lobby;
		if ( lobby.state === 'waiting' ) return void leavePage( 'index.html' );
		if ( ! lobby.race ) return;

		const grid = new Set( lobby.race.grid.map( ( g ) => g.id ) );
		if ( lobby.state === 'racing' && ! grid.has( this.you ) ) return this.backToMenu( t( 'race.leftWithout' ) );

		// Racers dropped at the start or gone: no car left on the track
		for ( const [ id, remote ] of this.remotes ) if ( ! grid.has( id ) ) {

			remote.ghost.place( null );
			remote.label.hidden = true;
			this.bodies?.remove( id );
			this.remotes.delete( id );

		}

		if ( lobby.state === 'racing' && ! this.resynced ) {

			this.resynced = true;
			this.client.resync();

		}

		const mine = lobby.race.finishes?.[ this.you ];
		if ( mine !== undefined && this.pendingFinish ) this.confirmFinish( mine );
		if ( lobby.state === 'results' ) this.showResults( lobby.race.results );

	}

	showResults( results ) {

		const rows = results.map( ( r, i ) => [ String( i + 1 ), r.name, r.time === null ? t( 'race.dnf' ) : formatTime( r.time ) ] );
		const mine = results.findIndex( ( r ) => r.id === this.you );
		this.hud.showCard( mine === 0 ? t( 'race.win' ) : t( 'race.results' ), mine >= 0 ? t( 'race.youFinish', { place: ordinal( mine + 1 ) } ) : '', rows );

	}

	// Once per drawn frame
	render() {

		const now = performance.now();
		const dt = this.lastFrame === null ? 0 : Math.min( 0.1, ( now - this.lastFrame ) / 1000 );
		this.lastFrame = now;
		const fade = Math.exp( - dt / SMOOTHING );
		const rt = this.raceTime;
		this.hud.setCountdown( rt === null ? t( 'race.waiting' ) : rt < - 3 ? t( 'race.ready' ) : rt < 0 ? String( Math.ceil( - rt ) ) : rt < 1 ? t( 'race.go' ) : '' );
		if ( rt === null ) return;

		const finishes = this.lobby.race?.finishes || {};
		const entries = [ { id: this.you, progress: this.progress(), time: finishes[ this.you ] ?? null } ];

		for ( const [ id, remote ] of this.remotes ) {

			remote.track.updateDelay( dt );
			const o = remote.offset;
			for ( let i = 0; i < 3; i ++ ) o[ i ] *= fade;
			const target = this.target( remote, rt );
			const state = target && { ...target, x: target.x + o[ 0 ], y: target.y + o[ 1 ], z: target.z + o[ 2 ] };
			remote.ghost.place( state );
			this.placeLabel( remote, state );
			entries.push( { id, progress: remote.track.latest()?.p ?? 0, time: finishes[ id ] ?? null } );

		}

		const order = rank( entries );
		this.hud.setPosition( order.indexOf( this.you ) + 1, order.length, this.lapsDone + 1 );
		this.hud.setBoard( order.map( ( id ) => ( { name: this.names.get( id ) ?? '', me: id === this.you, time: finishes[ id ] ?? null } ) ) );

	}

	placeLabel( remote, state ) {

		if ( ! state ) {

			remote.label.hidden = true;
			return;

		}

		_v.set( state.x, state.y + LABEL_HEIGHT, state.z ).project( this.camera );
		const visible = _v.z < 1 && Math.abs( _v.x ) < 1.2 && Math.abs( _v.y ) < 1.2;
		remote.label.hidden = ! visible;
		if ( ! visible ) return;
		remote.label.style.left = `${ ( _v.x + 1 ) / 2 * innerWidth }px`;
		remote.label.style.top = `${ ( 1 - _v.y ) / 2 * innerHeight }px`;

	}

}
