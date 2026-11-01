import * as THREE from 'three';
import { gsap } from '../vendor/gsap.js';
import { addFoldCenters, foldMaterial, setFoldMode, FOLD_OBJECT } from './Fold.js';
import { thumbURL } from './Thumbs.js';
import { fontsReady } from './Fonts.js';
import { t, lang } from '../i18n.js';

// The home screen's choices written in the scene: big italic titles on two
// walls of air on either side of the car, seen from the side, running away
// towards the middle of the screen (left wall: from the left edge inwards,
// right wall: from the middle out to the right edge). They fold away with
// the set (their own fold channel: the settings screen folds them alone).
//
// Each item is a subdivided plane (so it folds triangle by triangle) with
// its picture drawn on a canvas; a transparent button sits exactly on its
// projection (clip-path), so the mouse, the keyboard focus and the gamepad
// (Gamepad.js picks visible buttons) work as with any other menu button.
// Three kinds:
//   - title: a big title; the line under it only shows while it is hovered,
//     its letters rising one after the other out of a clip at the line's
//     foot (`reveal` tweened by GSAP, the canvas redrawn on each update)
//   - account: the player's card (avatar, name, a line)
//   - icon: an animated icon (editor, settings, music), its name rising at
//     its foot on hover. Items sharing a `row` stand side by side.
//   - tab: a bento tile with a label (a tab, a choice; `on`: dark, the one
//     chosen; `accent`: orange, the go button; `off`: greyed, not a button)
//   - thumb: a tile with a picture (a circuit's drawing, `thumb` = the key
//     walls.thumbs( key ) turns into an SVG; or `cover`: an image's URL,
//     filling the picture) over a name and a line; hovered, `hoverSub` rises
//     in place of the line (records); `on`: outlined, the one chosen
//   - photo: a picture (`cover` URL) in a thin white frame, its name over it
//     at the bottom left; hovered, it leans in and an orange outline draws
//     in; `on`: outlined (the chosen one)
//   - row: a wide tile, a dark badge (`badge`: a short text, the players
//     in a lobby) then a name and a line (`open`: the line green); `off`:
//     greyed, not a button; `still`: drawn as usual, not a button (the
//     circuit leaderboard); `accent`: the badge orange; `aside`: a short
//     text on the right (a lap time); `blank`: nothing drawn (a slot kept
//     for later, `patch`)
// Any item may carry `angle` (degrees): its whole side turned that much
// from the screen instead of ANGLE (the circuit leaderboard faces the camera more)
// Any item may carry `grow`: its whole side that much bigger (the home's right wall)
//   - caption: a small heading over a row (no tile, not a button)
//   - video: a big tile with a looping clip playing in it and its title over
//     it (Solo's Circuit / Spéciale); hovered, an orange outline draws in,
//     the clip leans closer and the line under the title rises
// The account and the icons are white bento tiles, each corner pulled in a
// little (never quite square), the icons' row exactly as wide as the card.
// Only the left wall's titles slide out when hovered.

const ANGLE = THREE.MathUtils.degToRad( 70 ); // between a wall and the screen plane
const DEPTH = 2.4; // m from the camera to the near end of the titles
const EDGE = 0.9; // share of the half screen width where the near end sits
const PX = 1024; // canvas pixels per metre (sharp up close, mipmaps further off)
const INK = '#ffffff', ACCENT = '#ff6a1a'; // light on the scrim (Showroom: the screen's sides shaded)
const PAPER = 'rgba(255, 255, 255, 0.95)', DARK = '#1f2430', MUTED = '#6b7185', GRASS = '#cfe8d6'; // the account card and the icons (index.html --card, --ink, --muted)
const FONT = "'text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"; // the lines under the titles (Fonts.js)
const SUB_GAP = 1.05; // the line's baseline under the title's, in line sizes
const TRACK = /^(ja|zh|ko)$/.test( lang ) ? 0 : - 0.04; // letter-spacing of the lines, em (index.html --track; none for CJK, whose characters would touch)
const TITLE_FONT = "'brand', sans-serif"; // Fonts.js
const STAGGER = 0.06; // of the reveal between two letters of the line under a title
const PAD = 0.018; // m around a tile (room for its shadow): two of them between two tiles
const CARD = { h: 0.12, avatar: 0.08, name: 0.044, small: 0.03, inset: 0.02, gap: 0.022 }; // m
const ICON = { h: 0.13, w: 0.11, label: 0.028 }; // m (w: the narrowest)
const RIGHT_SCALE = 1.1; // the right wall (Garage, the account, the tiles) a bit bigger
const VIDEO = { title: 0.13, sub: 0.034, inset: 0.05 }; // m: a clip tile's title, its line, from the edges
const BENTO = { radius: 0.02, skew: 0.005, gap: 0.008 }; // m: corner rounding, how far a corner may be pulled in, between two tiles

let fontsLoaded = false; // Fonts.js: added to the page (decrypted) a moment after the start
fontsReady.then( () => { fontsLoaded = true; } );

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();

export class Walls {

	// layer: the DOM element holding the hotspot buttons; channel: Fold.js
	constructor( layer, channel ) {

		this.layer = layer;
		this.channel = channel;
		this.group = new THREE.Group();
		this.group.name = 'walls';
		this.items = [];
		this.shown = false;
		this.live = { music: true, kick: 0, season: null }; // what the music and season icons show (setLive)
		this.onHover = null; // ( spec, hot ): an item lit or put out (mouse, keyboard focus)
		this.layer.addEventListener( 'pointerover', ( e ) => this.hover( e, true ) );
		this.layer.addEventListener( 'pointerout', ( e ) => this.hover( e, false ) );
		this.layer.addEventListener( 'focusin', ( e ) => this.hover( e, true ) );
		this.layer.addEventListener( 'focusout', ( e ) => this.hover( e, false ) );

	}

	// items: [ { side: 'left' | 'right', kind: 'title' (default) | 'account' | 'icon' | 'video', title, sub, data: { go | act },
	//   title: size (m of title height), accent; account: initial; icon: icon ('editor' | 'settings' | 'music'), row;
	//   video: src, w, h (m) } ]
	// morph: an update of the same screen: a tile whose content changed in
	// place (same kind, size, side) fades from its old picture to the new one
	setItems( items, morph = false ) {

		const key = JSON.stringify( items );
		if ( key === this.key ) return;
		this.key = key;
		this.specs = items;

		// Drawn (and measured) once the fonts are there: again when they arrive
		if ( ! fontsLoaded ) fontsReady.then( () => {

			if ( this.specs !== items ) return;
			this.key = null;
			this.setItems( items );
			this.show( this.shown );

		} );

		const old = this.items.map( ( it ) => ( { kind: it.kind, w: it.w, h: it.h, side: it.spec.side, json: JSON.stringify( it.spec ), canvas: it.canvas } ) );
		for ( const it of this.items ) {

			this.group.remove( it.mesh );
			it.mesh.geometry.dispose();
			it.mesh.material.map.dispose();
			it.mesh.material.dispose();
			it.button.remove();
			it.starButton?.remove();
			gsap.killTweensOf( it );
			if ( it.video ) {

				const video = it.video;
				it.video = null; // its frame callbacks stop
				video.pause();
				video.removeAttribute( 'src' );
				video.load(); // let the browser drop it

			}

		}

		this.fitBento( items );
		// Items not there before (a same-screen update: the theme picker) pop in
		const before = new Set( ( this.lastSpecs || [] ).map( ( spec ) => JSON.stringify( spec ) ) );
		const popIn = this.lastSpecs && this.lastSpecs.length > 0;
		this.lastSpecs = items.map( ( spec ) => ( { ...spec } ) );
		this.items = items.map( ( spec, i ) => this.makeItem( spec, i ) );
		if ( popIn ) for ( const it of this.items ) if ( ! before.has( JSON.stringify( it.spec ) ) && it.spec.pop ) {

			it.appear = 0;
			gsap.to( it, { appear: 1, duration: 0.5, delay: it.spec.pop * 0.06, ease: 'back.out(1.7)' } );

		}

		if ( morph ) this.items.forEach( ( it, i ) => {

			const o = old[ i ];
			if ( ! o || o.kind !== it.kind || o.side !== it.spec.side || Math.abs( o.w - it.w ) > 1e-6 || Math.abs( o.h - it.h ) > 1e-6 || o.json === JSON.stringify( it.spec ) ) return;
			it.prev = o.canvas;
			it.morph = 0;
			gsap.to( it, { morph: 1, duration: 0.45, ease: 'power2.out', onUpdate: () => this.draw( it ), onComplete: () => {

				it.prev = null;
				this.draw( it );

			} } );
			this.draw( it );

		} );

		this.placed = null;

	}

