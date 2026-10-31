// Flight of the bonus rockets (pure, no three.js: tested from Node).
// Level 1 flies straight ahead, skimming the road, and bursts on the barriers.
// Levels 2 and 3 home in: they climb out of the car, cruise up to CRUISE_MAX
// above their target and dive onto it, a parabola that flattens when the
// target is close (no climb at all within CLOSE). Every player flies every
// rocket on their own screen; each one judges only whether their own car was hit.

export const ROCKET = Object.freeze( {
	step: 1 / 120, // s: flight steps
	straightSpeed: 45, // m/s
	straightHeight: 0.6, // m above the road
	straightLife: 2.5, // s (~110 m)
	launchSpeed: 16, // m/s: homing rockets leave the car slowly…
	topSpeed: 40, // m/s: …then catch up (cars top out near 20)
	accel: 30, // m/s²
	homingLife: 8, // s
	cruiseMax: 9, // m above the target, far away
	cruisePerM: 0.55, // m of height per m of distance beyond CLOSE
	close: 7, // m: within this distance the rocket aims straight at the car
	turnBase: 2.5, // rad/s of turn at launch…
	turnGain: 5, // …plus this per s of flight, so it always ends on the car
	hitRadius: 1.3, // m from the car's centre
	armTime: 0.15, // s: a rocket cannot hit before (it leaves its own car)
	maxLate: 3, // s: a shot heard of later than this is not shown
	swerve: 12, // m: a homing rocket's aim pulled to one side while it is far, so a salvo fans out…
	wobble: 2.5, // m: …and weaves (sideways, half as much up and down)…
	straighten: 18, // m: …both fading out over this much distance beyond CLOSE: the end is a straight dive
} );

// 0..1 from a rocket id (same on every screen: each player flies every rocket)
function idNoise( id, salt ) {

	let h = 2166136261 ^ salt;
	for ( let i = 0; i < id.length; i ++ ) h = Math.imul( h ^ id.charCodeAt( i ), 16777619 );
	return ( ( h >>> 0 ) % 10007 ) / 10007;

}

const SPREAD = 0.35; // rad between the rockets of one level 3 shot

// One rocket of a shot. targets: player ids (none for level 1); i / count:
// this rocket among the shot's (level 3 fans them out)
export function launchRocket( { id, from, kind = 'rocket', level, target = null, rt, x, y, z, dx, dz, i = 0, count = 1 } ) {

	const yaw = ( i - ( count - 1 ) / 2 ) * SPREAD;
	const c = Math.cos( yaw ), s = Math.sin( yaw );
	const fx = dx * c + dz * s, fz = dz * c - dx * s;
	const n = Math.hypot( fx, fz ) || 1;
	const dir = [ fx / n, 0, fz / n ];
	const homing = level > 1 && target !== null;
	// Its own path: a salvo's rockets swerve to their side of the fan, a lone one to a side of its own
	const side = count > 1 ? ( i - ( count - 1 ) / 2 ) / ( ( count - 1 ) / 2 ) : 0;
	const swerve = Math.max( - 1, Math.min( 1, side * 0.8 + ( idNoise( id, 1 ) - 0.5 ) * ( count > 1 ? 0.5 : 1.4 ) ) );

	return {
		id, from, kind, level, target, homing,
		t: rt, // race time the rocket has been flown to
		age: 0,
		pos: [ x + dir[ 0 ] * 1.4, y + ROCKET.straightHeight, z + dir[ 2 ] * 1.4 ],
		prev: null,
		dir, // unit direction of flight
		speed: homing ? ROCKET.launchSpeed : ROCKET.straightSpeed,
		launched: false, // homing: climb angle set on the first step, from the target's distance
		swerve, // -1..1: which way and how far its path bows
		phase: idNoise( id, 2 ) * Math.PI * 2, // its weave
		weave: 2.2 + idNoise( id, 3 ) * 2, // rad/s
	};

}

function normalize( v ) {

	const n = Math.hypot( v[ 0 ], v[ 1 ], v[ 2 ] ) || 1;
	return [ v[ 0 ] / n, v[ 1 ] / n, v[ 2 ] / n ];

}

// Turns unit vector a towards unit vector b by at most `angle` rad
export function turnTowards( a, b, angle ) {

	const dot = Math.max( - 1, Math.min( 1, a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] ) );
	const between = Math.acos( dot );
	if ( between <= angle || between < 1e-6 ) return [ ...b ];

	// b's part across a, then rotate in the plane of a and b
	const ortho = normalize( [ b[ 0 ] - a[ 0 ] * dot, b[ 1 ] - a[ 1 ] * dot, b[ 2 ] - a[ 2 ] * dot ] );
	const c = Math.cos( angle ), s = Math.sin( angle );
	return normalize( [ a[ 0 ] * c + ortho[ 0 ] * s, a[ 1 ] * c + ortho[ 1 ] * s, a[ 2 ] * c + ortho[ 2 ] * s ] );

}

// How high above its target a homing rocket aims, from the ground distance left
export function cruiseHeight( distance ) {

	return distance <= ROCKET.close ? 0 : Math.min( ROCKET.cruiseMax, ( distance - ROCKET.close ) * ROCKET.cruisePerM );

}

