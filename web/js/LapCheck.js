// Lap counting from positions alone, shared by the game (LapTimer) and the
// server (server/lib/lapcheck.mjs: a posted ghost or a multiplayer race must
// really go round the circuit). No three.js, no DOM.
//
// config (gridLapConfig / splineLapConfig): { center: [ x, z ], angle,
// halfWidth, checkpointCount, checkpointAt( { x, z } ) → key or null }.
// A lap ends when the car crosses the start line forwards, within halfWidth
// of its centre, after visiting every checkpoint since the last lap.

const MAX_LINE_JUMP = 5; // m along the line's axis between two positions: more is a reset, not a crossing

export function startLine( config ) {

	const fx = Math.sin( config.angle );
	const fz = Math.cos( config.angle );
	return { cx: config.center[ 0 ], cz: config.center[ 1 ], fx, fz, rx: fz, rz: - fx };

}

// feed( x, z ) → true when that position ends a lap. reset() forgets the
// previous position and the checkpoints (respawn, restart). slack: checkpoints
// a lap may miss (the server's multiplayer check only sees 20 positions a second).
export function createLapCounter( config, { slack = 0 } = {} ) {

	const line = startLine( config );
	const visited = new Set();
	const point = { x: 0, z: 0 };
	let previous = null;
	let forgiven = 0; // checkpoints this lap may miss on top of slack (a rift jumped them)
	let crossed = false; // the last position crossed the line, a lap or not

	return {

		feed( x, z ) {

			point.x = x;
			point.z = z;
			const key = config.checkpointAt( point );
			if ( key !== null ) visited.add( key );

			const dx = x - line.cx;
			const dz = z - line.cz;
			const forward = dx * line.fx + dz * line.fz;
			const lateral = Math.abs( dx * line.rx + dz * line.rz );
			let lap = false;
			crossed = previous !== null && previous < 0 && forward >= 0 && lateral <= config.halfWidth && forward - previous < MAX_LINE_JUMP;

			// A crossing without every checkpoint keeps them: the line is only
			// checked in x, z, so a road passing over it (Olufsen's bridge) crosses
			// it mid-lap, and clearing them there lost the lap
			if ( crossed && visited.size >= config.checkpointCount - slack - forgiven ) {

				lap = true;
				visited.clear();
				forgiven = 0;

			}

			previous = forward;
			return lap;

		},

		// A declared jump (a rift, multiplayer bonus): n more checkpoints may be missed this lap
		forgive( n ) {

			forgiven += n;

		},

		// Whether the last position fed crossed the line (a lap ended or not: a flying restart starts its clock there)
		crossed: () => crossed,

		// Checkpoints passed since the last crossing (lap progress for the HUD)
		visitedCount: () => visited.size,

		reset() {

			previous = null;
			visited.clear();
			forgiven = 0;
			crossed = false;

		},

	};

}