	// The account card's width and the icons' (px): the tiles as wide as the
	// letters of the title above them (Garage), the row of icons as wide as
	// the card, the card widened if the icons can't shrink that far
	fitBento( items ) {

		const ctx = document.createElement( 'canvas' ).getContext( '2d' );
		const card = items.find( ( s ) => s.kind === 'account' );
		const icons = items.filter( ( s ) => s.kind === 'icon' ).length;
		const pad = Math.round( PAD * PX ), gap = Math.round( BENTO.gap * PX );
		let cardW = card ? cardBox( ctx, card ).w : 0;
		const head = card && items.slice( 0, items.indexOf( card ) ).reverse().find( ( s ) => ( s.kind || 'title' ) === 'title' && s.side === card.side );
		if ( head ) cardW = Math.max( cardW, Math.round( titleInk( ctx, head ).width ) );
		let tileW = Math.round( ICON.w * PX );
		if ( icons ) {

			tileW = Math.max( tileW, Math.floor( ( cardW - gap * ( icons - 1 ) ) / icons ) );
			cardW = Math.max( cardW, tileW * icons + gap * ( icons - 1 ) );

		}

		this.bento = { cardW, tileW, pad };

	}

	// The music icon: on or off, and the beat (0..1) its bars dance to; the
	// season icon: the home's season (a new one: the icon pops)
	setLive( { music, kick, season } ) {

		this.live.music = music;
		this.live.kick = kick;
		const it = this.items.find( ( i ) => i.spec.icon === 'music' );
		if ( it ) it.button.setAttribute( 'aria-pressed', music );

		if ( season && season !== this.live.season ) {

			const pop = this.live.season && this.items.find( ( i ) => i.spec.icon === 'season' );
			this.live.season = season;
			if ( pop ) gsap.fromTo( pop, { pop: 0 }, { pop: 1, duration: 0.6, ease: 'power2.out' } );
			const label = SEASON_LABELS[ season ];
			for ( const i of this.items ) if ( i.spec.icon === 'season' ) i.button.setAttribute( 'aria-label', t( 'home.seasonAria', { season: label } ) );

		}

	}

	makeItem( spec, index ) {

		const canvas = document.createElement( 'canvas' );
		const ctx = canvas.getContext( '2d' );
		const item = { spec, canvas, ctx, hover: 0, hot: false, reveal: 0, bar: 0, spin: 0, corners: '' };
		const kind = spec.kind || 'title';

		if ( kind === 'title' ) {

			const size = spec.size || 0.32;
			const titlePx = Math.round( size * PX );
			const subPx = Math.round( titlePx * ( spec.size > 0.2 ? 0.2 : 0.3 ) );
			ctx.font = `${ titlePx }px ${ TITLE_FONT }`;
			const titleW = ctx.measureText( spec.title.toUpperCase() ).width;
			ctx.font = `800 ${ subPx }px ${ FONT }`;
			const subW = spec.sub ? ctx.measureText( spec.sub ).width + TRACK * subPx * [ ...spec.sub ].length : 0;
			const pad = Math.round( titlePx * 0.18 );
			canvas.width = Math.ceil( Math.max( titleW + titlePx * 0.2, subW ) + pad * 2 );
			const lay = titleLayout( spec, titlePx, subPx, pad );
			canvas.height = Math.ceil( lay.height );
			// Where its letters end (px from the canvas' near edge) and where the
			// hover bar's foot is: the tiles under it line up on those
			const ink = titleInk( ctx, spec );
			Object.assign( item, { titlePx, subPx, pad, lay, inkEdge: ink.edge, slack: canvas.height - lay.foot } );

		} else if ( kind === 'account' ) {

			const box = cardBox( ctx, spec );
			const { pad, cardW } = this.bento;
			box.w = Math.max( box.w, cardW );
			canvas.width = box.w + pad * 2;
			canvas.height = box.h + pad * 2;
			Object.assign( item, { box, pad } );

		} else if ( kind === 'tab' || kind === 'thumb' || kind === 'caption' || kind === 'photo' || kind === 'row' ) {

			const pad = Math.round( PAD * PX );
			const box = { w: Math.round( spec.w * PX ), h: Math.round( spec.h * PX ) };
			canvas.width = box.w + pad * 2;
			canvas.height = box.h + pad * 2;
			Object.assign( item, { box, pad } );
			if ( ( kind === 'thumb' || kind === 'photo' ) && spec.cover ) {

				const image = new Image();
				image.onload = () => {

					item.image = image;
					if ( this.items.includes( item ) ) this.draw( item );

				};
				image.src = spec.cover;

			} else if ( kind === 'thumb' && spec.thumb && this.thumbs ) Promise.resolve( this.thumbs( spec.thumb ) ).then( ( svg ) => {

				if ( ! svg ) return;
				const image = new Image();
				image.onload = () => {

					item.image = image;
					if ( this.items.includes( item ) ) this.draw( item );

				};
				image.src = thumbURL( svg );

			} );

		} else if ( kind === 'video' ) {

			const pad = Math.round( PAD * PX );
			const box = { w: Math.round( spec.w * PX ), h: Math.round( spec.h * PX ), title: Math.round( VIDEO.title * PX ), sub: Math.round( VIDEO.sub * PX ), inset: Math.round( VIDEO.inset * PX ) };
			canvas.width = box.w + pad * 2;
			canvas.height = box.h + pad * 2;
			const video = spec.src ? document.createElement( 'video' ) : null;
			if ( video ) {
				Object.assign( video, { src: spec.src, muted: true, loop: true, playsInline: true, preload: 'auto' } );
				video.setAttribute( 'muted', '' );
			}
			Object.assign( item, { box, pad, video, fresh: true } );
			if ( spec.cover ) {
				const image = new Image();
				image.onload = () => { item.image = image; if ( this.items.includes( item ) ) this.draw( item ); };
				image.src = spec.cover;
			}
			// Drawn again only for a new frame of the clip (30 a second, not every render)
			if ( video?.requestVideoFrameCallback ) {

				const next = () => {

					item.fresh = true;
					if ( item.video ) video.requestVideoFrameCallback( next );

				};
				video.requestVideoFrameCallback( next );

			} else if ( video ) item.everyFrame = true;

		} else {

			const { pad, tileW } = this.bento;
			const box = { w: tileW, h: Math.round( ICON.h * PX ), label: Math.round( ICON.label * PX ) };
			canvas.width = box.w + pad * 2;
			canvas.height = box.h + pad * 2;
			Object.assign( item, { box, pad } );

		}

		item.skew = skew( index, Math.round( BENTO.skew * PX ) );

		const texture = new THREE.CanvasTexture( canvas );
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.anisotropy = 8;

		const w = canvas.width / PX, h = canvas.height / PX;
		const geometry = addFoldCenters( new THREE.PlaneGeometry( w, h, Math.max( 8, Math.round( w * 14 ) ), Math.max( 3, Math.round( h * 14 ) ) ) );
		setFoldMode( geometry, FOLD_OBJECT ); // shrinks onto its middle
		const material = foldMaterial( new THREE.MeshBasicMaterial( { map: texture, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false, side: THREE.DoubleSide } ), this.channel );
		const mesh = new THREE.Mesh( geometry, material );
		mesh.renderOrder = 10; // over everything: never behind the car
		mesh.userData.folded = true;
		this.group.add( mesh );

		const button = document.createElement( 'button' );
		button.className = 'hotspot';
		if ( kind === 'caption' || spec.off || spec.still ) button.disabled = true;
		button.setAttribute( 'aria-label', spec.sub ? `${ spec.title } — ${ spec.sub }` : spec.title );
		for ( const [ k, v ] of Object.entries( spec.data ) ) button.dataset[ k ] = v;
		button.dataset.wall = index;
		this.layer.appendChild( button );

		// A circuit can be starred: a small button over the badge drawn in its
		// corner (drawThumb sets item.starRect), on top of the tile's own button
		let starButton = null;
		if ( kind === 'thumb' && spec.starId ) {

			starButton = document.createElement( 'button' );
			starButton.className = 'hotspot star-hotspot';
			starButton.setAttribute( 'aria-label', t( 'circuits.starAria' ) );
			starButton.dataset.act = 'star:' + spec.starId;
			starButton.dataset.wall = index;
			this.layer.appendChild( starButton );

		}

		Object.assign( item, { kind, texture, mesh, button, starButton, w, h } );
		this.draw( item );
		return item;

	}

