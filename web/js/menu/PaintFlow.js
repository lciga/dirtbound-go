import * as THREE from 'three';

// A livery change in the menu: the new paint spreads over the car like a
// fluid poured on its roof, a ragged front that runs down and around the
// body. Changes may pile up before the last one is done: each is a layer
// flowing over the ones below, all in the same place.
//
// One field (a distance from the roof warped by 3D noise) and one front per
// layer, a radius growing with its age: a newer layer started later on the
// same curve, so it always lies inside the older ones. Each model is thus
// drawn in a band of the field, from the front of the layer above it to its
// own front (binary: a pixel belongs to exactly one model, nothing blended,
// nothing fighting in depth). A layer covered whole is dropped.

const DURATION = 1.5; // s for the paint to cover the car
const RAGGED = 0.22; // m the noise pushes the front around
const FAR = 1e6;

// Shared by every car material
const ORIGIN = { value: new THREE.Vector3() };

const VERTEX_HEAD = /* glsl */`
varying vec3 vFlowPos;
`;

const FRAGMENT_HEAD = /* glsl */`
uniform vec3 uFlowOrigin;
uniform vec2 uFlowBand; // drawn where uFlowBand.x <= field < uFlowBand.y
varying vec3 vFlowPos;
float flowHash( vec3 p ) {
	p = fract( p * 0.3183099 + 0.1 );
	p *= 17.0;
	return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float flowNoise( vec3 x ) {
	vec3 i = floor( x ), f = fract( x );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( flowHash( i ), flowHash( i + vec3( 1, 0, 0 ) ), f.x ),
		mix( flowHash( i + vec3( 0, 1, 0 ) ), flowHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( flowHash( i + vec3( 0, 0, 1 ) ), flowHash( i + vec3( 1, 0, 1 ) ), f.x ),
		mix( flowHash( i + vec3( 0, 1, 1 ) ), flowHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// How far the paint has to travel to reach this point: from the roof, a bit
// slower going down (it runs over the sides), pushed about by the noise
float flowField( vec3 p ) {
	vec3 d = p - uFlowOrigin;
	float n = flowNoise( p * 6.0 ) * 0.65 + flowNoise( p * 17.0 ) * 0.35;
	return length( vec3( d.x, d.y * 1.5, d.z ) ) + ( n - 0.5 ) * 2.0 * ${ RAGGED.toFixed( 3 ) };
}
`;

const FRAGMENT_TEST = /* glsl */`
	if ( uFlowBand.x > - ${ FAR.toFixed( 1 ) } || uFlowBand.y < ${ FAR.toFixed( 1 ) } ) {
		float field = flowField( vFlowPos );
		if ( field < uFlowBand.x || field >= uFlowBand.y ) discard;
	}
`;

const bands = new WeakMap(); // material → its { value: Vector2 } band

