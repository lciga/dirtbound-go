// Explanatory console logging, off by default. In the browser console:
//   localStorage.setItem( 'dirtbound.debug', '1' )         every topic
//   localStorage.setItem( 'dirtbound.debug', 'net,cache' ) only these
//   localStorage.removeItem( 'dirtbound.debug' )           off again
// then reload. Topics: net (lobby socket, API calls), lobby (menu/race
// lobby flow), cache (asset cache), page (page switches).

const KEY = 'dirtbound.debug';
const COLORS = { net: '#1b8a5a', lobby: '#2a6fd6', cache: '#a35a00', page: '#8a3fb8' };
const start = performance.now();

function readFlag() {

	try {

		const value = ( globalThis.localStorage?.getItem( KEY ) || '' ).trim();
		if ( value === '' || value === '0' || value === 'false' ) return null;
		if ( value === '1' || value === 'true' || value === '*' ) return true;
		return new Set( value.split( ',' ).map( ( s ) => s.trim() ) );

	} catch {

		return null;

	}

}

const flag = readFlag();

export function debugEnabled( topic ) {

	return flag === true || ( flag !== null && flag.has( topic ) );

}

// log( 'what happened', details… ); log.warn( … ) for problems
export function debugLog( topic ) {

	const on = debugEnabled( topic );
	const style = `color:${ COLORS[ topic ] || '#666' };font-weight:bold`;
	const tag = () => `%c[${ topic } +${ ( ( performance.now() - start ) / 1000 ).toFixed( 2 ) }s]`;
	const log = ( ...args ) => { if ( on ) console.info( tag(), style, ...args ); };
	log.warn = ( ...args ) => { if ( on ) console.warn( tag(), style, ...args ); };
	log.enabled = on;
	return log;

}

if ( flag !== null ) console.info( `[debug] logging on for ${ flag === true ? 'every topic' : [ ...flag ].join( ', ' ) } (localStorage "${ KEY }")` );
