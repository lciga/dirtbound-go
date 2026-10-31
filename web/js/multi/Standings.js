// Live race order: finishers by time, then everybody else by progress. Pure.

export function rank( entries ) {

	return [ ...entries ].sort( ( a, b ) => {

		if ( a.time !== null && b.time !== null ) return a.time - b.time;
		if ( a.time !== null ) return - 1;
		if ( b.time !== null ) return 1;
		return b.progress - a.progress;

	} ).map( ( e ) => e.id );

}

export { ordinal } from '../i18n.js';
