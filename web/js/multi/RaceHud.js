// On-screen parts of a multiplayer race: countdown, live standings on the
// left (middle of the screen), position and lap top right, name labels over
// the other cars, the waiting card after the finish and the podium. No panel:
// white letters over the picture (HudTheme). Text only through textContent
// (names come from other players).

import { t } from '../i18n.js';
import { formatTime } from '../Settings.js';
import { useHudTheme } from '../HudTheme.js';

// A title longer than this is a sentence (waiting, an error): the text font,
// not the big brand letters
const LONG = 14;

const CSS = `
	#race-hud { position: fixed; inset: 0; pointer-events: none; z-index: 20; }
	#race-hud .count { position: absolute; top: 34%; left: 50%; transform: translate(-50%, -50%); font: 150px/1 var(--brand); color: var(--accent-light); text-transform: uppercase; letter-spacing: 0; white-space: nowrap; text-shadow: 0 8px 0 rgba(20, 24, 36, 0.25), 0 10px 40px rgba(20, 24, 36, 0.45); }
	#race-hud .count.long { font: italic 900 44px/1.1 var(--text); color: #fff; text-transform: none; letter-spacing: var(--track); }
	#race-hud .pos { position: absolute; top: 26px; right: 30px; text-align: right; }
	@media (pointer: coarse) { #race-hud .pos { right: 84px; } } /* the pause button is there on touch screens */
	#race-hud .pos b { display: block; font-size: 60px; line-height: 1; }
	#race-hud .pos b small { font-size: 28px; opacity: 0.8; }
	#race-hud .pos span { font: 22px/1 var(--brand); color: var(--accent-light); text-transform: uppercase; letter-spacing: 0; }
	#race-hud .board { position: absolute; left: 30px; top: 50%; transform: translateY(-50%); margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
	#race-hud .board li { display: grid; grid-template-columns: 26px minmax(0, 180px) auto; align-items: baseline; gap: 10px; font-size: 17px; font-weight: 900; transition: transform 0.3s; }
	#race-hud .board li b { font-style: italic; font-variant-numeric: tabular-nums; text-align: right; opacity: 0.8; }
	#race-hud .board li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	#race-hud .board li em { font-size: 14px; font-style: italic; font-variant-numeric: tabular-nums; opacity: 0.85; }
	#race-hud .board li.me { color: var(--accent-light); font-size: 20px; }
	#race-hud .board li.me b { opacity: 1; }
	#race-hud .label { position: absolute; transform: translate(-50%, -100%); font-size: 13px; font-weight: 900; white-space: nowrap; }
	#race-hud .card { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); min-width: 340px; text-align: center; }
	#race-hud .card h2 { margin: 0 0 8px; font: 64px/1 var(--brand); color: var(--accent-light); text-transform: uppercase; letter-spacing: 0; }
	#race-hud .card h2.long { font: italic 900 34px/1.15 var(--text); color: #fff; text-transform: none; letter-spacing: var(--track); }
	#race-hud .card .sub { font-size: 18px; }
	#race-hud .card ol { list-style: none; margin: 18px auto 0; padding: 0; display: inline-flex; flex-direction: column; gap: 6px; text-align: left; }
	#race-hud .card li { display: grid; grid-template-columns: 30px minmax(140px, 1fr) auto; align-items: baseline; gap: 12px; font-size: 20px; font-weight: 900; }
	#race-hud .card li em { font-style: italic; font-variant-numeric: tabular-nums; }
`;

function el( tag, className, parent ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( parent ) parent.appendChild( node );
	return node;

}

export class RaceHud {

	constructor( { laps } ) {

		useHudTheme();
		const style = el( 'style' );
		style.textContent = CSS;
		document.head.appendChild( style );

		this.root = el( 'div', '', document.body );
		this.root.id = 'race-hud';
		this.count = el( 'div', 'count', this.root );
		this.board = el( 'ol', 'board hud-float', this.root );
		this.pos = el( 'div', 'pos hud-float', this.root );
		this.posRank = el( 'b', 'hud-num', this.pos );
		this.posLap = el( 'span', '', this.pos );
		this.card = el( 'div', 'card hud-float', this.root );
		this.card.hidden = true;
		this.shownBoard = '';
		this.laps = laps;
		this.shown = { count: null, rank: null, lap: null };

	}

	label( name ) {

		const node = el( 'div', 'label hud-float', this.root );
		node.textContent = name;
		node.hidden = true;
		return node;

	}

	setCountdown( text ) {

		if ( this.shown.count === text ) return;
		this.shown.count = text;
		this.count.textContent = text;
		this.count.classList.toggle( 'long', text.length > LONG );
		this.count.hidden = text === '';

	}

	setPosition( rank, total, lap ) {

		const r = `${ rank } / ${ total }`;
		if ( this.shown.rank !== r ) {

			this.shown.rank = r;
			const of = el( 'small' );
			of.textContent = ` / ${ total }`;
			this.posRank.replaceChildren( String( rank ), of );

		}
		const l = this.laps ? t( 'race.lap', { lap: Math.min( lap, this.laps ), laps: this.laps } ) : '';
		if ( this.shown.lap !== l ) this.posLap.textContent = this.shown.lap = l;

	}

	// The live order: [ { name, me, time } ] first to last (time once finished)
	setBoard( rows ) {

		const key = rows.map( ( r ) => r.name + ( r.me ? '*' : '' ) + ( r.time ?? '' ) ).join( '|' );
		if ( key === this.shownBoard ) return;
		this.shownBoard = key;
		this.board.replaceChildren( ...rows.map( ( r, i ) => {

			const li = el( 'li', r.me ? 'me' : '' );
			el( 'b', '', li ).textContent = i + 1;
			el( 'span', '', li ).textContent = r.name;
			el( 'em', '', li ).textContent = r.time === null ? '' : formatTime( r.time );
			return li;

		} ) );

	}

	hideCard() {

		this.card.hidden = true;

	}

	showCard( title, sub, rows = [] ) {

		this.card.replaceChildren();
		const h2 = el( 'h2', title.length > LONG ? 'long' : '', this.card );
		h2.textContent = title;
		el( 'div', 'sub', this.card ).textContent = sub;
		if ( rows.length ) {

			const list = el( 'ol', '', this.card );
			rows.forEach( ( [ place, name, time ] ) => {

				const li = el( 'li', '', list );
				el( 'b', '', li ).textContent = place;
				el( 'span', '', li ).textContent = name;
				el( 'em', '', li ).textContent = time;

			} );

		}

		this.card.hidden = false;

	}

}
