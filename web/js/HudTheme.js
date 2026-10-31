// The in-game look, the menu's (index.html): its colours, its two fonts
// ('brand' for the big words, 'text' = Figtree for the rest, js/menu/Fonts.js),
// orange for what matters. Over the race nothing sits on a panel: white
// letters with the soft dark drop shadow of the menu's wall titles; only the
// pause and the arrival (GameUI) are white cards, like the menu's. Every HUD
// module calls useHudTheme() before drawing anything; its CSS only uses these
// variables and classes, never its own fonts or colours.
// No import at load: the server's checks import RallyStage, which uses this.

const CSS = `
	:root {
		--track: -0.04em; /* letter-spacing of the 'text' font */
		--ink: #1f2430;
		--muted: #6b7185;
		--card: rgba(255, 255, 255, 0.95);
		--soft: #eef0f5;
		--soft-hover: #e2e6ef;
		--accent: #e8590c;
		--accent-hover: #d14c05;
		--accent-light: #ff8a3d;
		--radius: 20px;
		--shadow: 0 18px 50px rgba(20, 24, 36, 0.22);
		--shadow-small: 0 6px 18px rgba(0, 0, 0, 0.15);
		--lift: 0 2px 0 rgba(20, 24, 36, 0.3), 0 3px 16px rgba(20, 24, 36, 0.45); /* white letters over the picture */
		--text: 'text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		--brand: 'brand', 'text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}
	:root:lang(ja), :root:lang(zh), :root:lang(ko) { --track: 0; }
	body { font: 700 15px var(--text); letter-spacing: var(--track); color: var(--ink); }

	/* The whole interface follows the window's size (--hud, set by fitToWindow) */
	.hud-timer, .hud-toast, #controls-hint, #bonus-hud, #race-hud .board, #race-hud .pos, #race-hud .count, #race-hud .card, .ui-card, .ui-corner, .pad-toast { zoom: var(--hud, 1); }

	/* Letters straight on the picture */
	.hud-float { color: #fff; text-shadow: var(--lift); pointer-events: none; user-select: none; }
	/* Small capitals over a value */
	.hud-label { font-size: 11px; font-weight: 900; letter-spacing: 0.02em; text-transform: uppercase; opacity: 0.8; }
	/* The big numbers */
	.hud-num { font-weight: 900; font-style: italic; font-variant-numeric: tabular-nums; letter-spacing: var(--track); }
	/* A key to press: a white keycap */
	.hud-key { display: inline-block; min-width: 26px; padding: 3px 8px; border-radius: 8px; background: #fff; box-shadow: inset 0 -2px 0 #d5d9e3, 0 2px 8px rgba(20, 24, 36, 0.3); color: var(--ink); font: 900 13px var(--text); letter-spacing: 0; text-align: center; text-shadow: none; }
	/* Messages over the race (resets, start, accelerator) */
	.hud-toast { color: #fff; text-shadow: var(--lift); font: italic 900 28px var(--text); letter-spacing: var(--track); white-space: nowrap; }
	.hud-toast b { color: var(--accent-light); }
	/* Gamepad.js' toast: a white pill in the menu, letters over the race here */
	body .pad-toast { background: none; box-shadow: none; color: #fff; text-shadow: var(--lift); font-size: 18px; font-style: italic; font-weight: 900; }
	body .pad-toast b { color: var(--accent-light); }

	/* The clock, top left (LapTimer on circuits, RallyStage on stages) */
	.hud-timer { position: absolute; top: 26px; left: 30px; z-index: 10; }
	.hud-timer .head { font: 28px/1 var(--brand); color: var(--accent-light); text-transform: uppercase; letter-spacing: 0; }
	.hud-timer .time { font-size: 60px; line-height: 1; margin: 4px 0 12px -2px; }
	.hud-timer .rows { display: grid; grid-template-columns: auto auto auto; align-items: baseline; gap: 4px 14px; padding-left: 12px; border-left: 3px solid var(--accent-light); }
	.hud-timer .row { display: contents; }
	.hud-timer .row b { font-size: 19px; font-weight: 900; font-style: italic; font-variant-numeric: tabular-nums; }
	.hud-timer .row small { font-size: 12px; opacity: 0.8; }
	.hud-timer .bar { width: 230px; height: 5px; margin: 0 0 8px; border-radius: 3px; background: rgba(255, 255, 255, 0.35); box-shadow: 0 2px 10px rgba(20, 24, 36, 0.3); overflow: hidden; }
	.hud-timer .bar i { display: block; height: 100%; width: 0; background: var(--accent-light); border-radius: inherit; }
	.hud-timer .note { max-width: 260px; margin-top: 10px; font-size: 13px; font-style: italic; line-height: 1.35; }
	.hud-timer .note:empty { display: none; }
	.hud-timer [hidden] { display: none; }
`;

// Colours the scripts need (a lap flashing green or red, back to white)
export const HUD_TEXT = '#ffffff';
export const HUD_GOOD = '#69db7c';
export const HUD_BAD = '#ff6b6b';

// The interface's scale: 1 from a 1600 × 900 window up, smaller below, never
// under MIN_SCALE (a phone stays readable)
const FULL_SIZE = [ 1600, 900 ];
const MIN_SCALE = 0.55;

function fitToWindow() {

	const scale = Math.max( MIN_SCALE, Math.min( 1, innerWidth / FULL_SIZE[ 0 ], innerHeight / FULL_SIZE[ 1 ] ) );
	document.documentElement.style.setProperty( '--hud', scale.toFixed( 3 ) );

}

let installed = false;

export function useHudTheme() {

	if ( installed ) return;
	installed = true;
	const style = document.createElement( 'style' );
	style.textContent = CSS;
	document.head.prepend( style ); // first: the modules' own rules win
	fitToWindow();
	addEventListener( 'resize', fitToWindow );
	import( './menu/Fonts.js' ); // decrypts the fonts (the system ones stand in until then); never on the server, which imports RallyStage

}