	draw( item ) {

		const { canvas, ctx } = item;
		ctx.clearRect( 0, 0, canvas.width, canvas.height );
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		ctx.shadowColor = 'transparent'; // the context keeps the last draw's state
		if ( item.kind === 'account' ) this.drawAccount( item );
		else if ( item.kind === 'icon' ) this.drawIcon( item );
		else if ( item.kind === 'video' ) this.drawVideo( item );
		else if ( item.kind === 'tab' ) this.drawTab( item );
		else if ( item.kind === 'thumb' ) this.drawThumb( item );
		else if ( item.kind === 'caption' ) this.drawCaption( item );
		else if ( item.kind === 'photo' ) this.drawPhoto( item );
		else if ( item.kind === 'row' ) this.drawRow( item );
		else this.drawTitle( item );
		// Changed in place: the old picture fading away over the new one
		if ( item.prev && item.morph < 1 ) {

			ctx.shadowColor = 'transparent';
			ctx.globalAlpha = 1 - item.morph;
			ctx.drawImage( item.prev, 0, 0 );
			ctx.globalAlpha = 1;

		}

		item.texture.needsUpdate = true;

	}

	// The title, its line under it as far as revealed, and the hover bar
	drawTitle( item ) {

		const { spec, canvas, ctx, titlePx, subPx, pad } = item;
		const right = spec.side === 'right';
		const x = right ? canvas.width - pad : pad;

		ctx.font = `${ titlePx }px ${ TITLE_FONT }`;
		shade( ctx, titlePx );
		ctx.fillStyle = item.hot || spec.accent ? ACCENT : INK;
		const { base, line, barY, barH } = item.lay;
		const title = spec.title.toUpperCase();
		ctx.fillText( title, right ? x - ctx.measureText( title ).width : x, base );

		if ( spec.sub && item.reveal > 0 ) {

			ctx.font = `800 ${ subPx }px ${ FONT }`;
			ctx.fillStyle = ACCENT;
			rise( ctx, spec.sub, x, line, subPx, item.reveal, right ? 'right' : 'left' );

		}

		// The hovered title's bar, growing from the title's start
		if ( item.bar > 0 ) {

			ctx.fillStyle = ACCENT;
			const barW = Math.min( canvas.width - pad * 2, titlePx * 1.6 ) * item.bar;
			ctx.fillRect( right ? x - barW : x, barY, barW, barH );

		}

	}

	// A white tile: the avatar (orange when hovered), the name, a line; an
	// orange outline drawn in on hover
	drawAccount( item ) {

		const { spec, ctx, box, pad } = item;
		const x0 = pad, cy = pad + box.h / 2;
		const radius = BENTO.radius * PX;

		ctx.save();
		shade( ctx, box.h * 0.9 );
		ctx.fillStyle = PAPER;
		bento( ctx, x0, pad, box.w, box.h, radius, item.skew );
		ctx.fill();
		ctx.restore();

		if ( item.bar > 0 ) {

			const lw = box.h * 0.045;
			ctx.strokeStyle = ACCENT;
			ctx.lineWidth = lw;
			const length = bento( ctx, x0 + lw / 2, pad + lw / 2, box.w - lw, box.h - lw, radius - lw / 2, item.skew );
			ctx.setLineDash( [ length * item.bar, length ] );
			ctx.stroke();
			ctx.setLineDash( [] );

		}

		const ax = x0 + box.inset + box.avatar / 2;
		ctx.fillStyle = item.hot ? ACCENT : DARK;
		ctx.beginPath();
		ctx.roundRect( ax - box.avatar / 2, cy - box.avatar / 2, box.avatar, box.avatar, box.avatar * 0.22 );
		ctx.fill();
		ctx.fillStyle = '#fff';
		ctx.font = `900 ${ Math.round( box.avatar * 0.46 ) }px ${ FONT }`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText( spec.initial || '', ax, cy + box.avatar * 0.03 );
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';

		const tx = x0 + box.inset + box.avatar + box.gap;
		ctx.letterSpacing = `${ TRACK * box.name }px`;
		ctx.font = `900 ${ box.name }px ${ FONT }`;
		ctx.fillStyle = DARK;
		ctx.fillText( spec.title, tx, cy - box.small * 0.12 );
		if ( spec.sub ) {

			ctx.letterSpacing = `${ TRACK * box.small }px`;
			ctx.font = `700 ${ box.small }px ${ FONT }`;
			ctx.fillStyle = MUTED;
			ctx.fillText( spec.sub, tx, cy + box.small * 1.05 );

		}

		ctx.letterSpacing = '0px';

	}

	// A white tile, orange rising from its foot on hover, the icon on it
	// (lifted on hover), its name rising at the tile's foot
	drawIcon( item ) {

		const { spec, ctx, box, pad } = item;
		const radius = BENTO.radius * PX;
		const tile = Math.min( box.w, box.h ) * 0.9; // the icon's drawing scale
		const cx = pad + box.w / 2, cy = pad + box.h * 0.5 - item.reveal * box.h * 0.1;

		ctx.save();
		shade( ctx, box.h * 0.8 );
		ctx.fillStyle = PAPER;
		bento( ctx, pad, pad, box.w, box.h, radius, item.skew );
		ctx.fill();
		ctx.restore();

		if ( item.bar > 0 ) {

			ctx.save();
			bento( ctx, pad, pad, box.w, box.h, radius, item.skew );
			ctx.clip();
			ctx.fillStyle = ACCENT;
			ctx.fillRect( 0, pad + box.h * ( 1 - item.bar ), box.w + pad * 2, box.h * item.bar + pad );
			ctx.restore();

		}

		const ink = item.bar > 0.55 ? '#fff' : DARK;
		ctx.fillStyle = ink;
		ctx.strokeStyle = ink;
		if ( spec.icon === 'settings' ) gear( ctx, cx, cy, tile * 0.3, item.spin );
		else if ( spec.icon === 'editor' ) pencil( ctx, cx, cy, tile, item.bar );
		else if ( spec.icon === 'music' ) {

			if ( ! this.live.music && item.bar <= 0.55 ) ctx.fillStyle = MUTED;
			equalizer( ctx, cx, cy, tile, this.live.music ? this.live.kick : - 1, item.spin );

		} else if ( spec.icon === 'season' ) {

			// A new season: the icon shrinks and turns into the next one
			const pop = Math.sin( ( item.pop || 0 ) * Math.PI );
			ctx.save();
			ctx.translate( cx, cy );
			ctx.rotate( ( item.pop || 0 ) * Math.PI * 0.5 );
			ctx.scale( 1 - pop * 0.4, 1 - pop * 0.4 );
			seasonIcon( ctx, this.live.season || 'summer', tile, item.spin, ink );
			ctx.restore();

		}

		if ( item.reveal > 0 ) {

			const label = spec.icon === 'music' && ! this.live.music ? t( 'home.soundOff', { title: spec.title } ) : spec.icon === 'season' ? SEASON_LABELS[ this.live.season ] || spec.title : spec.title;
			// Smaller if it would run out of the tile
			const px = Math.min( box.label, Math.floor( box.label * box.w * 0.86 / textWidth( ctx, `800 ${ box.label }px ${ FONT }`, label, box.label ) ) );
			ctx.font = `800 ${ px }px ${ FONT }`;
			ctx.fillStyle = ink;
			rise( ctx, label, cx, pad + box.h - box.label * 0.6, px, item.reveal, 'center' );

		}

	}

