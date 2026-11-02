import { loadCar } from './Cars.js';
import { YARIS_CAR } from './YarisMode.js';
import { GhostRecorder, GhostCar } from './Ghost.js';
import { decodeGhost } from './GhostCodec.js';
import { circuitId, fetchLeaderboard, fetchRecordGhost, fetchTasGhost, submitLap, archiveLap } from './Leaderboard.js';
import { OFFICIAL_CIRCUITS, isOfficialPublished } from './multi/Protocol.js';
import { getAccount } from './Account.js';
import { t, ordinal } from './i18n.js';

// Circuit mode online: every lap is recorded, personal bests go to the
// leaderboard server, and a ghost car can race along: the online record lap,
// or the TAS (best lap computed offline, shipped as a file, Kenney circuit).
// Nothing here may stop the game: failures only show a note under the timer.

export const GHOST_MODES = [ 'off', 'record', 'tas' ];

// Settings may hold the old boolean (true = record ghost)
export function ghostMode( value ) {

	if ( value === true ) return 'record';
	return GHOST_MODES.includes( value ) ? value : 'off';

}

function rankText( { rank, record, leaderboard } ) {

	if ( record ) return t( 'circuit.newRecord' );
	return t( 'circuit.rank', { place: ordinal( rank ), total: leaderboard.total } );

}

export class CircuitOnline {

	// trackRef: { track, map } as in the URL (both null = Kenney circuit)
	// car: { id, color } of the player; ghost: a GHOST_MODES value
	// prepare( object ): compiles the shaders of a new ghost car up front
	// boardId: ranked there instead of the circuit's own id (the daily
	// challenge, on a real circuit: same geometry, its own leaderboard)
	// onFinish(): called once a valid lap ends, whatever happens next (not
	// signed in, not a personal best) — audience stats only, never blocks
	constructor( { scene, loader, lapTimer, vehicle, trackRef, car, ghost, yarisMode = false, prepare = null, boardId = null, onFinish = null } ) {

		this.scene = scene;
		this.prepare = prepare;
		this.loader = loader;
		this.lapTimer = lapTimer;
		this.vehicle = vehicle;
		this.car = car;
 this.yarisMode=yarisMode;
		this.trackRef = trackRef;
		this.onFinish = onFinish;
		this.account = null; // { id, pseudo } once known, null when signed out
		getAccount().then( ( account ) => { this.account = account; } );
		this.recorder = new GhostRecorder();
		this.ghostMode = ghostMode( ghost );
		this.ghostCar = null;
		this.shown = null; // { name, time, car, color, frames } on show
		this.ghosts = { record: null, tas: null }; // loaded laps per mode
		this.myBest = null;
		this.id = null;

		lapTimer.onLap = ( time, ranked ) => this.onLap( time, ranked );
		this.ready = Promise.resolve( boardId || circuitId( trackRef ) ).then( ( id ) => {

			this.id = id;
			return Promise.all( [ this.refreshBoard(), this.loadTas(), this.applyGhostMode() ] );

		} );

	}

	async refreshBoard() {

		const res = await fetchLeaderboard( this.id );
		if ( ! res.ok ) return;

		const top = res.data.entries[ 0 ];
		this.lapTimer.setRecord( top ? { name: top.name, time: top.time } : null );
		this.myBest = res.data.mine ? res.data.mine.time : null;

	}

	// The TAS time is shown as a target whatever the ghost mode
	async loadTas() {

		const res = await fetchTasGhost( this.id );
		const lap = res.ok ? this.decode( res.data ) : null;
		this.ghosts.tas = lap;
		this.lapTimer.setTas( lap ? lap.time : null );

	}

	get hasTas() {

		return this.ghosts.tas !== null;

	}

	decode( { name, time, car, color, ghost } ) {

		try {

			return { name, time, car, color, frames: decodeGhost( ghost ) };

		} catch ( e ) {

			console.warn( 'Ghost unusable: ' + e.message );
			return null;

		}

	}

	async applyGhostMode() {

		const mode = this.ghostMode;
		if ( mode === 'off' ) return this.hideGhost();

		if ( mode === 'record' && ! this.ghosts.record ) {

			const res = await fetchRecordGhost( this.id );
			if ( res.ok ) this.ghosts.record = this.decode( res.data );

		}

		// The mode may have changed while loading
		if ( mode === this.ghostMode && this.ghosts[ mode ] ) await this.showGhost( this.ghosts[ mode ] );
		else if ( mode === this.ghostMode ) this.hideGhost();

	}

