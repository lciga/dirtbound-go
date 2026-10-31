// A CSS-style cubic-bezier( x1, y1, x2, y2 ) easing: t (time 0..1) → progress
// (y1 / y2 out of 0..1 overshoot, like in CSS)
export function cubicBezier( x1, y1, x2, y2 ) {

	const bez = ( p1, p2, u ) => 3 * p1 * u * ( 1 - u ) * ( 1 - u ) + 3 * p2 * u * u * ( 1 - u ) + u * u * u;
	const slope = ( p1, p2, u ) => 3 * p1 * ( 1 - u ) * ( 1 - u ) + 6 * ( p2 - p1 ) * u * ( 1 - u ) + 3 * ( 1 - p2 ) * u * u;
	return ( t ) => {

		if ( t <= 0 || t >= 1 ) return t <= 0 ? 0 : 1;
		let u = t; // the curve's parameter where x = t: Newton, then bisection if it stalls
		for ( let i = 0; i < 6; i ++ ) {

			const d = slope( x1, x2, u );
			if ( Math.abs( d ) < 1e-6 ) break;
			u -= ( bez( x1, x2, u ) - t ) / d;

		}

		if ( ! ( u >= 0 && u <= 1 ) || Math.abs( bez( x1, x2, u ) - t ) > 1e-4 ) {

			let lo = 0, hi = 1;
			for ( let i = 0; i < 30; i ++ ) {

				u = ( lo + hi ) / 2;
				if ( bez( x1, x2, u ) < t ) lo = u; else hi = u;

			}

		}

		return bez( y1, y2, u );

	};

}
