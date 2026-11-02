// Languages of the game's text. Every string shown to the player goes through
// t( key, params ) and lives in js/locales/<code>.js. Russian is the club's
// primary language and the fallback for missing translations.
//
// The language is the browser's (navigator.languages: what the player reads,
// a better guess than their country), else Russian. Forced by hand, from
// the devtools console:
//   dirtbound.setLang( 'en' )    then the page reloads
//   dirtbound.setLang( 'auto' )  back to the browser's language
// or for one page with ?lang=en in the address.
//
// Adding a language: copy js/locales/en.js to js/locales/<code>.js, translate
// it and add the code to LANGS. Only the active language is downloaded.
// Outside a browser (the server's tests import some game modules) it is Russian.

import ru from './locales/ru.js';

export const LANGS = {
	en: 'English', es: 'Español', pt: 'Português (Brasil)', de: 'Deutsch', it: 'Italiano',
	pl: 'Polski', tr: 'Türkçe', nl: 'Nederlands', sv: 'Svenska', cs: 'Čeština', ro: 'Română',
	ru: 'Русский', ja: '日本語', zh: '简体中文', ko: '한국어',
};
export const FALLBACK = 'ru'; // a browser in a language the game doesn't speak
const KEY = 'dirtbound.lang';
const browser = typeof window !== 'undefined';

function readStored() {

	try {

		return localStorage.getItem( KEY );

	} catch {

		return null;

	}

}

// 'fr-CA' → 'fr' when only 'fr' exists; null if the game doesn't speak it
function supported( code ) {

	if ( ! code ) return null;
	const lower = String( code ).toLowerCase();
	if ( LANGS[ lower ] ) return lower;
	const base = lower.split( '-' )[ 0 ];
	return LANGS[ base ] ? base : null;

}

function choose() {

	if ( ! browser ) return { lang: 'ru', source: 'node' };
	const asked = supported( new URLSearchParams( location.search ).get( 'lang' ) );
	if ( asked ) return { lang: asked, source: 'url' };
	const stored = supported( readStored() );
	if ( stored ) return { lang: stored, source: 'manual' };
	for ( const code of navigator.languages?.length ? navigator.languages : [ navigator.language ] ) {

		const lang = supported( code );
		if ( lang ) return { lang, source: 'auto' };

	}

	return { lang: FALLBACK, source: 'auto' };

}

const chosen = choose();
export const lang = chosen.lang;
const dict = lang === 'ru' ? ru : ( await import( `./locales/${ lang }.js` ) ).default;
const serverMessages = { ...ru.server, ...dict.server };
const plurals = new Intl.PluralRules( lang );
const ordinals = new Intl.PluralRules( lang, { type: 'ordinal' } );

function lookup( table, key ) {

	let v = table;
	for ( const part of key.split( '.' ) ) {

		v = v?.[ part ];
		if ( v === undefined ) return undefined;

	}

	return v;

}

// The text of a key: { name } replaced by params.name; a value of the form
// { one, other } (plurals) picks by params.n. Unknown key = the key itself.
export function t( key, params = {} ) {

	let v = lookup( dict, key ) ?? lookup( ru, key );
	if ( v === undefined ) {

		if ( browser ) console.warn( `i18n: no text for "${ key }"` );
		return key;

	}

	if ( typeof v === 'object' ) v = v[ plurals.select( params.n ?? 0 ) ] ?? v.other;
	return String( v ).replace( /\{(\w+)\}/g, ( m, name ) => ( name in params ? params[ name ] : m ) );

}

// 1 → '1er' / '1st': the language's `ordinal` { one, two, few, other }
export function ordinal( n ) {

	const v = lookup( dict, 'ordinal' ) ?? lookup( ru, 'ordinal' );
	return ( v[ ordinals.select( n ) ] ?? v.other ).replace( '{n}', n );

}

// A list of texts (key → array), e.g. a graphics preset's lines
export function list( key ) {

	const v = lookup( dict, key ) ?? lookup( ru, key );
	return Array.isArray( v ) ? v : [];

}

// Messages written by the server (always French): their translation, found
// by their exact text in the language's `server` table. A message unknown
// there is shown as is. "Tour refusé : <why>" is translated in two halves.
export function serverText( message ) {

	if ( ! message ) return message;
	const table = serverMessages;
	if ( table[ message ] ) return table[ message ];
	const cut = message.indexOf( ' : ' );
	if ( cut > 0 ) {

		const head = message.slice( 0, cut ), tail = message.slice( cut + 3 );
		if ( table[ head ] ) return `${ table[ head ] }: ${ table[ tail ] || tail }`;

	}

	return message;

}

// Static HTML: data-i18n="key" sets the text, data-i18n-html="key" the HTML,
// data-i18n-<attribute>="key" an attribute (title, placeholder, aria-label…)
export function translatePage( root = document ) {

	for ( const el of root.querySelectorAll( '*' ) ) {

		for ( const { name, value } of [ ...el.attributes ] ) {

			if ( ! name.startsWith( 'data-i18n' ) ) continue;
			if ( name === 'data-i18n' ) el.textContent = t( value );
			else if ( name === 'data-i18n-html' ) el.innerHTML = t( value );
			else el.setAttribute( name.slice( 10 ), t( value ) );

		}

	}

}

// The language to use from now on (stored in this browser), then a reload;
// 'auto' (or nothing) = the browser's language again
function setLang( code ) {

	const next = code && code !== 'auto' ? supported( code ) : null;
	if ( code && code !== 'auto' && ! next ) return `Unknown language "${ code }". Available: ${ Object.keys( LANGS ).join( ', ' ) }, auto`;

	try {

		if ( next ) localStorage.setItem( KEY, next );
		else localStorage.removeItem( KEY );

	} catch {

		return 'localStorage is blocked: use ?lang=' + ( next || 'xx' ) + ' in the address instead';

	}

	const url = new URL( location.href );
	url.searchParams.delete( 'lang' ); // the address would win over the choice
	location.replace( url );
	return `Language: ${ next || 'auto' }, reloading…`;

}

if ( browser ) {

	document.documentElement.lang = lang;
	window.dirtbound = Object.assign( window.dirtbound || {}, {
		lang, langs: Object.keys( LANGS ), langSource: chosen.source, setLang,
	} );

}