	// A label on a tile: white, dark (chosen) or orange (go); hovered, orange
	// rises from its foot
	drawTab( item ) {

		const { spec, ctx, box, pad } = item;
		const radius = BENTO.radius * PX * 0.8;
		const base = spec.accent ? ACCENT : spec.on ? DARK : PAPER;
		ctx.save();
		shade( ctx, box.h * 0.5 );
		ctx.fillStyle = base;
		ctx.globalAlpha = spec.off ? 0.55 : 1;
		bento( ctx, pad, pad, box.w, box.h, radius, item.skew );
		ctx.fill();
		ctx.restore();

		if ( item.bar > 0 && ! spec.off ) {

			ctx.save();
			bento( ctx, pad, pad, box.w, box.h, radius, item.skew );
			ctx.clip();
			ctx.fillStyle = spec.accent ? DARK : ACCENT;
			ctx.fillRect( 0, pad + box.h * ( 1 - item.bar ), box.w + pad * 2, box.h * item.bar + pad );
			ctx.restore();

		}

		const light = spec.accent || spec.on || item.bar > 0.55;
		const px = fitText( ctx, spec.title, Math.round( box.h * ( spec.big ? 0.4 : 0.36 ) ), box.w * 0.84, spec.big ? 900 : 800 );
		ctx.font = `${ spec.big ? 900 : 800 } ${ px }px ${ FONT }`;
		ctx.letterSpacing = `${ TRACK * px }px`;
		ctx.fillStyle = spec.off ? MUTED : light ? '#fff' : DARK;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText( spec.title, pad + box.w / 2, pad + box.h / 2 + px * 0.05 );
		ctx.letterSpacing = '0px';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';

	}

	// A picture over a name and a line; hovered: an orange outline drawn in,
	// the name orange, the line replaced by hoverSub rising
	drawThumb( item ) {

		const { spec, ctx, box, pad } = item;
		const radius = BENTO.radius * PX;
		const text = Math.round( box.h * 0.3 ); // the strip under the picture
		ctx.save();
		shade( ctx, box.h * 0.4 );
		ctx.fillStyle = PAPER;
		bento( ctx, pad, pad, box.w, box.h, radius, item.skew );
		ctx.fill();
		ctx.restore();

		// The picture, on the grass colour, inset in the tile
		const inset = Math.round( box.h * 0.045 );
		const px0 = pad + inset, py0 = pad + inset, pw = box.w - inset * 2, ph = box.h - text - inset;
		ctx.save();
		ctx.beginPath();
		ctx.roundRect( px0, py0, pw, ph, radius * 0.6 );
		ctx.clip();
		ctx.fillStyle = spec.plus ? '#eef0f4' : GRASS;
		ctx.fillRect( px0, py0, pw, ph );
		if ( item.image && spec.cover ) {

			// A photo: fills the picture, leaning in a little when hovered
			const k = Math.max( pw / item.image.width, ph / item.image.height ) * ( 1 + item.bar * 0.05 );
			const w = item.image.width * k, h = item.image.height * k;
			ctx.drawImage( item.image, px0 + ( pw - w ) / 2, py0 + ( ph - h ) / 2, w, h );

		} else if ( item.image ) {

			const k = Math.min( pw / item.image.width, ph / item.image.height ) * 0.92;
			const w = item.image.width * k, h = item.image.height * k;
			ctx.drawImage( item.image, px0 + ( pw - w ) / 2, py0 + ( ph - h ) / 2, w, h );

		}

		if ( spec.plus ) {

			ctx.fillStyle = MUTED;
			ctx.font = `300 ${ Math.round( ph * 0.6 ) }px ${ FONT }`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText( '+', px0 + pw / 2, py0 + ph / 2 );
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';

		}

		// Stars: a badge over the picture's corner, always visible (not just on
		// hover like hoverSub) so a well-rated circuit stands out at a glance,
		// and clickable (its own button, Walls.makeItem / update) to star it
		if ( spec.starId ) {

			const label = `★ ${ spec.stars ?? 0 }`;
			const bh = Math.round( ph * 0.17 );
			ctx.font = `800 ${ Math.round( bh * 0.6 ) }px ${ FONT }`;
			const bw = ctx.measureText( label ).width + bh * 0.8;
			const bx = px0 + pw - bw - bh * 0.3, by = py0 + bh * 0.3;
			item.starRect = { x: bx, y: by, w: bw, h: bh };
			ctx.fillStyle = spec.starred ? ACCENT : 'rgba(10, 10, 16, 0.6)';
			ctx.beginPath();
			ctx.roundRect( bx, by, bw, bh, bh / 2 );
			ctx.fill();
			ctx.fillStyle = spec.starred ? DARK : '#ffd35c';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText( label, bx + bw / 2, by + bh / 2 + 1 );
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';

		}

		ctx.restore();

		const x = pad + inset * 1.6;
		const namePx = fitText( ctx, spec.title, Math.round( text * 0.36 ), box.w - inset * 3.2, 900 );
		ctx.font = `900 ${ namePx }px ${ FONT }`;
		ctx.letterSpacing = `${ TRACK * namePx }px`;
		ctx.fillStyle = item.hot ? ACCENT : DARK;
		const nameBase = pad + box.h - text + text * 0.45;
		ctx.fillText( spec.title, x, nameBase );

		const subPx = Math.round( text * 0.27 );
		const subBase = nameBase + text * 0.36;
		ctx.letterSpacing = `${ TRACK * subPx }px`;
		if ( spec.sub && item.reveal < 1 ) {

			ctx.globalAlpha = 1 - item.reveal;
			ctx.font = `700 ${ fitText( ctx, spec.sub, subPx, box.w - inset * 3.2, 700 ) }px ${ FONT }`;
			ctx.fillStyle = MUTED;
			ctx.fillText( spec.sub, x, subBase );
			ctx.globalAlpha = 1;

		}

		if ( spec.hoverSub && item.reveal > 0 ) {

			const hp = fitText( ctx, spec.hoverSub, subPx, box.w - inset * 3.2, 800 );
			ctx.font = `800 ${ hp }px ${ FONT }`;
			ctx.fillStyle = ACCENT;
			rise( ctx, spec.hoverSub, x, subBase, hp, item.reveal, 'left' );

		}

		ctx.letterSpacing = '0px';

		const ring = spec.on ? 1 : item.bar;
		if ( ring > 0 ) {

			const lw = box.h * 0.025;
			ctx.strokeStyle = ACCENT;
			ctx.lineWidth = lw;
			const length = bento( ctx, pad + lw / 2, pad + lw / 2, box.w - lw, box.h - lw, radius - lw / 2, item.skew );
			ctx.setLineDash( [ length * ring, length ] );
			ctx.stroke();
			ctx.setLineDash( [] );

		}

	}

	// A picture in a thin white frame, its name over it (bottom left)
	drawPhoto( item ) {

		const { spec, ctx, box, pad } = item;
		const radius = BENTO.radius * PX;
		ctx.save();
		shade( ctx, box.h * 0.4 );
		ctx.fillStyle = PAPER;
		bento( ctx, pad, pad, box.w, box.h, radius, item.skew );
		ctx.fill();
		ctx.restore();

		const frame = Math.max( 6, Math.round( box.h * 0.035 ) );
		const x0 = pad + frame, y0 = pad + frame, w0 = box.w - frame * 2, h0 = box.h - frame * 2;
		ctx.save();
		ctx.beginPath();
		ctx.roundRect( x0, y0, w0, h0, radius * 0.6 );
		ctx.clip();
		ctx.fillStyle = DARK;
		ctx.fillRect( x0, y0, w0, h0 );
		if ( item.image ) {

			const k = Math.max( w0 / item.image.width, h0 / item.image.height ) * ( 1 + item.bar * 0.05 );
			const w = item.image.width * k, h = item.image.height * k;
			ctx.drawImage( item.image, x0 + ( w0 - w ) / 2, y0 + ( h0 - h ) / 2, w, h );

		}

		const g = ctx.createLinearGradient( 0, y0 + h0 * 0.45, 0, y0 + h0 );
		g.addColorStop( 0, 'rgba(8, 10, 16, 0)' );
		g.addColorStop( 1, 'rgba(8, 10, 16, 0.6)' );
		ctx.fillStyle = g;
		ctx.fillRect( x0, y0, w0, h0 );
		ctx.restore();

		const px = fitTitle( ctx, spec.title.toUpperCase(), Math.round( h0 * ( spec.titleSize || 0.2 ) ), w0 * 0.86 );
		ctx.font = `${ px }px ${ TITLE_FONT }`;
		shade( ctx, px );
		ctx.fillStyle = item.hot ? ACCENT : INK;
		ctx.fillText( spec.title.toUpperCase(), x0 + h0 * 0.07, y0 + h0 - h0 * 0.08 );
		ctx.shadowColor = 'transparent';

		const ring = spec.on ? 1 : item.bar;
		if ( ring > 0 ) {

			const lw = Math.max( 4, box.h * 0.022 );
			ctx.strokeStyle = ACCENT;
			ctx.lineWidth = lw;
			const length = bento( ctx, pad + lw / 2, pad + lw / 2, box.w - lw, box.h - lw, radius - lw / 2, item.skew );
			ctx.setLineDash( [ length * ring, length ] );
			ctx.stroke();
			ctx.setLineDash( [] );

		}

	}

