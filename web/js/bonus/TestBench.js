// Test mode (play.html?test, menu des salons → « Mode test »): solo on a flat
// oval without trees to try the Expérimental bonuses by hand. Stands in for
// the lobby (a local client and race clock, the same `sync` shape BonusRace
// reads), spawns bots on the road ahead (standing or driving round the oval,
// solid like the cars of a bonus race) and hands out any rocket level with a
// button. The bots never fire; a rocket that reaches one blows it up here
// (BonusRace `localHits`), a driving bot then carries on.

import { TrackPath, roadPieces, ROAD_HALF } from '../SplineTrack.js';
import { CARS } from '../Cars.js';
import { BONUS_LEVELS } from '../multi/Protocol.js';

const STRAIGHT = 80; // m: the oval's straights
const RADIUS = 25; // m: its bends
const BOT_AHEAD = 18; // m in front of the car where a bot appears
const BOT_SPEED = 12; // m/s of a driving bot
const LANES = [ - 1.2, 1.2 ]; // m across the road
const SOLID_FROM = 2.5; // m: a bot turns solid only once the car is this far (never inside it)
const SHOOTER_BEHIND = 30; // m back along the road: where a shot at the player comes from without a bot

// A stadium: two straights joined by half circles, one node mid-bend
export function testPath() {

	const h = STRAIGHT / 2;
	const P = Math.PI;
	return new TrackPath( [
		{ x: - h, z: RADIUS, a: P / 2 },
		{ x: h, z: RADIUS, a: P / 2 },
		{ x: h + RADIUS, z: 0, a: P },
		{ x: h, z: - RADIUS, a: - P / 2 },
		{ x: - h, z: - RADIUS, a: - P / 2 },
		{ x: - h - RADIUS, z: 0, a: 0 },
	], true );

}

const CSS = `
	#test-panel { position: fixed; right: 24px; top: 86px; max-height: calc(100vh - 110px); overflow-y: auto; z-index: 20; display: flex; flex-direction: column; gap: 6px; width: 220px;
		padding: 12px; border-radius: 16px; background: rgba(15, 18, 26, 0.72); backdrop-filter: blur(8px); color: #fff; font: 700 13px var(--text); }
	#test-panel h4 { margin: 0 0 2px; font: italic 900 15px var(--text); }
	#test-panel small { color: rgba(255,255,255,0.6); margin-top: 6px; }
	#test-panel button { padding: 8px 10px; border: 0; border-radius: 10px; background: rgba(255,255,255,0.12); color: #fff; font: inherit; text-align: left; cursor: pointer; }
	#test-panel button:hover { background: rgba(255,255,255,0.22); }
	#test-panel button.bonus { background: linear-gradient(135deg, #ff8a3d, #e5383b); }
	#test-panel button.incoming { background: linear-gradient(135deg, #6b5cff, #3a2fb8); }
	#test-panel .sep { height: 1px; margin: 4px 0; background: rgba(255,255,255,0.15); }
	#test-panel .count { float: right; opacity: 0.7; }
	#test-panel .label { margin-top: 4px; color: rgba(255,255,255,0.75); font-size: 12px; }
	#test-panel .row { display: grid; grid-template-columns: 62px repeat(3, 1fr); gap: 4px; align-items: center; }
	#test-panel .row span { font-size: 11px; color: rgba(255,255,255,0.6); }
	#test-panel .row button { padding: 6px 0; text-align: center; }
	#test-panel .row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
	#test-panel .row3 button { padding: 6px 2px; text-align: center; font-size: 11px; }
	#test-panel button.bolt { background: linear-gradient(135deg, #6fb6ff, #4a3dff); }
	#test-panel button.turbo { background: linear-gradient(135deg, #ffd23d, #ff5a1f); color: #2a1400; }
	#test-panel button.malus { background: linear-gradient(135deg, #2f8fff, #1c2a7a); }
`;

export class TestBench {

	// loadCar( id, color ) → model; vehicle: the player's car
	constructor( { scene, world, path, vehicle, loadCar } ) {

		this.scene = scene;
		this.world = world;
		this.path = path;
		this.vehicle = vehicle;
		this.loadCar = loadCar;
		this.finishS = roadPieces( path, true ).finishS;
		this.bonus = null;
		this.bots = new Map(); // id → { ghost, s, lane, speed, velocity }
		this.nextBot = 1;
		this.t0 = performance.now();
		this.bodies = null;

		// What BonusRace expects of the lobby connection and of RaceSync
		this.client = new EventTarget();
		this.client.fire = () => {};
		this.client.hit = () => {};
		const bench = this;
		this.sync = {
			you: 'me',
			started: true,
			finished: false,
			lobby: { race: { finishes: {} } },
			remotes: this.bots, // BonusRace reads ghost and track.latest()
			get raceTime() {

				return ( performance.now() - bench.t0 ) / 1000;

			},
			progress: () => this.lap( this.path.nearest( vehicle.spherePos.x, vehicle.spherePos.z, 2 ).s ),
		};

		this.buildPanel();

	}

