// One-off cleanup (2026-10-01): for about 40 minutes laps driven with the
// secret accelerator (Boost.js) counted, so some browsers keep impossible
// local best times. Which ones were boosted is not stored, so on the first
// load after this patch: a browser where the accelerator is unlocked loses all
// its local bests (circuit laps and rally stages); everywhere else only a
// Kenney lap faster than the TAS goes (impossible without the boost).

export const PURGE_FLAG = 'racing.purge.boost-2026-10-01';

const BEST_PREFIXES = [ 'racing.bestLap2.', 'racing.bestStage.' ];
const KENNEY_KEY = 'racing.bestLap2.default';
const TAS_KENNEY = 7.708; // fastest lap without the boost (computed offline)

// entries: { key: value } of the browser storage → keys to remove
export function staleBestKeys( entries, boostUnlocked ) {

	if ( boostUnlocked ) return Object.keys( entries ).filter( ( k ) => BEST_PREFIXES.some( ( p ) => k.startsWith( p ) ) );
	const kenney = Number( entries[ KENNEY_KEY ] );
	return kenney > 0 && kenney < TAS_KENNEY ? [ KENNEY_KEY ] : [];

}

// Returns how many bests were removed (0 once the flag is set)
export function purgeBoostedBests( storage = globalThis.localStorage ) {

	try {

		if ( ! storage || storage.getItem( PURGE_FLAG ) ) return 0;

		const entries = {};
		for ( let i = 0; i < storage.length; i ++ ) {

			const key = storage.key( i );
			entries[ key ] = storage.getItem( key );

		}

		const stale = staleBestKeys( entries, storage.getItem( 'racing.boost' ) === '1' );
		for ( const key of stale ) storage.removeItem( key );
		storage.setItem( PURGE_FLAG, '1' );
		return stale.length;

	} catch {

		return 0; // site data blocked: nothing stored, nothing to clean

	}

}
