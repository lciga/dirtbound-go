// When a remote car of a multiplayer race is solid in this player's physics.
// Pure, no three.js: RemoteBodies.js applies it to the crashcat bodies.

export const COLLISION = Object.freeze( {
	clearDistance: 2, // m between the two cars before a ghost may turn solid (no overlap possible)
	staleAfter: 0.5, // s without news from a car before it turns back into a ghost
	maxJump: 2, // m in one physics step (240 m/s): a respawn or a burst of late states, not driving
	pushMargin: 2, // m/s a crash may add above the faster of the two cars
	maxLift: 1.5, // m/s upwards at most right after a car contact: a box pushed into a car
	// (infinite mass, fast with a boost) made the solver launch it over the barrier
	guardDistance: 3, // m: a car this close to a solid box gets the push limit
	correctionSpeed: 3, // m/s: how fast a box may drift away from the car's real motion to catch up with a corrected prediction
	halfExtents: Object.freeze( [ 0.42, 0.3, 0.9 ] ), // m, box of a car (measured 0.8 × 0.6 × 1.8 m)
	centerHeight: 0.3, // m from the car's base (container position) to the box centre
} );

// rt: race time now; latestRt: race time of the last state received from that car;
// distance: horizontal distance between the two cars; wasActive: solid on the previous step;
// jump: how far that car's target moved since the previous step (a box moved that far
// in one step would hit at an absurd speed and break this player's physics)
// finished: that car crossed the line (it coasts to a stop on the racing line: not a wall for the others);
// selfJump: how far this player's own car moved since the previous step (its own respawn)
export function collisionActive( { rt, latestRt, distance, wasActive, jump = 0, finished = false, selfJump = 0 } ) {

	if ( rt === null || rt < 0 || latestRt === null || finished ) return false;
	if ( ! ( jump <= COLLISION.maxJump ) || ! ( selfJump <= COLLISION.maxJump ) ) return false; // also NaN
	if ( rt - latestRt > COLLISION.staleAfter ) return false;
	return wasActive || distance > COLLISION.clearDistance;

}

// The box moves at most maxStep (m) towards its target per physics step: a
// corrected prediction is caught up over a few steps instead of hitting at
// correction / dt (hundreds of m/s)
export function clampTarget( from, to, maxStep ) {

	const d = [ to[ 0 ] - from[ 0 ], to[ 1 ] - from[ 1 ], to[ 2 ] - from[ 2 ] ];
	const length = Math.hypot( d[ 0 ], d[ 1 ], d[ 2 ] );
	if ( length <= maxStep ) return [ to[ 0 ], to[ 1 ], to[ 2 ] ];
	const k = maxStep / length;
	return [ from[ 0 ] + d[ 0 ] * k, from[ 1 ] + d[ 1 ] * k, from[ 2 ] + d[ 2 ] * k ];

}

// q and -q are the same rotation, but moveKinematic turns the long way round
// (angle = 2 acos w) and would spin the box at hundreds of rad/s
export function alignQuat( q, reference ) {

	const dot = q[ 0 ] * reference[ 0 ] + q[ 1 ] * reference[ 1 ] + q[ 2 ] * reference[ 2 ] + q[ 3 ] * reference[ 3 ];
	return dot < 0 ? [ - q[ 0 ], - q[ 1 ], - q[ 2 ], - q[ 3 ] ] : [ q[ 0 ], q[ 1 ], q[ 2 ], q[ 3 ] ];

}

// Highest speed this player's car may have right after a physics step next to
// a solid box: a car squeezed between a box and a wall (both immovable in its
// own physics) would otherwise be shot out at any speed
export function pushLimit( { before, remoteSpeed } ) {

	return Math.max( before, remoteSpeed ) + COLLISION.pushMargin;

}

// Reference speed of a contact: the car's speed when it began, kept while it lasts
// (measured each step, a long squeeze could otherwise add pushMargin every step)
export function pushBaseline( previous, near, speed ) {

	if ( ! near ) return null;
	return previous ?? speed;

}

// This player's velocity right after a physics step next to a solid box: at
// most maxSpeed across the ground (pushLimit) and COLLISION.maxLift upwards;
// falling is left alone
export function limitVelocity( v, maxSpeed ) {

	const speed = Math.hypot( v[ 0 ], v[ 2 ] );
	const k = speed > maxSpeed ? maxSpeed / speed : 1;
	return [ v[ 0 ] * k, Math.min( v[ 1 ], COLLISION.maxLift ), v[ 2 ] * k ];

}