// Every material of a car model learns the mask (once; before its first
// compile where possible). Whole until a layer sets its band
export function preparePaint( model ) {

	model.traverse( ( o ) => {

		if ( ! o.isMesh ) return;

		for ( const m of Array.isArray( o.material ) ? o.material : [ o.material ] ) {

			if ( bands.has( m ) ) continue;
			const band = { value: new THREE.Vector2( - FAR, FAR ) };
			bands.set( m, band );
			const before = m.onBeforeCompile;
			const key = m.customProgramCacheKey;
			const baseKey = key === THREE.Material.prototype.customProgramCacheKey ? () => before.toString() : () => key.call( m );

			m.onBeforeCompile = function ( shader, renderer ) {

				before.call( this, shader, renderer );
				Object.assign( shader.uniforms, { uFlowOrigin: ORIGIN, uFlowBand: band } );
				shader.vertexShader = shader.vertexShader
					.replace( '#include <common>', '#include <common>\n' + VERTEX_HEAD )
					.replace( '#include <project_vertex>', 'vFlowPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n#include <project_vertex>' );
				shader.fragmentShader = shader.fragmentShader
					.replace( '#include <common>', '#include <common>\n' + FRAGMENT_HEAD )
					.replace( /void\s+main\s*\(\s*\)\s*\{/, ( s ) => s + '\n' + FRAGMENT_TEST );

			};

			m.customProgramCacheKey = () => baseKey() + '|paint';
			m.needsUpdate = true;

		}

	} );

}

function setBand( model, min, max ) {

	model.traverse( ( o ) => {

		if ( ! o.isMesh ) return;
		for ( const m of Array.isArray( o.material ) ? o.material : [ o.material ] ) bands.get( m )?.value.set( min, max );

	} );

}

// The spot lights a model carries (the menu's headlight beams)
function beams( model, on ) {

	model.traverse( ( o ) => { if ( o.isSpotLight ) o.visible = on; } );

}

// The new model takes the old one's pose, part by part (same car: same nodes)
function copyPose( from, to ) {

	to.position.copy( from.position );
	to.quaternion.copy( from.quaternion );
	to.scale.copy( from.scale );
	const a = [], b = [];
	from.traverse( ( o ) => a.push( o ) );
	to.traverse( ( o ) => b.push( o ) );
	for ( let i = 1; i < Math.min( a.length, b.length ); i ++ ) {

		if ( a[ i ].name !== b[ i ].name ) continue;
		b[ i ].position.copy( a[ i ].position );
		b[ i ].quaternion.copy( a[ i ].quaternion );

	}

}

// A model already in the pile (livery 1 → 2 → 1 in a row) comes again as a
// copy with materials of its own (their own band; same programs)
function paintCopy( model ) {

	const copy = model.clone();
	copy.traverse( ( o ) => {

		if ( o.isMesh ) o.material = Array.isArray( o.material ) ? o.material.map( ( m ) => m.clone() ) : o.material.clone();

	} );
	preparePaint( copy );
	copy.userData.paintCopy = true;
	return copy;

}

function radius( time ) {

	const t = Math.min( 1, time / DURATION );
	return - RAGGED + ( 1 - Math.pow( 1 - t, 2.2 ) ) * ( this.reach + RAGGED ); // pours fast, then creeps into the last corners

}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();

export class PaintFlow {

	constructor( scene ) {

		this.scene = scene;
		this.layers = []; // [ { model, time } ], oldest first: the first one is the paint under all the others
		this.reach = 2;

	}

	get running() {

		return this.layers.length > 1;

	}

	// shown: the model on display; next: the same car in another livery.
	// Returns what now stands on top (next, or a copy of it): the car on display
	add( shown, next ) {

		if ( ! this.layers.length ) {

			this.layers = [ { model: shown, time: Infinity } ];
			shown.updateMatrixWorld( true );
			_box.makeEmpty();
			shown.traverse( ( o ) => { if ( o.isMesh ) _box.expandByObject( o, true ); } );
			_box.getSize( _size );
			// From the top of the roof, as far as the far end of the car
			ORIGIN.value.set( ( _box.min.x + _box.max.x ) / 2, _box.max.y, ( _box.min.z + _box.max.z ) / 2 );
			this.reach = _size.length() * 0.75 + RAGGED * 2;

		}

		if ( this.layers.some( ( l ) => l.model === next ) ) next = paintCopy( next );
		copyPose( shown, next );
		beams( next, false ); // only the bottom layer's beams light: the number of lights never changes (no recompile)
		this.scene.add( next );
		this.layers.push( { model: next, time: 0 } );
		this.update( 0 );
		return next;

	}

	update( dt ) {

		const layers = this.layers;
		if ( layers.length < 2 ) return;
		for ( const l of layers ) if ( l.time !== Infinity ) l.time += dt;

		// A layer done covers everything under it: those go
		let full = 0;
		for ( let i = layers.length - 1; i > 0; i -- ) if ( layers[ i ].time >= DURATION ) {

			full = i;
			break;

		}

		if ( full ) {

			for ( const l of layers.splice( 0, full ) ) this.drop( l.model );
			layers[ 0 ].time = Infinity;
			beams( layers[ 0 ].model, true );

		}

		if ( layers.length < 2 ) return this.finish();

		// Each layer from the front of the one above it to its own
		for ( let i = 0; i < layers.length; i ++ ) {

			const max = i === 0 ? FAR : radius.call( this, layers[ i ].time );
			const min = i + 1 < layers.length ? Math.min( max, radius.call( this, layers[ i + 1 ].time ) ) : - FAR;
			setBand( layers[ i ].model, min, max );

		}

	}

	drop( model ) {

		this.scene.remove( model );
		setBand( model, - FAR, FAR );
		beams( model, true ); // as it was, for when it comes back from the cache
		if ( model.userData.paintCopy ) model.traverse( ( o ) => { if ( o.isMesh ) for ( const m of [ o.material ].flat() ) m.dispose(); } );

	}

	// Done (or cut short): only the newest paint is left
	finish() {

		const layers = this.layers;
		if ( ! layers.length ) return;
		const top = layers.pop();
		for ( const l of layers ) this.drop( l.model );
		this.layers = [];
		setBand( top.model, - FAR, FAR );
		beams( top.model, true );

	}

}