	// A badge, a name and a line on a wide tile; hovered: an orange outline
	// draws in, the badge turns orange
	drawRow( item ) {

		const { spec, ctx, box, pad } = item;
		if ( spec.blank ) return;
		const radius = BENTO.radius * PX * 0.8;
		ctx.save();
		shade( ctx, box.h * 0.5 );
		ctx.fillStyle = PAPER;
		ctx.globalAlpha = spec.off ? 0.7 : 1;
		bento( ctx, pad, pad, box.w, box.h, radius, item.skew );
		ctx.fill();
		ctx.restore();

		const inset = Math.round( box.h * 0.14 );
		const side = box.h - inset * 2;
		ctx.fillStyle = spec.off ? MUTED : item.hot || spec.accent ? ACCENT : DARK;
		ctx.beginPath();
		ctx.roundRect( pad + inset, pad + inset, side * 1.25, side, side * 0.22 );
		ctx.fill();
		const bp = fitText( ctx, spec.badge || '', Math.round( side * 0.42 ), side * 1.1, 900 );
		ctx.font = `900 ${ bp }px ${ FONT }`;
		ctx.fillStyle = '#fff';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText( spec.badge || '', pad + inset + side * 0.625, pad + box.h / 2 );
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';

		let room = box.w - ( pad + inset * 2 + side * 1.25 - pad ) - inset;
		if ( spec.aside ) {

			const ap = fitText( ctx, spec.aside, Math.round( box.h * 0.3 ), room * 0.45, 900 );
			ctx.font = `900 ${ ap }px ${ FONT }`;
			ctx.letterSpacing = `${ TRACK * ap }px`;
			ctx.fillStyle = spec.off ? MUTED : DARK;
			ctx.textAlign = 'right';
			ctx.textBaseline = 'middle';
			ctx.fillText( spec.aside, pad + box.w - inset * 1.5, pad + box.h / 2 );
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';
			room -= ctx.measureText( spec.aside ).width + inset * 1.5;

		}

		const x = pad + inset * 2 + side * 1.25;
		const np = fitText( ctx, spec.title, Math.round( box.h * 0.27 ), room, 900 );
		ctx.font = `900 ${ np }px ${ FONT }`;
		ctx.letterSpacing = `${ TRACK * np }px`;
		ctx.fillStyle = spec.off ? MUTED : DARK;
		ctx.fillText( spec.title, x, pad + box.h * 0.47 );
		if ( spec.sub ) {

			const sp = fitText( ctx, spec.sub, Math.round( box.h * 0.2 ), room, 700 );
			ctx.font = `700 ${ sp }px ${ FONT }`;
			ctx.letterSpacing = `${ TRACK * sp }px`;
			ctx.fillStyle = spec.open ? '#2f9e57' : MUTED;
			ctx.fillText( spec.sub, x, pad + box.h * 0.76 );

		}

		ctx.letterSpacing = '0px';
		if ( item.bar > 0 && ! spec.off ) {

			const lw = box.h * 0.04;
			ctx.strokeStyle = ACCENT;
			ctx.lineWidth = lw;
			const length = bento( ctx, pad + lw / 2, pad + lw / 2, box.w - lw, box.h - lw, radius - lw / 2, item.skew );
			ctx.setLineDash( [ length * item.bar, length ] );
			ctx.stroke();
			ctx.setLineDash( [] );

		}

	}

	// A small heading over a row, on the scene (white, shaded); smaller if
	// it would run past the column
	drawCaption( item ) {

		const { spec, ctx, box, pad } = item;
		const text = spec.title.toUpperCase();
		let px = Math.round( box.h * 0.62 );
		ctx.font = `800 ${ px }px ${ FONT }`;
		ctx.letterSpacing = `${ 0.06 * px }px`;
		const w = ctx.measureText( text ).width; // its letter spacing included
		if ( w > box.w * 0.95 ) {

			px = Math.floor( px * box.w * 0.95 / w );
			ctx.font = `800 ${ px }px ${ FONT }`;
			ctx.letterSpacing = `${ 0.06 * px }px`;

		}

		shade( ctx, px * 1.4 );
		ctx.fillStyle = INK;
		ctx.fillText( text, pad + px * 0.1, pad + box.h * 0.78 );
		ctx.letterSpacing = '0px';

	}

	// The clip in a bento tile (cover-fitted, leaning in when hovered), a
	// shade at its foot, the title over it, the line rising under it, an
	// orange outline drawn in on hover
	drawVideo( item ) {

		const { spec, ctx, box, pad, video } = item;
		const radius = BENTO.radius * PX * 1.4;
		const right = spec.side === 'right';

		ctx.save();
		shade( ctx, box.h * 0.4 );
		ctx.fillStyle = DARK;
		bento( ctx, pad, pad, box.w, box.h, radius, item.skew );
		ctx.fill();
		ctx.restore();

		ctx.save();
		bento( ctx, pad, pad, box.w, box.h, radius, item.skew );
		ctx.clip();
		const picture = video?.readyState >= 2 && video.videoWidth ? video : item.image;
		if ( picture ) {

			const zoom = 1 + item.bar * 0.05;
			const pw = picture.videoWidth || picture.width, ph = picture.videoHeight || picture.height;
			const k = Math.max( box.w / pw, box.h / ph ) * zoom;
			const w = pw * k, h = ph * k;
			ctx.drawImage( picture, pad + ( box.w - w ) / 2, pad + ( box.h - h ) / 2, w, h );

		}

		// The title's side darker, so it reads on any frame
		const g = ctx.createLinearGradient( 0, pad + box.h * 0.35, 0, pad + box.h );
		g.addColorStop( 0, 'rgba(8, 10, 16, 0)' );
		g.addColorStop( 1, 'rgba(8, 10, 16, 0.72)' );
		ctx.fillStyle = g;
		ctx.fillRect( pad, pad, box.w, box.h );
		ctx.restore();

		const x = right ? pad + box.w - box.inset : pad + box.inset;
		const base = pad + box.h - box.inset - box.sub * 1.5;
		const title = spec.title.toUpperCase();
		ctx.letterSpacing = '0px';
		ctx.font = `${ box.title }px ${ TITLE_FONT }`;
		const metrics = ctx.measureText( title );
		const inkWidth = Math.max( metrics.width, ( metrics.actualBoundingBoxLeft || 0 ) + ( metrics.actualBoundingBoxRight || 0 ) );
		const titlePx = Math.floor( box.title * Math.min( 1, ( box.w - box.inset * 2 ) / Math.max( 1, inkWidth ) ) );
		ctx.font = `${ titlePx }px ${ TITLE_FONT }`;
		shade( ctx, titlePx );
		ctx.fillStyle = item.hot ? ACCENT : INK;
		ctx.fillText( title, right ? x - ctx.measureText( title ).width : x, base );

		if ( spec.sub && item.reveal > 0 ) {

			ctx.font = `800 ${ box.sub }px ${ FONT }`;
			ctx.fillStyle = INK;
			rise( ctx, spec.sub, x, base + box.sub * 1.3, box.sub, item.reveal, right ? 'right' : 'left' );

		}

		ctx.shadowColor = 'transparent';
		if ( item.bar > 0 ) {

			const lw = box.h * 0.018;
			ctx.strokeStyle = ACCENT;
			ctx.lineWidth = lw;
			const length = bento( ctx, pad + lw / 2, pad + lw / 2, box.w - lw, box.h - lw, radius - lw / 2, item.skew );
			ctx.setLineDash( [ length * item.bar, length ] );
			ctx.stroke();
			ctx.setLineDash( [] );

		}

	}