	// The bonus race fed by this bench
	attach( bonus ) {

		this.bonus = bonus;

	}

	// 0..1 round the oval from the start line
	lap( s ) {

		const L = this.path.length;
		return ( ( ( s - this.finishS ) % L ) + L ) % L / L;

	}

	// ─── Bots ───

	async addBot( driving ) {

		const id = 'bot' + this.nextBot ++;
		const car = CARS[ Math.floor( Math.random() * CARS.length ) ];
		const model = await this.loadCar( car.id, 1 + Math.floor( Math.random() * ( car.liveries || 1 ) ) ).catch( () => this.loadCar( 'truck', 1 ) );

		const { GhostCar } = await import( '../Ghost.js' );
		const ghost = new GhostCar( model, { seeThrough: false } );
		ghost.container.visible = true;
		this.scene.add( ghost.container );

		const me = this.vehicle.spherePos;
		const s = this.path.nearest( me.x, me.z, 2 ).s + BOT_AHEAD + ( this.bots.size % 4 ) * 6;
		const bot = {
			ghost, s, lane: LANES[ this.bots.size % LANES.length ], speed: driving ? BOT_SPEED : 0,
			velocity: [ 0, 0, 0 ], state: null,
			track: { latest: () => ( { p: this.lap( bot.s ) } ) },
		};
		this.bots.set( id, bot );
		this.place( bot );

		if ( ! this.bodies ) {

			const { RemoteBodies } = await import( '../multi/RemoteBodies.js' );
			this.bodies ??= new RemoteBodies( this.world );

		}

		this.bodies.add( id );
		this.drawPanel();

	}

	removeBots() {

		for ( const [ id, bot ] of this.bots ) {

			this.scene.remove( bot.ghost.container );
			this.bodies?.remove( id );

		}

		this.bots.clear();
		this.drawPanel();

	}

	// Car base on the road at the bot's arc length, facing along the oval
	place( bot ) {

		const L = this.path.length;
		const f = this.path.frameAt( ( ( bot.s % L ) + L ) % L );
		const yaw = Math.atan2( f.tx, f.tz );
		const state = { x: f.x + f.tz * bot.lane, y: f.y, z: f.z - f.tx * bot.lane, qx: 0, qy: Math.sin( yaw / 2 ), qz: 0, qw: Math.cos( yaw / 2 ), st: 0 };
		bot.velocity[ 0 ] = f.tx * bot.speed;
		bot.velocity[ 2 ] = f.tz * bot.speed;
		bot.state = state;
		return state;

	}

	// Every physics step, before updateWorld: the bots drive on and their boxes follow
	beforePhysics( step ) {

		const me = this.vehicle.spherePos;

		for ( const [ id, bot ] of this.bots ) {

			bot.s += bot.speed * step;
			const state = this.place( bot );
			if ( ! this.bodies ) continue;
			const wrecked = this.bonus?.wrecked.has( id );
			const far = Math.hypot( state.x - me.x, state.z - me.z ) > SOLID_FROM;
			this.bodies.update( id, state, bot.velocity, ! wrecked && ( this.bodies.isActive( id ) || far ), step );

		}

	}

	// Every frame: the bots drawn where they are
	frame() {

		for ( const bot of this.bots.values() ) if ( bot.state ) bot.ghost.place( bot.state );

	}

	// ─── Shots at the player ───

