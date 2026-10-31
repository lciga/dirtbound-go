// The daily challenge: one stage for everyone, 24h, picked from the date
// alone so the client and the server agree on it without asking each other
// (both sides run this exact pure function). Either one of the real,
// hand-made circuits (OFFICIAL_PUBLISHED + Kenney) or a short rally stage
// (seed + landscape + length) — never a fresh custom circuit.
//
// Rally lengths are capped short on purpose: at the car's realistic top speed
// (~25 world units/s, see GhostCodec.js GHOST_MAX_SPEED's comment), even the
// longest pool entry finishes in well under 90 s, so the daily stays quick
// and a careful driver never risks the server's 600 s ghost length cap.

import { OFFICIAL_PUBLISHED } from './multi/Protocol.js';
import { LANDSCAPE_IDS } from './RallyBiomes.js';

const DAILY_RALLY_LENGTHS = [ 1200, 1600 ]; // m — 1600 / 25 = 64 s at top speed

function hash32( s ) {

	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) { h ^= s.charCodeAt( i ); h = Math.imul( h, 16777619 ) >>> 0; }
	return h >>> 0;

}

export function todayUTC( now = new Date() ) {

	return now.toISOString().slice( 0, 10 ); // YYYY-MM-DD

}

// What the leaderboard id is hashed from (sha256, each side its own crypto:
// js/Leaderboard.js dailyBoardId, server lib/lapcheck.mjs)
export function dailySeed( date = todayUTC() ) {

	return 'daily.' + date;

}

// No procedural circuit generator yet (just the fixed Kenney + 3 official
// circuits, see circuit-gen-rapport.md for that attempt) — until one exists,
// every day is a rally stage: genuinely new each time, rather than cycling
// through the same small, already-familiar circuit pool. Flip this back on
// once generated circuits can join the pool.
const RANDOM_CIRCUITS_READY = false;

// { kind: 'circuit', id, name } | { kind: 'rally', seed, landscape, length }
export function dailyChallenge( date = todayUTC() ) {

	const h = hash32( dailySeed( date ) );

	if ( RANDOM_CIRCUITS_READY ) {

		const circuits = [ { id: 'default', name: 'Circuit Kenney' }, ...OFFICIAL_PUBLISHED ];
		const pick = h % ( circuits.length + 1 ); // + one slot for a rally stage
		if ( pick < circuits.length ) return { kind: 'circuit', id: circuits[ pick ].id, name: circuits[ pick ].name };

	}

	return {
		kind: 'rally',
		seed: String( h % 1000000 ),
		landscape: LANDSCAPE_IDS[ Math.floor( h / 7 ) % LANDSCAPE_IDS.length ],
		length: DAILY_RALLY_LENGTHS[ Math.floor( h / 13 ) % DAILY_RALLY_LENGTHS.length ],
	};

}

// ms until the next UTC midnight (the challenge's countdown, menu tile)
export function msUntilNextChallenge( now = new Date() ) {

	const next = new Date( Date.UTC( now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1 ) );
	return next - now;

}