	hover( e, on ) {

		const button = e.target.closest?.( '.hotspot' );
		if ( ! button || button.disabled ) return;
		const item = this.items[ Number( button.dataset.wall ) ];
		if ( ! item ) return;
		// Still hot if hovered or focused from the keyboard (a click leaves the
		// focus on the button: not a reason to stay lit once the mouse is gone)
		const hot = on || button.matches( ':hover' ) || button.matches( ':focus-visible' );
		if ( hot === item.hot ) return;
		item.hot = hot;
		this.onHover?.( item.spec, hot );
		this.draw( item );
		// In: the bar runs out, the line's letters rise; out: both go back
		const draw = () => this.draw( item );
		gsap.killTweensOf( item, 'bar,reveal' ); // not a pop-in / going away
		gsap.to( item, hot
			? { bar: 1, duration: 0.45, ease: 'power3.out', onUpdate: draw }
			: { bar: 0, duration: 0.3, ease: 'power3.inOut', onUpdate: draw } );
		if ( item.spec.sub || item.spec.hoverSub || item.kind === 'icon' || item.kind === 'video' ) gsap.to( item, hot
			? { reveal: 1, duration: 0.55, ease: 'none', onUpdate: draw }
			: { reveal: 0, duration: 0.3, ease: 'none', onUpdate: draw } );

	}

	// Lays the items out for a camera standing at its rest pose (world
	// matrix + projection): rows down each side, near ends on the screen
	// edges. The walls stand upright and the lines of text run level, like
	// everything built in the scene: they meet the scene's horizon, not the
	// middle of the screen (the camera looks down on the car)
	// shift: the view's lens shift across (NDC, Showroom.setView 'menu'): the
	// walls still start at the screen's edges
	place( camera, shift = 0 ) {

		camera.updateMatrixWorld();
		const tanV = Math.tan( THREE.MathUtils.degToRad( camera.fov ) / 2 );
		const tanH = tanV * camera.aspect;
		const narrow = camera.aspect < 1.1;
		const up = new THREE.Vector3( 0, 1, 0 );
		const forward = camera.getWorldDirection( new THREE.Vector3() ).setY( 0 ).normalize();
		const right = new THREE.Vector3().crossVectors( forward, up ).normalize();

		for ( const side of [ 'left', 'right' ] ) {

			const s = side === 'left' ? - 1 : 1;
			// Along the text: level, turned ANGLE from the screen into the depth
			// (or a side's own `angle`, degrees: turned more towards the camera)
			const own = this.items.find( ( i ) => i.spec.side === side && i.spec.angle )?.spec.angle;
			const angle = own ? THREE.MathUtils.degToRad( own ) : ANGLE;
			const u = right.clone().multiplyScalar( Math.cos( angle ) ).addScaledVector( forward, - s * Math.sin( angle ) );
			const normal = new THREE.Vector3().crossVectors( u, up ).normalize();
			const quaternion = new THREE.Quaternion().setFromRotationMatrix( new THREE.Matrix4().makeBasis( u, up, normal ) );
			const pair = this.items.some( ( i ) => i.kind === 'video' ); // Solo's two clips: the same size on both sides
			// (a side's own `grow`: that wall bigger again, the home's right one)
			const grow = this.items.find( ( i ) => i.spec.side === side && i.spec.grow )?.spec.grow ?? 1;
			let scale = ( narrow ? 0.7 : 1 ) * ( side === 'right' && ! pair ? RIGHT_SCALE : 1 ) * grow;
			const sideRows = rows( this.items.filter( ( i ) => i.spec.side === side ) );
			// Home can gain modes: fit the complete title column above the bottom edge.
			// Keep its top anchor and the other screens' tile/card sizes unchanged.
			if ( sideRows.length && sideRows.every( row => row.every( it => it.kind === 'title' ) ) ) {
				const height = sideRows.reduce( ( sum, row ) => sum + Math.max( ...row.map( it => it.h ) ), 0 );
				const available = 2 * tanV * DEPTH * ( narrow ? 0.43 : 0.67 );
				scale = Math.min( scale, Math.max( 0.1, ( available - 0.04 * ( sideRows.length - 1 ) ) / height ) );
			}
			// Rows from a bit above the middle down to near the bottom
			let y = tanV * DEPTH * ( narrow ? - 0.01 : 0.53 );
			// Tiles overlap their shadow margins: BENTO.gap apart, across and down
			const tight = ( 2 * PAD - BENTO.gap ) * scale;
			let above = null, head = null;

			for ( const row of sideRows ) {

				const tiles = row[ 0 ].kind !== 'title';
				const h = Math.max( ...row.map( ( it ) => it.h ) ) * scale;
				// The clips: a little lower, their middle near the horizon
				if ( row[ 0 ].kind === 'video' && above === null ) y = tanV * DEPTH * ( narrow ? - 0.1 : 0.3 );
				// Tiles under a title: just below its hover bar, their edge on its letters'
				if ( tiles && above === false ) y += 0.04 + ( head.slack / PX - BENTO.gap + PAD ) * scale;
				else if ( tiles && above ) y += 0.04 + tight;
				y -= h * 0.5;
				// From the screen's edge inwards: the right side's row read left to right
				let along = tiles && head ? ( head.inkEdge / PX - PAD ) * scale : 0;

				for ( const it of side === 'right' ? [ ...row ].reverse() : row ) {

					const near = new THREE.Vector3( ( s * EDGE - shift ) * tanH * DEPTH, y, - DEPTH ).applyMatrix4( camera.matrixWorld );
					const center = near.addScaledVector( u, - s * ( along + it.w * scale * 0.5 ) );
					along += it.w * scale - ( tiles ? tight : 0 );

					it.base = { center, u, scale, normal };
					it.mesh.position.copy( center );
					it.mesh.quaternion.copy( quaternion );
					it.mesh.scale.setScalar( scale );

				}

				y -= h * 0.5 + 0.04;
				above = tiles;
				if ( ! tiles ) head = row[ 0 ];

			}

		}

		this.placed = true;

	}

	// Per frame: hover easing, the icons' motion, and the buttons follow the
	// items on screen
	update( dt, camera, width, height ) {

		const visible = this.shown && this.group.visible && !! this.placed;

		for ( const it of this.items ) {

			const target = it.hot ? 1 : 0;
			it.hover += ( target - it.hover ) * Math.min( 1, dt * 12 );

			// Hovered, on the left: slides out of the wall towards the middle
			if ( it.base ) it.mesh.position.copy( it.base.center );
			// Popping in / going (appear 0..1): scaled from a bit smaller, faded
			if ( it.base ) {

				const a = it.appear ?? 1;
				it.mesh.scale.setScalar( it.base.scale * ( 0.6 + 0.4 * a ) );
				it.mesh.material.opacity = Math.min( 1, Math.max( 0, a ) );

			}
			if ( it.base && it.spec.side === 'left' && it.kind === 'title' ) it.mesh.position.addScaledVector( it.base.normal, it.hover * 0.06 ).addScaledVector( it.base.u, it.hover * 0.05 );

			// The gear turns (faster hovered), the music's bars dance
			if ( visible && it.kind === 'icon' && it.spec.icon !== 'editor' ) {

				it.spin += dt * ( 0.35 + it.hover * 2.4 );
				this.draw( it );

			}

			// The clips play while shown (a new frame: drawn again)
			if ( it.video ) {

				if ( visible && it.video.paused ) it.video.play().catch( () => {} );
				else if ( ! visible && ! it.video.paused ) it.video.pause();
				if ( visible && it.video.readyState >= 2 && ( it.fresh || it.everyFrame ) ) {

					it.fresh = false;
					this.draw( it );

				}

			}

		}

		this.layer.hidden = ! visible;
		if ( ! visible ) return;

		camera.updateMatrixWorld();
		this.group.updateMatrixWorld();
		_m.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );

		for ( const it of this.items ) {

			// A left title's button stays where the title rests: following its
			// slide out, it would leave a pointer near its edge, the title would
			// slide back under it, and so on (the title shaking)
			const slid = it.base && it.spec.side === 'left' && it.kind === 'title';
			if ( slid ) {

				_p.copy( it.mesh.position );
				it.mesh.position.copy( it.base.center );
				it.mesh.updateMatrixWorld();

			}
			const hw = it.w / 2, hh = it.h / 2;
			const pts = [ [ - hw, hh ], [ hw, hh ], [ hw, - hh ], [ - hw, - hh ] ].map( ( [ x, y ] ) => {

				_v.set( x, y, 0 ).applyMatrix4( it.mesh.matrixWorld ).applyMatrix4( _m );
				return [ ( _v.x * 0.5 + 0.5 ) * width, ( - _v.y * 0.5 + 0.5 ) * height ];

			} );
			if ( slid ) {

				it.mesh.position.copy( _p );
				it.mesh.updateMatrixWorld();

			}

			const xs = pts.map( ( p ) => p[ 0 ] ), ys = pts.map( ( p ) => p[ 1 ] );
			const left = Math.min( ...xs ), top = Math.min( ...ys );
			const w = Math.max( ...xs ) - left, h = Math.max( ...ys ) - top;
			const corners = `${ left.toFixed( 0 ) },${ top.toFixed( 0 ) },${ w.toFixed( 0 ) },${ h.toFixed( 0 ) }|` + pts.map( ( p ) => `${ ( p[ 0 ] - left ).toFixed( 0 ) }px ${ ( p[ 1 ] - top ).toFixed( 0 ) }px` ).join( ',' );
			if ( corners === it.corners ) continue;
			it.corners = corners;

			Object.assign( it.button.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px', clipPath: `polygon(${ corners.split( '|' )[ 1 ] })` } );

			// The star button: a plain rectangle over its badge (drawThumb,
			// item.starRect, in canvas px), proportional to the tile's own box
			if ( it.starButton && it.starRect ) {

				const r = it.starRect;
				Object.assign( it.starButton.style, {
					left: ( left + ( r.x / it.canvas.width ) * w ) + 'px',
					top: ( top + ( r.y / it.canvas.height ) * h ) + 'px',
					width: ( ( r.w / it.canvas.width ) * w ) + 'px',
					height: ( ( r.h / it.canvas.height ) * h ) + 'px',
				} );

			}

		}

	}

	show( on ) {

		this.shown = on;
		for ( const it of this.items ) {

			it.button.tabIndex = on && ! it.button.disabled ? 0 : - 1;
			if ( it.starButton ) it.starButton.tabIndex = on && ! it.starButton.disabled ? 0 : - 1;

		}

	}

	// The items matching go (shrinking away); resolves when gone
	dismiss( match ) {

		const list = this.items.filter( ( it ) => match( it.spec ) );
		for ( const it of list ) {

			it.button.disabled = true;
			if ( it.starButton ) it.starButton.disabled = true;
			gsap.killTweensOf( it, 'appear' ); // a pop-in still running

		}
		const gone = Promise.all( list.map( ( it, i ) => gsap.to( it, { appear: 0, duration: 0.28, delay: i * 0.04, ease: 'power2.in' } ).then() ) );
		return Promise.race( [ gone, new Promise( ( r ) => setTimeout( r, 500 ) ) ] ); // even if the tweens don't run (a hidden tab)

	}

	// Changes some items' fields and draws them again (a record come in from
	// the network): match( spec ) → true for those
	patch( match, fields ) {

		for ( const it of this.items ) if ( match( it.spec ) ) {

			Object.assign( it.spec, fields );
			this.draw( it );

		}

	}

}

// Consecutive items sharing a `row` stand side by side; any other is a row alone
function rows( list ) {

	const out = [];
	for ( const it of list ) {

		const last = out[ out.length - 1 ];
		if ( it.spec.row && last && last[ 0 ].spec.row === it.spec.row ) last.push( it );
		else out.push( [ it ] );

	}

	return out;

}

// The account card's sizes (px), its width fitting its text
function cardBox( ctx, spec ) {

	const px = ( m ) => Math.round( m * PX );
	const box = { h: px( CARD.h ), avatar: px( CARD.avatar ), name: px( CARD.name ), small: px( CARD.small ), inset: px( CARD.inset ), gap: px( CARD.gap ) };
	const textW = Math.max( textWidth( ctx, `900 ${ box.name }px ${ FONT }`, spec.title, box.name ), textWidth( ctx, `700 ${ box.small }px ${ FONT }`, spec.sub || '', box.small ) );
	box.w = Math.ceil( box.inset + box.avatar + box.gap + textW + box.inset * 1.6 );
	return box;

}

// How far each corner of a tile is pulled in (px, [ x, y ] × 4 from the top
// left, clockwise): fixed per item, a bit different from one to the next
function skew( index, max ) {

	const out = [];
	for ( let i = 0; i < 8; i ++ ) {

		const r = Math.sin( ( index + 1 ) * 12.9898 + i * 78.233 ) * 43758.5453;
		out.push( ( r - Math.floor( r ) ) * max );

	}

	return out;

}

// The path of a tile: the box with its corners pulled in by `k`, rounded;
// returns its length (about)
function bento( ctx, x, y, w, h, radius, k ) {

	const p = [ [ x + k[ 0 ], y + k[ 1 ] ], [ x + w - k[ 2 ], y + k[ 3 ] ], [ x + w - k[ 4 ], y + h - k[ 5 ] ], [ x + k[ 6 ], y + h - k[ 7 ] ] ];
	ctx.beginPath();
	ctx.moveTo( ( p[ 3 ][ 0 ] + p[ 0 ][ 0 ] ) / 2, ( p[ 3 ][ 1 ] + p[ 0 ][ 1 ] ) / 2 );
	let length = 0;
	for ( let i = 0; i < 4; i ++ ) {

		const a = p[ i ], b = p[ ( i + 1 ) % 4 ];
		ctx.arcTo( a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ], radius );
		length += Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );

	}

	ctx.closePath();
	return length;

}

// Where a title's parts sit on its canvas (px): its baseline, the line's
// baseline and the bar, under the title (default) or above it (spec.above:
// the line, then the bar, then the title, so what stands under the title can
// come close: Garage and the tiles); height: the canvas'; foot: the lowest
// thing drawn
function titleLayout( spec, titlePx, subPx, pad ) {

	const barH = Math.max( 4, titlePx * 0.045 );

	if ( spec.above && spec.sub ) {

		const line = pad + subPx;
		const barY = line + subPx * 0.3;
		const base = barY + barH + titlePx * 0.82;
		return { base, line, barY, barH, height: base + titlePx * 0.2 + pad, foot: base + titlePx * 0.06 };

	}

	const base = pad + titlePx * 0.82;
	const line = base + subPx * SUB_GAP; // right under the title
	// just below the line's descenders (or the title, without a line)
	const barY = spec.sub ? base + subPx * ( SUB_GAP + 0.45 ) : base + titlePx * 0.14;
	return { base, line, barY, barH, height: titlePx * 1.02 + ( spec.sub ? subPx * 1.5 : 0 ) + pad * 2, foot: barY + barH };

}

// A title's letters: their width, and how far they start from the canvas'
// near edge (right-aligned on the right wall, as drawTitle draws them), px
function titleInk( ctx, spec ) {

	const titlePx = Math.round( ( spec.size || 0.32 ) * PX );
	ctx.font = `${ titlePx }px ${ TITLE_FONT }`;
	const m = ctx.measureText( spec.title.toUpperCase() );
	const pad = Math.round( titlePx * 0.18 );
	const width = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
	const edge = spec.side === 'right' ? pad + m.width - m.actualBoundingBoxRight : pad - m.actualBoundingBoxLeft;
	return { width, edge };

}

// The same for a title in TITLE_FONT
function fitTitle( ctx, text, px, width ) {

	ctx.font = `${ px }px ${ TITLE_FONT }`;
	const w = ctx.measureText( text ).width;
	return w > width ? Math.floor( px * width / w ) : px;

}