	hideGhost() {

		this.shown = null;
		if ( this.ghostCar ) this.ghostCar.container.visible = false;

	}

	// Swaps the ghost car for this lap (loads its car model if it changed)
	async showGhost( lap ) {

		const yaris = this.yarisMode;
		const carId = yaris ? YARIS_CAR : lap.car;
		const color = yaris ? 1 : lap.color;
		const sameCar = this.ghostCar && this.ghostCar.car === carId && this.ghostCar.color === color;

		if ( ! sameCar ) {

			const model = await loadCar( this.loader, carId, color ).catch( error => {
				if ( yaris ) throw error;
				return loadCar( this.loader, 'truck', 1 );
			} );
			if ( this.ghostCar ) this.scene.remove( this.ghostCar.container );
			if(model.userData.yarisModel)model.userData.yaris=yaris;
			this.ghostCar = new GhostCar( model );
			this.ghostCar.car = carId;
			this.ghostCar.color = color;
			this.scene.add( this.ghostCar.container );
			if ( this.prepare ) await this.prepare( this.ghostCar.container );

		}

		this.shown = lap;
		this.ghostCar.setFrames( lap.frames );

	}

	setGhostMode( mode ) {

		this.ghostMode = ghostMode( mode );
		if ( this.id ) this.applyGhostMode();

	}

	// Next mode for the pause button: off → record → tas (when there is one) → off
	nextGhostMode() {

		const modes = this.hasTas ? GHOST_MODES : GHOST_MODES.filter( ( m ) => m !== 'tas' );
		return modes[ ( modes.indexOf( this.ghostMode ) + 1 ) % modes.length ];

	}

	async onLap( time, ranked = true ) {

		this.onFinish?.();
		const lap = this.recorder.finish( time, this.vehicle );
		if ( ! lap || ! this.id || ! ranked ) return;
		if ( this.myBest !== null && time >= this.myBest ) {

			// Not a personal best: still kept, with its keys, in the server's private archive (official circuits only, no board)
			if ( this.account?.pseudo && lap.encoded.keys && ( Object.hasOwn( OFFICIAL_CIRCUITS, this.id ) || isOfficialPublished( this.id ) ) ) archiveLap( this.id, { time, car: this.car.id, color: this.car.color, ghost: lap.encoded, ...this.trackRef } ).catch( () => {} );
			return;

		}

		if ( ! this.account ) {

			this.lapTimer.setNote( t( 'circuit.signIn' ) );
			return;

		}

		if ( this.account.error ) {

			this.account = await getAccount(); // the server may be back
			if ( ! this.account?.pseudo ) {

				this.lapTimer.setNote( this.account?.error ? t( 'circuit.boardDown', { why: this.account.error } ) : t( 'circuit.signIn' ) );
				return;

			}

		}

		if ( ! this.account.pseudo ) {

			this.lapTimer.setNote( t( 'circuit.pseudo' ) );
			return;

		}

		const res = await submitLap( this.id, { time, car: this.car.id, color: this.car.color, ghost: lap.encoded, ...this.trackRef } );

		if ( ! res.ok ) {

			this.lapTimer.setNote( res.status === 401 ? t( 'circuit.signInAgain' ) : res.error );
			return;

		}

		if ( ! res.data.improved ) return;

		this.myBest = time;
		this.lapTimer.setNote( rankText( res.data ) );

		if ( res.data.record ) {

			this.lapTimer.setRecord( { name: this.account.pseudo, time } );
			this.ghosts.record = { name: this.account.pseudo, time, car: this.car.id, color: this.car.color, frames: lap.frames };
			if ( this.ghostMode === 'record' ) this.showGhost( this.ghosts.record );

		}

	}

	// Quick restart: the lap under way is dropped
	restart() {

		this.recorder.reset();

	}

	// Every physics step, right after the car moved: the keys it was given
	input( input ) {

		this.recorder.input( input );

	}

	// Every physics step, after lapTimer.update
	step() {

		const lapTime = this.lapTimer.lapTime();
		if ( lapTime !== null ) this.recorder.sample( lapTime, this.vehicle );

	}

	// Every drawn frame; ahead = time since the last physics step, so the
	// ghost moves as smoothly as the interpolated player car
	render( ahead = 0 ) {

		if ( ! this.ghostCar ) return;
		if ( ! this.shown ) {

			this.ghostCar.container.visible = false;
			return;

		}

		const lapTime = this.lapTimer.lapTime();
		this.ghostCar.update( lapTime === null ? null : lapTime + ahead );

	}

}
