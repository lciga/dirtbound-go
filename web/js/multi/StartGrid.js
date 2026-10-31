// Starting grid of a multiplayer race: two staggered columns behind the start
// line, laid along the road itself (a grid in a bend follows the bend).
// frameAt( d ) gives the road d metres behind the line: { x, y, z, tx, tz },
// (tx, tz) the unit tangent in the driving direction. Pure, no three.js.

export const GRID = Object.freeze( { lateral: 1.6, firstBack: 3, stagger: 2.5, rowGap: 6 } );
export const RALLY_GRID_S = 15; // m of road before the line on a rally stage

// Slot 0 = pole (right column, front row); even slots right, odd slots left
export function gridSlot( index, frameAt ) {

	const row = Math.floor( index / 2 );
	const right = index % 2 === 0;
	const back = GRID.firstBack + row * GRID.rowGap + ( right ? 0 : GRID.stagger );
	const f = frameAt( back );
	const side = ( right ? 1 : - 1 ) * GRID.lateral;

	return {
		position: [ f.x - f.tz * side, f.y + 0.5, f.z + f.tx * side ],
		angle: Math.atan2( f.tx, f.tz ),
	};

}
