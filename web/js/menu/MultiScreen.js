// Multiplayer screens of the menu: "Multijoueur" (create a lobby or join one
// with its code) and "Salon" (players, host settings, vote, chosen race).
// The lobby itself lives on the server; this only draws the last state the
// LobbyClient received and sends the player's actions.

import { LobbyClient, lobbyUrl } from '../multi/LobbyClient.js';
import { formatTime } from '../Settings.js';
import { LAPS, STAGE_M, MIN_PLAYERS, MAX_PLAYERS, OFFICIAL_CIRCUITS, OFFICIAL_PUBLISHED, isOfficialPublished, LOOP_AVAILABLE, choiceKey, choiceLabel, CAMERAS } from '../multi/Protocol.js';
import { LANDSCAPE_IDS } from '../RallyBiomes.js';
import { t } from '../i18n.js';
import { YARIS_CAR } from '../YarisMode.js';
import { debugLog } from '../DebugLog.js';

const log = debugLog( 'lobby' );

const COMMUNITY_SHOWN = 12;
const CAMERA_LABELS = Object.fromEntries( CAMERAS.map( ( id ) => [ id, t( 'lobby.cameras.' + id ) ] ) );
const CROWN = '<svg class="crown" viewBox="0 0 24 24"><path d="M3 18h18l-1.5-10-5 4L12 5l-2.5 7-5-4z"/></svg>';