// One flight step. world: { targetAt( id ) → { x, y, z } (the car's centre) | null,
// roadAt( x, z ) → { y: road surface height, off: true past the barriers } }.
// Returns null while flying, else why it ended: 'wall', 'ground', 'expired'
export function stepRocket( r, dt, world ) {

	r.prev = [ ...r.pos ];
	r.age += dt;
	r.t += dt;
	const p = r.pos;

	if ( ! r.homing ) {

		const road = world.roadAt( p[ 0 ], p[ 2 ] );
		p[ 0 ] += r.dir[ 0 ] * r.speed * dt;
		p[ 2 ] += r.dir[ 2 ] * r.speed * dt;
		// Skims the road: follows its rises and dips
		p[ 1 ] += ( road.y + ROCKET.straightHeight - p[ 1 ] ) * Math.min( 1, dt * 12 );
		if ( world.roadAt( p[ 0 ], p[ 2 ] ).off ) return 'wall';
		return r.age > ROCKET.straightLife ? 'expired' : null;

	}

	const target = world.targetAt( r.target );

	if ( target ) {

		const gx = target.x - p[ 0 ], gz = target.z - p[ 2 ];
		const distance = Math.hypot( gx, gz );

		if ( ! r.launched ) {

			// Out of the car's roof: steep when the target is far, nearly flat when close
			const climb = Math.min( 1, Math.max( 0.15, ( distance - ROCKET.close ) / 25 ) ) * 1.1;
			r.dir = normalize( [ r.dir[ 0 ] * Math.cos( climb ), Math.sin( climb ), r.dir[ 2 ] * Math.cos( climb ) ] );
			r.launched = true;

		}

		// Far away the aim is pulled aside and weaves; close in it is the car itself
		const far = Math.min( 1, Math.max( 0, ( distance - ROCKET.close ) / ROCKET.straighten ) );
		const wave = Math.sin( r.age * r.weave + r.phase );
		const lateral = far * ( ( r.swerve ?? 0 ) * ROCKET.swerve + wave * ROCKET.wobble );
		const across = distance > 1e-3 ? [ - gz / distance, gx / distance ] : [ 0, 0 ];
		const lift = far * Math.sin( r.age * r.weave * 1.3 + r.phase * 2 ) * ROCKET.wobble * 0.5;
		const aim = [ target.x + across[ 0 ] * lateral, target.y + cruiseHeight( distance ) + lift, target.z + across[ 1 ] * lateral ];
		const want = normalize( [ aim[ 0 ] - p[ 0 ], aim[ 1 ] - p[ 1 ], aim[ 2 ] - p[ 2 ] ] );
		r.dir = turnTowards( r.dir, want, ( ROCKET.turnBase + ROCKET.turnGain * r.age ) * dt );

	}

	r.speed = Math.min( ROCKET.topSpeed, r.speed + ROCKET.accel * dt );
	p[ 0 ] += r.dir[ 0 ] * r.speed * dt;
	p[ 1 ] += r.dir[ 1 ] * r.speed * dt;
	p[ 2 ] += r.dir[ 2 ] * r.speed * dt;

	if ( r.age > ROCKET.armTime && p[ 1 ] < world.roadAt( p[ 0 ], p[ 2 ] ).y ) return 'ground';
	return r.age > ROCKET.homingLife ? 'expired' : null;

}

// Whether the rocket passed within hitRadius of a car's centre during its last step
export function rocketHits( r, car, radius = ROCKET.hitRadius ) {

	if ( r.age < ROCKET.armTime || ! car ) return false;
	const a = r.prev || r.pos, b = r.pos;
	const ab = [ b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ];
	const len2 = ab[ 0 ] ** 2 + ab[ 1 ] ** 2 + ab[ 2 ] ** 2;
	const t = len2 > 0 ? Math.max( 0, Math.min( 1, ( ( car.x - a[ 0 ] ) * ab[ 0 ] + ( car.y - a[ 1 ] ) * ab[ 1 ] + ( car.z - a[ 2 ] ) * ab[ 2 ] ) / len2 ) ) : 0;
	return Math.hypot( a[ 0 ] + ab[ 0 ] * t - car.x, a[ 1 ] + ab[ 1 ] * t - car.y, a[ 2 ] + ab[ 2 ] * t - car.z ) <= radius;

}

// The rockets of one shot: level 1 = one straight ahead; level 2 = one on
// targets[ 0 ]; level 3 = one per target
export function shotRockets( shot, rocketIdOf ) {

	const targets = shot.level === 1 ? [ null ] : shot.targets.length ? shot.targets : [ null ];
	return targets.map( ( target, i ) => launchRocket( { ...shot, level: target === null ? 1 : shot.level, target, id: rocketIdOf( i ), i, count: targets.length } ) );

}

// Who a shot aims at. me: { id, progress }; others: [ { id, progress, distance } ]
// of the racers still racing. Level 2: the next car ahead (the nearest one when
// leading); level 3: everyone
export function shotTargets( level, me, others ) {

	if ( level === 1 || others.length === 0 ) return [];
	if ( level >= 3 ) return others.map( ( o ) => o.id );

	const ahead = others.filter( ( o ) => o.progress > me.progress ).sort( ( a, b ) => a.progress - b.progress );
	if ( ahead.length ) return [ ahead[ 0 ].id ];
	return [ [ ...others ].sort( ( a, b ) => a.distance - b.distance )[ 0 ].id ];

}

// Holding a bonus and picking another box: one level up (max `max`); empty
// handed: level 1 of `kind` (the box's draw)
export function pickUp( item, max = 3, kind = 'rocket' ) {

	return item ? { ...item, level: Math.min( max, item.level + 1 ) } : { kind, level: 1 };

}