	// A shot of that kind and level at my car, as if a racer had fired it:
	// from the nearest bot, else from the road SHOOTER_BEHIND m behind me.
	// Level 2 lightning also strikes another bot (the two leading), level 3
	// goes for every other bot, like a real salvo
	incoming( level, kind = 'rocket' ) {

		const bonus = this.bonus;
		if ( ! bonus ) return;
		const me = this.vehicle.spherePos;
		let from = null, at = null;

		for ( const [ id, bot ] of this.bots ) {

			if ( ! bot.state || bonus.wrecked.has( id ) ) continue;
			const d = Math.hypot( bot.state.x - me.x, bot.state.z - me.z );
			if ( ! at || d < at.d ) {

				from = id;
				at = { x: bot.state.x, y: bot.state.y, z: bot.state.z, d };

			}

		}

		if ( ! at ) {

			// The farthest point back (up to SHOOTER_BEHIND) a straight shot from
			// which stays on the road: a level 1 rocket would burst on the barrier in a bend
			const L = this.path.length;
			const mine = this.path.nearest( me.x, me.z, 2 ).s;
			from = 'tireur';

			for ( let back = SHOOTER_BEHIND; back >= 6; back -= 2 ) {

				const f = this.path.frameAt( ( ( mine - back ) % L + L ) % L );
				let clear = true;

				for ( let k = 1; k < back && clear; k ++ ) {

					const t = k / back;
					clear = this.path.nearest( f.x + ( me.x - f.x ) * t, f.z + ( me.z - f.z ) * t, 2 ).dist < ROAD_HALF - 0.8;

				}

				at = { x: f.x, y: f.y, z: f.z };
				if ( clear ) break;

			}

		}

		// Straight at my car (a level 1 rocket flies that way)
		const dx = me.x - at.x, dz = me.z - at.z, n = Math.hypot( dx, dz ) || 1;
		const others = [ ...this.bots.keys() ].filter( ( id ) => id !== from );
		const targets = level === 1 ? [] : level === 2 ? [ this.sync.you, ...( kind === 'lightning' ? others.slice( 0, 1 ) : [] ) ] : [ this.sync.you, ...others ];
		this.shotsAtMe = ( this.shotsAtMe ?? 0 ) + 1;
		bonus.launch( { id: from, kind, level, n: this.shotsAtMe, rt: this.sync.raceTime, x: at.x, y: at.y, z: at.z, dx: dx / n, dz: dz / n, targets } );

	}

	// ─── Panel ───

	buildPanel() {

		const style = document.createElement( 'style' );
		style.textContent = CSS;
		document.head.appendChild( style );

		this.panel = document.createElement( 'div' );
		this.panel.id = 'test-panel';
		const button = ( label, run, cls = '' ) => {

			const b = document.createElement( 'button' );
			b.innerHTML = label;
			if ( cls ) b.className = cls;
			b.addEventListener( 'mousedown', ( e ) => e.preventDefault() ); // no focus: Entrée / Espace stay the game's
			b.addEventListener( 'click', run );
			return b;

		};

		const title = document.createElement( 'h4' );
		title.textContent = 'Проверка бонусов';
		this.botButtons = [
			button( '+ Неподвижный бот', () => this.addBot( false ) ),
			button( '+ Едущий бот', () => this.addBot( true ) ),
			button( 'Убрать ботов <span class="count"></span>', () => this.removeBots() ),
		];
		this.panel.append( title, ...this.botButtons );

		// Per bonus: take it (in hand, fire with the usual key) or receive it, levels 1 to 3
		const label = ( text ) => {

			const el = document.createElement( 'div' );
			el.className = 'label';
			el.textContent = text;
			return el;

		};
		const row = ( name, run, cls ) => {

			const el = document.createElement( 'div' );
			el.className = 'row';
			const span = document.createElement( 'span' );
			span.textContent = name;
			el.append( span );
			for ( let level = 1; level <= BONUS_LEVELS; level ++ ) el.append( button( 'ур. ' + level, () => run( level ), cls ) );
			return el;

		};

		for ( const [ kind, name, cls ] of [ [ 'rocket', 'Ракета', 'bonus' ], [ 'lightning', 'Молния', 'bolt' ] ] ) {

			this.panel.append(
				label( name ),
				row( 'Взять', ( level ) => this.bonus?.give( level, kind ), cls ),
				row( 'Получить', ( level ) => this.incoming( level, kind ), 'incoming' ),
			);

		}

		const maluses = document.createElement( 'div' );
		maluses.className = 'row3';
		for ( const [ malus, name ] of [ [ 'reverse', 'Инверсия' ], [ 'shrink', 'Уменьшение' ], [ 'vision', 'Вспышка' ] ] ) {

			maluses.append( button( name, () => this.bonus?.zaps.apply( this.sync.you, malus ), 'malus' ) );

		}

		// Turbo: only for oneself (nothing to receive)
		this.panel.append( label( 'Турбо' ), row( 'Взять', ( level ) => this.bonus?.give( level, 'boost' ), 'turbo' ) );

		this.panel.append( label( 'Эффект на себя' ), maluses );

		const hint = document.createElement( 'small' );
		hint.textContent = 'Ящики «?» тоже работают. «Получить» — ближайший бот стреляет в тебя; без бота выстрел приходит сзади. Кнопки «Эффект на себя» включают выбранный эффект.';
		this.panel.append( hint );
		document.body.appendChild( this.panel );
		this.drawPanel();

	}

	drawPanel() {

		this.botButtons[ 2 ].querySelector( '.count' ).textContent = this.bots.size || '';

	}

}