export function createMulti( { player, settings, escapeHtml, segmented, listPublished, findCar, onChange, onWalls, onEnterLobby, onLeaveLobby, onRace, onTest, onYarisSolo, onGarage } ) {

	const client = new LobbyClient( { url: lobbyUrl( location ) } );
	let message = ''; // last error or reason shown on the screens
	let community = null; // published circuits for the vote, or { error }
	let tick = null;
	let onScreen = false; // the lobby screen is (or is about to be) shown
	let leaving = false; // on the way to play.html: ignore further updates
	let typedCode = ''; // kept in the field when the server refuses it

	client.addEventListener( 'lobby', () => {

		if ( leaving ) return;
		message = '';
        syncCar();

		// Vote over and this player is on the grid: off to the race
		if ( client.lobby.state === 'loading' && inRace() ) {

			leaving = true;
			return onRace( client.lobby.code );

		}

		const entering = ! onScreen;
		onScreen = true;
		if ( entering && client.watching !== null ) client.watch( null ); // in a lobby: no more list
		browse.creating = false;
		if ( client.lobby.state === 'voting' && ! community ) loadCommunity();
		if ( entering ) onEnterLobby();
		else onChange();

	} );

	client.addEventListener( 'left', ( e ) => {

		stopCountdown();
		onScreen = false;
		message = e.detail.reason;
		onLeaveLobby( e.detail.reason );

	} );

	client.addEventListener( 'error', ( e ) => {

		message = e.detail.message;
		onChange();

	} );

	client.addEventListener( 'status', () => onChange() );

	async function loadCommunity() {

		const r = await listPublished();
		community = r.ok ? { circuits: r.data.circuits.slice( 0, COMMUNITY_SHOWN ) } : { error: r.error };
		onChange();

	}

	const me = () => client.lobby?.players.find( ( pl ) => pl.id === client.you );
	const inRace = () => !! client.lobby?.race?.grid.some( ( g ) => g.id === client.you );
	const isHost = () => client.lobby?.host === client.you;
	const note = () => message ? `<p class="note warn">${ escapeHtml( message ) }</p>` : '';

	const yarisLobby=()=>client.lobby?.settings.yaris || client.lobby?.mode==='yaris';
 function syncCar(){const mine=me();if(mine&&client.lobby.state==='waiting'&&!yarisLobby()&&(mine.car!==settings.car||mine.color!==settings.color)) client.setCar(settings.car,settings.color);}
 const bonusLobby = () => client.lobby?.mode === 'bonus';

	// ─── "Multijoueur" and "Expérimental": a column on the home's left wall ───
	// (wall(): Walls.js tiles, like Circuit's) — create a lobby, join one with
	// its code (those two need typing: a small form card on the right, HTML),
	// the public lobbies a page at a time

	const browse = { mode: 'classic', creating: false, visibility: 'public', name: '', codeOpen: false, page: 0, yaris:false };
	const named = () => player.signedIn && player.name !== '';
	const COLUMN = 0.92, GAP = 0.008, PAGE = 4;
	const across = ( n ) => ( COLUMN - GAP * ( n - 1 ) ) / n;

	function wall( mode = 'classic' ) {

		const bonus = mode === 'bonus';
		const L = { side: 'left' };
		const can = named();
		const caption = ( title ) => ( { ...L, kind: 'caption', w: COLUMN, h: 0.05, title, data: {} } );
		const out = [
			{ ...L, kind: 'tab', row: 'act', w: across( 2 ), h: 0.12, title: t( 'multi.create' ), accent: can, big: true, off: ! can, data: { act: 'multi-new' } },
			{ ...L, kind: 'tab', row: 'act', w: across( 2 ), h: 0.12, title: t( 'multi.joinCode' ), off: ! can, data: { act: 'multi-code' } },
			...( mode === 'yaris' ? [] : [ caption( bonus ? t( 'multi.bonusCaption' ) : t( 'multi.publicCaption', { min: MIN_PLAYERS, max: MAX_PLAYERS } ) ) ] ),
		];
		if ( mode === 'yaris' || mode==='beta' ) out.unshift(
			{ ...L, kind: 'tab', w: COLUMN, h: 0.13, title: t( 'club.yarisSolo' ), big: true, accent: true, data: { act: 'multi-solo' } },
		);

		const list = client.lobbies;
		if ( ! can ) out.push( caption( player.offline ? t( 'multi.accountsDown' ) : player.signedIn ? t( 'multi.needPseudo' ) : t( 'multi.needSignIn' ) ) );
		// Given up reconnecting: say so (not an endless "loading") and let the player try again
		else if ( client.status === 'lost' ) out.push( caption( t( 'lobby.lost' ) ), { ...L, kind: 'tab', w: COLUMN, h: 0.1, title: t( 'account.retry' ), accent: true, data: { act: 'multi-retry' } } );
		else if ( list === null ) out.push( caption( t( 'multi.loading' ) ) );
		else if ( list.length === 0 ) { if ( mode !== 'yaris' ) out.push( caption( t( 'multi.none' ) ) ); }
		else {

			const pages = Math.ceil( list.length / PAGE );
			browse.page = Math.min( Math.max( 0, browse.page ), pages - 1 );
			for ( const l of list.slice( browse.page * PAGE, browse.page * PAGE + PAGE ) ) {

				const full = l.players >= l.max, racing = l.state !== 'waiting';
				out.push( { ...L, kind: 'row', w: COLUMN, h: 0.12, badge: `${ l.players }/${ l.max }`, title: l.name,
					sub: t( 'multi.lobbyLine', { host: l.host, state: t( racing ? 'multi.racing' : full ? 'multi.full' : 'multi.open' ) } ), off: full || racing, open: ! full && ! racing,
					data: { act: 'multi-join-code:' + l.code } } );

			}

			if ( pages > 1 ) {

				const page = { ...L, kind: 'tab', row: 'pages', h: 0.08, w: across( 3 ) };
				out.push( { ...page, title: t( 'pager.prev' ), off: browse.page === 0, data: { act: 'multi-page:-1' } } );
				out.push( { ...page, title: `${ browse.page + 1 } / ${ pages }`, off: true, data: {} } );
				out.push( { ...page, title: t( 'pager.next' ), off: browse.page === pages - 1, data: { act: 'multi-page:1' } } );

			}

		}

		if ( message ) out.push( caption( message ) );
		return out;

	}

	function createPanel( bonus ) {

		const pub = browse.visibility === 'public';
		return '<div class="lobby-create">' +
			`<h3>${ t( 'multi.newTitle' ) }</h3>` +
			`<label class="field">${ t( 'multi.visibility' ) }</label>` +
			`<div class="seg"><button data-act="multi-vis:public" class="${ pub ? 'on' : '' }">${ t( 'multi.public' ) }</button><button data-act="multi-vis:private" class="${ pub ? '' : 'on' }">${ t( 'multi.private' ) }</button></div>` +
			( pub
				? `<label class="field" for="lobby-name">${ t( 'multi.name' ) }</label>` +
					`<input id="lobby-name" maxlength="24" autocomplete="off" spellcheck="false" placeholder="${ escapeHtml( t( 'multi.defaultName', { name: player.name } ) ) }" value="${ escapeHtml( browse.name ) }">` +
					`<p class="note">${ t( 'multi.publicNote' ) }</p>`
				: `<p class="note">${ t( 'multi.privateNote' ) }</p>` ) +
			`<label class="field"><input id="lobby-yaris" type="checkbox" ${browse.yaris?'checked':''}> Yaris Mode</label>` +
			( bonus || browse.mode === 'yaris' ? '' : `<p class="note mode-note">${ t( 'multi.tryBonusHint' ) }</p>` ) +
			`<div class="row actions"><button data-act="multi-new-cancel">${ t( 'common.cancel' ) }</button><button class="go" data-act="multi-create-go">${ t( 'multi.createGo' ) }</button></div>` +
			'</div>';

	}

	function codePanel() {

		return '<div class="lobby-create">' +
			`<h3>${ t( 'multi.joinTitle' ) }</h3>` +
			`<label class="field" for="lobby-code">${ t( 'lobby.code' ) }</label>` +
			`<input id="lobby-code" maxlength="7" autocomplete="off" spellcheck="false" placeholder="K7QWX" value="${ escapeHtml( typedCode ) }">` +
			note() +
			`<div class="row actions"><button data-act="multi-code-cancel">${ t( 'common.cancel' ) }</button><button class="go" data-act="multi-join">${ t( 'multi.joinGo' ) }</button></div>` +
			'</div>';

	}

	function multiScreen( mode = 'classic' ) {

		const bonus = mode === 'bonus';
		if ( browse.mode !== mode ) Object.assign( browse, { mode, creating: false, codeOpen: false, page: 0 } );
		const form = browse.creating ? createPanel( bonus ) : browse.codeOpen ? codePanel() : '';

		return {
			view: 'menu',
			title: mode==='beta'?'Бета-режим': mode === 'yaris' ? 'Yaris Mode' : bonus ? t( 'home.experimental' ) : t( 'home.multi' ),
			after: () => {

				stopCountdown();
				if ( ! named() ) log( `${ mode } screen: not connecting yet (${ player.offline ? 'accounts unavailable' : player.signedIn ? 'no profile name' : 'account not known yet or signed out' })` );
				else if ( client.watching !== mode ) {

					log( `${ mode } screen: listing its public lobbies` );
					client.watch( mode );

				}
				const input = document.getElementById( 'lobby-name' );
				input?.addEventListener( 'input', () => { browse.name = input.value; } );
				( input || document.getElementById( 'lobby-code' ) )?.focus();

			},
			html: form ? `<section class="panel lobby-float">${ form }</section>` : '',
		};

	}

	// New list from the server: only the wall is redrawn (a field being typed in keeps its focus)
	client.addEventListener( 'lobbies', () => onWalls() );

	// Off the lobby screens: stop listening to the list (and free the socket when not in a lobby)
	function stopBrowsing() {

		if ( client.watching === null ) return;
		log( 'left the multiplayer screens: no more lobby list' + ( client.lobby ? '' : ', socket closed' ) );
		client.watch( null );
		if ( ! client.lobby ) client.close();

	}

	// ─── "Salon" ───

	function playerRow( pl ) {

		const car = findCar( pl.car );
		const badges = ( pl.id === client.lobby.host ? CROWN : '' ) + ( pl.connected ? '' : `<em class="off">${ t( 'lobby.disconnected' ) }</em>` );
		const state = pl.ready ? `<span class="ready on">${ t( 'lobby.ready' ) }</span>` : `<span class="ready">${ t( 'lobby.notReady' ) }</span>`;
		const kick = isHost() && pl.id !== client.you ? `<button class="mini-btn" data-act="multi-kick:${ pl.id }" title="${ t( 'lobby.kick' ) }">✕</button>` : '';
		return `<li class="${ pl.id === client.you ? 'me' : '' }"><b>${ escapeHtml( pl.name ) }</b>${ badges }<small>${ yarisLobby() ? '' : car ? escapeHtml( t( 'lobby.carLine', { car: car.label, n: pl.color } ) ) : '–' }</small>${ state }${ kick }</li>`;

	}

	function stepper( name, value, min, max, step, label ) {

		const host = isHost() && client.lobby.state === 'waiting';
		const dis = ( ok ) => host && ok ? '' : ' disabled';
		return `<div class="stepper"><button data-act="multi-set:${ name }:${ value - step }"${ dis( value - step >= min ) }>−</button><b>${ label }</b><button data-act="multi-set:${ name }:${ value + step }"${ dis( value + step <= max ) }>+</button></div>`;

	}

	function settingsPanel() {

		const { laps, length, collisions, landscape, camera = 'iso', yaris=false } = client.lobby.settings;
		const bonus = bonusLobby();
		const host = isHost() && client.lobby.state === 'waiting';
		const collisionSeg = segmented( 'multi-collisions', [ [ 0, t( 'common.no' ) ], [ 1, t( 'common.yes' ) ] ], collisions ? 1 : 0 ).replace( /data-set="multi-collisions" data-value="(\d)"/g, ( _, v ) => `data-act="multi-set:collisions:${ v }"${ host ? '' : ' disabled' }` );
		const cameraSeg = segmented( 'multi-camera', CAMERAS.map( ( id ) => [ id, CAMERA_LABELS[ id ] ] ), camera ).replace( /data-set="multi-camera" data-value="([a-z]+)"/g, ( _, v ) => `data-act="multi-set:camera:${ v }"${ host ? '' : ' disabled' }` );
		const landscapeSeg = segmented( 'multi-landscape', LANDSCAPE_IDS.map( ( id ) => [ id, t( 'landscape.' + id ) ] ), landscape || 'varied' ).replace( /data-set="multi-landscape" data-value="([a-z]+)"/g, ( _, v ) => `data-act="multi-set:landscape:${ v }"${ host ? '' : ' disabled' }` );

		return `<label class="field">Yaris Mode</label><button class="chip" data-act="multi-set:yaris:${yaris?0:1}" aria-pressed="${yaris}" ${host?'':'disabled'}>${yaris?'Включён':'Выключен'}</button>` + ( bonus ? `<p class="note mode-note">${ t( 'lobby.bonusNote' ) }</p>` : '' ) +
			`<label class="field">${ bonus ? t( 'lobby.laps' ) : t( 'lobby.lapsAll' ) }</label>` + stepper( 'laps', laps, LAPS.min, LAPS.max, 1, t( 'lobby.lapCount', { n: laps } ) ) +
			( bonus ? '' : `<label class="field">${ t( 'lobby.stageLength' ) }</label>` + stepper( 'length', length, STAGE_M.min, STAGE_M.max, STAGE_M.step, `${ length / 1000 } km` ) +
			`<label class="field">${ t( 'lobby.stageLandscape' ) }</label>` + landscapeSeg ) +
			`<label class="field">${ t( 'lobby.collisions' ) }</label>` + ( bonus ? `<p class="note">${ t( 'lobby.collisionsBonus' ) }</p>` : collisionSeg ) +
			`<label class="field">${ t( 'lobby.camera' ) }</label>` + cameraSeg + `<p class="note">${ t( 'lobby.cameraNote' ) }</p>` +
			( host ? '' : `<p class="note">${ t( 'lobby.hostOnly' ) }</p>` );

	}

	function waitingActions() {

		const readyCount = client.lobby.players.filter( ( pl ) => pl.ready && pl.connected ).length;
		const mine = me();
		const ready = `<button class="${ mine?.ready ? '' : 'go' }" data-act="multi-ready">${ mine?.ready ? t( 'lobby.unready' ) : t( 'lobby.ready' ) }</button>`;
		const vote = isHost() ? `<button class="go" data-act="multi-vote-start"${ readyCount >= MIN_PLAYERS ? '' : ' disabled' }>${ t( 'lobby.startVote' ) }</button>` : '';
		const hint = readyCount < MIN_PLAYERS ? `<p class="note">${ t( 'lobby.needReady', { n: MIN_PLAYERS } ) }</p>` : '';
		return `<div class="row actions">${ ready }${ vote }</div>${ hint }`;

	}

	function voteCard( choice, sub ) {

		const key = choiceKey( choice );
		const voters = client.lobby.players.filter( ( pl ) => client.lobby.votes[ pl.id ] && choiceKey( client.lobby.votes[ pl.id ] ) === key );
		const mine = client.lobby.votes[ client.you ] && choiceKey( client.lobby.votes[ client.you ] ) === key;
		const act = 'multi-vote:' + choice.kind + ( choice.id ? ':' + choice.id : '' );
		const names = voters.map( ( pl ) => escapeHtml( pl.name ) ).join( ', ' );
		return `<button class="card vote${ mine ? ' on' : '' }" data-act="${ act }"><span class="card-text"><b>${ escapeHtml( choiceLabel( choice ) ) }</b><small>${ escapeHtml( sub ) }</small>${ voters.length ? `<small class="voters">${ t( 'vote.voters', { n: voters.length, names } ) }</small>` : '' }</span></button>`;

	}

	function votePanel() {

		const official = [
			...Object.keys( OFFICIAL_CIRCUITS ).map( ( id ) => voteCard( { kind: 'official', id }, t( 'circuits.official' ) ) ),
			// voted as the published circuit (same choice key as its Communauté card)
			...OFFICIAL_PUBLISHED.map( ( o ) => voteCard( { kind: 'circuit', id: o.id, name: o.name }, t( 'circuits.official' ) ) ),
		];
		const loopCard = LOOP_AVAILABLE
			? voteCard( { kind: 'loop' }, t( 'vote.loopSub', { n: client.lobby.settings.laps } ) )
			: `<button class="card vote" disabled><span class="card-text"><b>${ t( 'vote.loop' ) }</b><small>${ t( 'vote.soon' ) }</small></span></button>`;
		const random = [ voteCard( { kind: 'rally' }, t( 'vote.rallySub', { km: client.lobby.settings.length / 1000, landscape: t( 'landscape.' + ( client.lobby.settings.landscape || 'varied' ) ) } ) ), loopCard ];
		let list = `<p class="note">${ t( 'circuits.loading' ) }</p>`;
		if ( community?.error ) list = `<p class="note">${ escapeHtml( community.error ) }</p>`;
		else if ( community ) list = community.circuits.filter( ( c ) => ! isOfficialPublished( c.id ) ).map( ( c ) => voteCard( { kind: 'circuit', id: c.id, name: c.name }, t( 'vote.communitySub', { author: c.author, stars: c.stars } ) ) ).join( '' ) || `<p class="note">${ t( 'circuits.nonePublished' ) }</p>`;

		return `<p class="countdown">${ t( 'vote.endsIn', { time: `<b data-deadline="${ client.lobby.deadline }">…</b>` } ) }</p>` +
			( bonusLobby() ? '' : `<h4>${ t( 'vote.random' ) }</h4><div class="cards">${ random.join( '' ) }</div>` ) +
			`<h4>${ t( 'circuits.tabOfficial' ) }</h4><div class="cards">${ official.join( '' ) }</div>` +
			`<h4>${ t( 'circuits.tabCommunity' ) }</h4><div class="cards">${ list }</div>`;

	}

	function racePanel() {

		const lobby = client.lobby;
		const race = lobby.race;
		const detail = race.kind === 'rally' ? t( 'race.stageLine', { seed: race.seed, km: race.length / 1000 } ) : t( 'lobby.lapCount', { n: race.laps } );
		const head = `<h3>${ escapeHtml( choiceLabel( race ) ) }</h3><p class="by">${ detail }${ race.bonus ? ' · ' + t( 'lobby.bonus' ) : '' }</p>`;

		if ( lobby.state === 'results' ) {

			const rows = race.results.map( ( r, i ) => `<li><b>${ i + 1 }</b><span>${ escapeHtml( r.name ) }</span><em>${ r.time === null ? t( 'race.dnf' ) : formatTime( r.time ) }</em></li>` ).join( '' );
			return head + `<ol class="results">${ rows }</ol><p class="note">${ t( 'lobby.backSoon' ) }</p>`;

		}

		if ( inRace() ) {

			return head + ( lobby.state === 'loading' ? `<p class="note">${ t( 'lobby.raceLoading' ) }</p>`
				: `<p class="note">${ t( 'lobby.raceOn' ) }</p><div class="row actions"><button class="go" data-act="multi-rejoin">${ t( 'lobby.rejoin' ) }</button></div>` );

		}

		return head + `<p class="note">${ t( 'lobby.nextRace' ) }</p>`;

	}

	function lobbyScreen() {

		const lobby = client.lobby;

		if ( ! lobby ) {

			return { view: 'split', title: t( 'lobby.title' ), html: `<section class="panel"><p class="note">${ client.status === 'lost' ? t( 'lobby.lost' ) : t( 'lobby.connecting' ) }</p>${ note() }</section>` };

		}

		const main = lobby.state === 'voting' ? votePanel() : lobby.state === 'waiting' ? settingsPanel() + waitingActions() : racePanel();
		const offline = client.status === 'open' ? ''
			: client.status === 'connecting' ? `<p class="note warn">${ t( 'lobby.reconnecting' ) }</p>`
			: `<p class="note warn">${ t( 'lobby.reload' ) }</p>`;

		return {
			view: 'split',
			title: t( 'lobby.title' ),
			html:
				'<div class="split">' +
				`<section class="panel browser lobby-main">${ main }${ note() }${ offline }</section>` +
				'<aside class="panel detail">' +
				`<div class="lobby-code"><small>${ bonusLobby() ? t( 'lobby.bonusCode' ) : t( 'lobby.code' ) }</small><b>${ escapeHtml( lobby.code ) }</b><button data-act="multi-copy">${ t( 'lobby.copy' ) }</button></div>` +
				`<ul class="lobby-players">${ lobby.players.map( playerRow ).join( '' ) }</ul>${lobby.state==='waiting'&&!yarisLobby()?'<button class="chip" data-act="multi-garage">Гараж</button>':''}` +
				`<p class="note">${ t( 'lobby.players', { n: lobby.players.length, max: MAX_PLAYERS } ) }</p>` +
				`<div class="row actions"><button data-act="multi-leave">${ t( 'lobby.leave' ) }</button></div>` +
				'</aside></div>',
			after: startCountdown,
		};

	}

	function stopCountdown() {

		clearInterval( tick );
		tick = null;

	}

	// Called by the menu after it drew the screen (it passes the screen object, not the DOM)
	function startCountdown() {

		stopCountdown();
		const el = document.querySelector( '#screen [data-deadline]' );
		if ( ! el ) return;

		const update = () => {

			const left = Math.max( 0, Math.ceil( ( Number( el.dataset.deadline ) - Date.now() ) / 1000 ) );
			el.textContent = `${ left } s`;

		};

		update();
		tick = setInterval( update, 250 );

	}

	// ─── Actions ───

	function act( name ) {

		if ( ! name.startsWith( 'multi-' ) ) return false;
		const [ action, a, b ] = name.split( ':' );
		message = '';

		if ( action === 'multi-solo' ) { stopBrowsing(); onYarisSolo(); return true; }
		else if ( action === 'multi-retry' ) client.retry();
		else if ( action === 'multi-new' ) Object.assign( browse, { creating: true, codeOpen: false } );
		else if ( action === 'multi-new-cancel' ) browse.creating = false;
		else if ( action === 'multi-vis' ) {

			browse.name = document.getElementById( 'lobby-name' )?.value ?? browse.name;
            browse.yaris=!!document.getElementById('lobby-yaris')?.checked;
			browse.visibility = a;

		}
		else if ( action === 'multi-create-go' ) {

			const name = ( document.getElementById( 'lobby-name' )?.value ?? browse.name ).trim() || t( 'multi.defaultName', { name: player.name } );
			browse.name = name;
			client.create( browse.mode, { visibility: browse.visibility, name, yaris:!!document.getElementById('lobby-yaris')?.checked } );

		}
		else if ( action === 'multi-code' ) Object.assign( browse, { codeOpen: true, creating: false } );
		else if ( action === 'multi-code-cancel' ) browse.codeOpen = false;
		else if ( action === 'multi-page' ) browse.page += Number( a );
		else if ( action === 'multi-test' ) {

			stopBrowsing();
			onTest();
			return true;

		}
		else if ( action === 'multi-join-code' ) client.join( a );
		else if ( action === 'multi-join' ) {

			typedCode = document.getElementById( 'lobby-code' )?.value || '';
			client.join( typedCode );

		}
		else if ( action === 'multi-copy' ) navigator.clipboard?.writeText( client.lobby.code ).catch( () => {} );
		else if(action==='multi-garage'){onGarage();return true;}
        else if ( action === 'multi-ready' ) client.setReady( { car: yarisLobby() ? YARIS_CAR : settings.car, color: yarisLobby() ? 1 : settings.color, ready: ! me()?.ready } );
		else if ( action === 'multi-vote-start' ) client.startVote();
		else if ( action === 'multi-leave' ) leave();
		else if ( action === 'multi-rejoin' ) {

			leaving = true;
			onRace( client.lobby.code );

		}
		else if ( action === 'multi-kick' ) client.kick( a );
		else if ( action === 'multi-vote' ) client.vote( b === undefined ? { kind: a } : { kind: a, id: b } );
		else if ( action === 'multi-set' ) {

			const next = { ...client.lobby.settings };
			if(a==='yaris') next.yaris=b==='1';
            else if ( a === 'collisions' ) next.collisions = b === '1';
			else if ( a === 'landscape' ) next.landscape = b;
			else if ( a === 'camera' ) next.camera = b;
			else next[ a ] = Number( b );
			client.setSettings( next );

		}

		onChange(); // redrawn for the new state (and the error cleared)
		return true;

	}

	function leave() {

		if ( client.lobby ) client.leave();
		else {

			client.close();
			onScreen = false;
			onLeaveLobby( '' );

		}

	}

	// Back on the menu after a race or a reload: reconnect to the lobby
	function resume() {

		if ( LobbyClient.wasInLobby() ) {

			log( 'this tab was in a lobby: reconnecting to find it again' );
			client.resume();

		}

	}

	return { screens: { multi: () => multiScreen(), experimental: () => multiScreen( 'bonus' ), yaris: () => multiScreen( 'yaris' ), beta:()=>multiScreen('beta'), lobby: lobbyScreen }, wall, act, leave, resume, stopBrowsing, syncCar, client };

}
