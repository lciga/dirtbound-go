// The lightning bonus (pure, no three.js: tested from Node). Level 1 throws
// a bolt straight ahead (it flies like a level 1 rocket, Rockets.js); level 2
// strikes the two leading racers from the sky, level 3 everyone, never the
// shooter. A car struck gets one malus, drawn from the strike's id so every
// screen agrees on it (each player only applies it to their own car, and
// shows it on the others: a shrunk car is small for everyone).

export const LIGHTNING = Object.freeze( {
	strikeDelay: 0.55, // s between the shot and the sky strike (the warning ring under the car)
	reverse: 5, // s of left and right swapped (electrified wheels)
	shrink: 6, // s at half size and half speed
	vision: 2, // s of flashbang: the screen white, then fading back
	flashHold: 1, // s fully white at the start of it
	shrinkScale: 0.5,
	shrinkSpeed: 0.5,
} );

export const MALUSES = Object.freeze( [ 'reverse', 'shrink', 'vision' ] );

// Who a sky strike goes for. others: [ { id, progress } ] of the racers still
// racing, the shooter left out. Level 2: the two leading; level 3: all of them
export function lightningTargets( level, others ) {

	if ( level < 2 ) return [];
	const order = [ ...others ].sort( ( a, b ) => b.progress - a.progress ).map( ( o ) => o.id );
	return level === 2 ? order.slice( 0, 2 ) : order;

}

// The malus of a strike: key = the bolt's id (Protocol rocketId), victim = the car struck
export function malusOf( key, victim ) {

	let h = 2166136261;
	const s = key + '>' + victim;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 );
	return MALUSES[ ( h >>> 0 ) % MALUSES.length ];

}

export function malusLength( malus ) {

	return LIGHTNING[ malus ];

}

// Flashbang (the 'vision' malus): how white the screen is `elapsed` s after
// the strike, 1 while it holds, then easing out to 0 at LIGHTNING.vision
export function flashOpacity( elapsed ) {

	if ( elapsed < 0 || elapsed >= LIGHTNING.vision ) return 0;
	if ( elapsed <= LIGHTNING.flashHold ) return 1;
	const u = ( elapsed - LIGHTNING.flashHold ) / ( LIGHTNING.vision - LIGHTNING.flashHold );
	return Math.pow( 1 - u, 1.6 );

}