// The size (px) a line of text gets to fit a width, at most px
function fitText( ctx, text, px, width, weight = 800 ) {

	const w = textWidth( ctx, `${ weight } ${ px }px ${ FONT }`, text, px );
	return w > width ? Math.floor( px * width / w ) : px;

}

function textWidth( ctx, font, text, px ) {

	ctx.font = font;
	return ctx.measureText( text ).width + TRACK * px * [ ...text ].length;

}

// A soft dark shadow, under the letters / shapes only
function shade( ctx, px ) {

	ctx.shadowColor = 'rgba(8, 10, 16, 0.45)';
	ctx.shadowBlur = px * 0.08;
	ctx.shadowOffsetY = px * 0.03;

}

// A line of text letter by letter, each rising out of a clip at the line's
// foot, STAGGER of the reveal apart. x: where it starts / ends / is centred
function rise( ctx, text, x, line, px, reveal, align ) {

	const chars = [ ...text ];
	const n = chars.length;
	const span = 1 + STAGGER * ( n - 1 );
	const track = TRACK * px;
	const width = ctx.measureText( text ).width + track * n;
	let cx = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
	ctx.save();
	ctx.beginPath();
	ctx.rect( 0, line - px * 1.1, ctx.canvas.width, px * 1.4 );
	ctx.clip();
	for ( let i = 0; i < n; i ++ ) {

		const p = Math.min( 1, Math.max( 0, reveal * span - i * STAGGER ) );
		const e = 1 - Math.pow( 1 - p, 3 );
		if ( p > 0 ) ctx.fillText( chars[ i ], cx, line + ( 1 - e ) * px * 1.2 );
		cx += ctx.measureText( chars[ i ] ).width + track;

	}

	ctx.restore();

}

// ─── The icons (drawn in the current fill / stroke colour) ──

// A gear of 8 teeth with a hole, turned by `angle`
function gear( ctx, x, y, R, angle ) {

	const n = 8, step = Math.PI * 2 / n;
	ctx.beginPath();
	for ( let i = 0; i < n; i ++ ) {

		const t = angle + i * step;
		for ( const [ da, r ] of [ [ - 0.32, R * 0.74 ], [ - 0.17, R ], [ 0.17, R ], [ 0.32, R * 0.74 ] ] ) {

			const a = t + da * step;
			ctx.lineTo( x + Math.cos( a ) * r, y + Math.sin( a ) * r );

		}

	}

	ctx.closePath();
	ctx.moveTo( x + R * 0.34, y );
	ctx.arc( x, y, R * 0.34, 0, Math.PI * 2, true );
	ctx.fill( 'evenodd' );

}

// A pencil leaning right; as `t` goes 0 → 1 it writes a wave, its tip
// riding the end of the stroke
function pencil( ctx, x, y, tile, t ) {

	const x0 = x - tile * 0.24, x1 = x + tile * 0.14, base = y + tile * 0.22;
	const wave = ( k ) => [ x0 + ( x1 - x0 ) * k, base - Math.sin( k * Math.PI * 2 ) * tile * 0.035 ];

	if ( t > 0 ) {

		ctx.lineWidth = tile * 0.045;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		for ( let i = 0; i <= 24; i ++ ) ctx.lineTo( ...wave( t * i / 24 ) );
		ctx.stroke();

	}

	const [ tx, ty ] = wave( t );
	const len = tile * 0.52, w = tile * 0.15, tip = tile * 0.13;
	ctx.save();
	ctx.translate( tx, ty );
	ctx.rotate( - Math.PI / 4 );
	ctx.beginPath(); // the point
	ctx.moveTo( 0, 0 );
	ctx.lineTo( tip, - w / 2 );
	ctx.lineTo( tip, w / 2 );
	ctx.closePath();
	ctx.fill();
	ctx.beginPath(); // the body, a gap after the point
	ctx.roundRect( tip + w * 0.18, - w / 2, len - tip - w * 0.18, w, w * 0.2 );
	ctx.fill();
	ctx.restore();

}

// The season's sign, centred on 0, 0: a sun (summer), a leaf (autumn), a
// snowflake (winter), a flower (spring), slowly turning or swaying with time
const SEASON_LABELS = Object.fromEntries( [ 'summer', 'autumn', 'winter', 'spring' ].map( ( id ) => [ id, t( 'seasons.' + id ) ] ) );

function seasonIcon( ctx, id, tile, time, ink ) {

	ctx.fillStyle = ink;
	ctx.strokeStyle = ink;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';

	if ( id === 'summer' ) {

		ctx.rotate( time * 0.4 );
		ctx.beginPath();
		ctx.arc( 0, 0, tile * 0.13, 0, Math.PI * 2 );
		ctx.fill();
		ctx.lineWidth = tile * 0.045;
		for ( let i = 0; i < 8; i ++ ) {

			const a = i * Math.PI / 4;
			ctx.beginPath();
			ctx.moveTo( Math.cos( a ) * tile * 0.2, Math.sin( a ) * tile * 0.2 );
			ctx.lineTo( Math.cos( a ) * tile * 0.28, Math.sin( a ) * tile * 0.28 );
			ctx.stroke();

		}

	} else if ( id === 'autumn' ) {

		ctx.rotate( - 0.6 + Math.sin( time * 1.6 ) * 0.18 );
		const l = tile * 0.3, w = tile * 0.17;
		ctx.beginPath();
		ctx.moveTo( 0, - l );
		ctx.quadraticCurveTo( w * 1.6, - l * 0.1, 0, l * 0.75 );
		ctx.quadraticCurveTo( - w * 1.6, - l * 0.1, 0, - l );
		ctx.fill();
		ctx.lineWidth = tile * 0.035;
		ctx.beginPath(); // the stem
		ctx.moveTo( 0, l * 0.6 );
		ctx.lineTo( 0, l * 1.05 );
		ctx.stroke();

	} else if ( id === 'winter' ) {

		ctx.rotate( time * 0.25 );
		ctx.lineWidth = tile * 0.04;
		const r = tile * 0.28;
		for ( let i = 0; i < 6; i ++ ) {

			ctx.save();
			ctx.rotate( i * Math.PI / 3 );
			ctx.beginPath();
			ctx.moveTo( 0, 0 );
			ctx.lineTo( 0, - r );
			ctx.moveTo( 0, - r * 0.55 );
			ctx.lineTo( r * 0.22, - r * 0.78 );
			ctx.moveTo( 0, - r * 0.55 );
			ctx.lineTo( - r * 0.22, - r * 0.78 );
			ctx.stroke();
			ctx.restore();

		}

	} else {

		ctx.rotate( time * 0.3 );
		for ( let i = 0; i < 5; i ++ ) {

			const a = i * Math.PI * 2 / 5;
			ctx.beginPath();
			ctx.ellipse( Math.cos( a ) * tile * 0.15, Math.sin( a ) * tile * 0.15, tile * 0.11, tile * 0.075, a, 0, Math.PI * 2 );
			ctx.fill();

		}

		ctx.fillStyle = ink === DARK ? PAPER : ACCENT; // the heart, the tile's colour
		ctx.beginPath();
		ctx.arc( 0, 0, tile * 0.07, 0, Math.PI * 2 );
		ctx.fill();

	}

}

// Four bars dancing to the beat (kick 0..1); off (kick < 0): flat
function equalizer( ctx, x, y, tile, kick, time ) {

	const bw = tile * 0.095, gap = tile * 0.055, foot = y + tile * 0.22;
	const rest = [ 0.2, 0.3, 0.16, 0.26 ], swing = [ 0.2, 0.13, 0.21, 0.12 ];
	for ( let i = 0; i < 4; i ++ ) {

		const h = kick < 0 ? tile * 0.07 : tile * ( rest[ i ] * ( 0.85 + 0.15 * Math.sin( time * 3 + i * 1.7 ) ) + swing[ i ] * kick );
		ctx.beginPath();
		ctx.roundRect( x - ( 2 * bw + 1.5 * gap ) + i * ( bw + gap ), foot - h, bw, h, bw / 2 );
		ctx.fill();

	}

}
