// The garage's car names: an endless drum (the list comes round again), the
// name in the middle of the screen = the car. Turned by the mouse wheel (a
// notch ≈ two thirds of a row), dragged with the button held (thrown with
// some inertia), or a name clicked; it always comes to rest on a row, and
// onPick( id ) fires when it does on another car than the last one.
//
// Smoothed like Lenis (its default lerp 0.1 a frame at 60 fps, here as a rate
// so any frame rate feels the same): the wheel and a throw only move a target,
// the drum glides after it, and the snap onto a row is a glide too.
//
// Only a few rows exist (ROWS each side of the middle): they are reused and
// relabelled as the drum turns, placed with transforms, each with --d (rows
// from the middle) and --dy (signed) for the CSS to lean and fade them.

const ROWS = 7;
const WHEEL_ROWS = 1 / 150; // rows per pixel of wheel delta
const SMOOTH = 60 * - Math.log( 1 - 0.1 ); // 1/s: Lenis' lerp 0.1 per 60 Hz frame (≈ 6.3)
const THROW = 0.4; // s of the release speed carried on
const SNAP_AFTER = 160; // ms without wheel before it settles on the nearest row

const mod = ( a, n ) => ( ( a % n ) + n ) % n;

export class CarWheel {

	// el: the container; items: [ { id, label } ]; selected: id
	constructor( el, items, selected, onPick ) {

		this.el = el;
		this.items = items;
		this.onPick = onPick;
		const start = Math.max( 0, items.findIndex( ( i ) => i.id === selected ) );
		this.pos = start; // row in the middle (fractional while turning)
		this.target = start;
		this.picked = items[ start ]?.id;
		this.drag = null;
		this.wheelTimer = 0;
		this.last = performance.now();
		this.rowH = 52;

		this.slots = [];
		for ( let k = - ROWS; k <= ROWS; k ++ ) {

			const b = document.createElement( 'button' );
			b.type = 'button';
			b.dataset.slot = k;
			el.appendChild( b );
			this.slots.push( { k, el: b, label: null } );

		}

		el.addEventListener( 'wheel', ( e ) => this.onWheel( e ), { passive: false } );
		el.addEventListener( 'pointerdown', ( e ) => this.onDown( e ) );
		el.addEventListener( 'pointermove', ( e ) => this.onMove( e ) );
		el.addEventListener( 'pointerup', ( e ) => this.onUp( e ) );
		el.addEventListener( 'pointercancel', ( e ) => this.onUp( e ) );
		el.addEventListener( 'click', ( e ) => this.onClick( e ), true );
		el.addEventListener( 'keydown', ( e ) => this.onKey( e ) );

		this.draw();
		this.frame = requestAnimationFrame( () => this.tick() );

	}

	setSelected( id ) {

		this.picked = id;
		this.draw();

	}

	onWheel( e ) {

		e.preventDefault();
		const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
		this.target += px * WHEEL_ROWS;
		// Rests on the nearest row once the wheel stops
		clearTimeout( this.wheelTimer );
		this.wheelTimer = setTimeout( () => { this.target = Math.round( this.target ); }, SNAP_AFTER );

	}

	onDown( e ) {

		if ( e.button !== 0 ) return;
		this.rowH = this.slots[ 0 ].el.offsetHeight || this.rowH;
		this.drag = { id: e.pointerId, y: e.clientY, pos: this.pos, moved: false, samples: [ [ performance.now(), this.pos ] ] };

	}

	onMove( e ) {

		const d = this.drag;
		if ( ! d || e.pointerId !== d.id ) return;
		const dy = e.clientY - d.y;
		if ( ! d.moved && Math.abs( dy ) > 5 ) {

			d.moved = true;
			this.el.setPointerCapture( d.id );
			this.el.classList.add( 'dragging' );

		}

		if ( ! d.moved ) return;
		this.pos = this.target = d.pos - dy / this.rowH;
		d.samples.push( [ performance.now(), this.pos ] );
		if ( d.samples.length > 6 ) d.samples.shift();

	}

	onUp( e ) {

		const d = this.drag;
		if ( ! d || e.pointerId !== d.id ) return;
		this.drag = null;
		this.el.classList.remove( 'dragging' );
		if ( ! d.moved ) return;
		this.dragged = true; // the click that follows is not a pick

		// Thrown: the speed of the last moments carries on a little
		const [ t0, p0 ] = d.samples[ 0 ], [ t1, p1 ] = d.samples[ d.samples.length - 1 ];
		const speed = t1 > t0 ? ( p1 - p0 ) / ( ( t1 - t0 ) / 1000 ) : 0;
		this.target = Math.round( this.pos + speed * THROW );

	}

	// A name clicked: the drum turns to it
	onClick( e ) {

		const b = e.target.closest( 'button' );
		if ( ! b || ! this.el.contains( b ) ) return;
		e.stopPropagation();
		if ( this.dragged ) {

			this.dragged = false;
			return;

		}

		this.target = Math.round( this.pos ) + Number( b.dataset.slot );

	}

	onKey( e ) {

		if ( e.key === 'ArrowUp' || e.key === 'ArrowDown' ) {

			e.preventDefault();
			this.target = Math.round( this.target ) + ( e.key === 'ArrowUp' ? - 1 : 1 );

		}

	}

	tick() {

		if ( ! this.el.isConnected ) return; // the screen was redrawn: this wheel is gone
		const now = performance.now();
		const dt = Math.min( 0.1, ( now - this.last ) / 1000 );
		this.last = now;

		if ( ! this.drag ) this.pos += ( this.target - this.pos ) * ( 1 - Math.exp( - SMOOTH * dt ) );
		if ( ! this.drag && Math.abs( this.target - this.pos ) < 0.003 && this.target === Math.round( this.target ) ) {

			this.pos = this.target;
			const item = this.items[ mod( this.target, this.items.length ) ];
			if ( item && item.id !== this.picked ) {

				this.picked = item.id;
				this.onPick( item.id );

			}

		}

		this.draw();
		this.frame = requestAnimationFrame( () => this.tick() );

	}

	draw() {

		const n = this.items.length;
		const center = Math.round( this.pos );

		for ( const s of this.slots ) {

			const logical = center + s.k;
			const item = this.items[ mod( logical, n ) ];
			const off = logical - this.pos;

			if ( s.label !== item.id ) {

				s.label = item.id;
				s.el.textContent = item.label;
				s.el.dataset.car = item.id;

			}

			s.el.classList.toggle( 'on', item.id === this.picked && Math.abs( off ) < 0.5 );
			s.el.style.setProperty( '--dy', off.toFixed( 3 ) );
			s.el.style.setProperty( '--d', Math.abs( off ).toFixed( 3 ) );
			s.el.tabIndex = Math.abs( off ) < 3.5 ? 0 : - 1;

		}

	}

}
