import * as THREE from 'three';

// The home's season change: the new season spreads over the world from
// under the car like a livery over a body (PaintFlow.js, the same idea at
// the scale of the place). Two worlds stand in the same place, the old
// season and the new one (HomeSet keeps one per season); one field (a
// distance from the car's foot warped by 3D noise) and one front growing
// with time: the new world is drawn inside the front, the old one outside
// (binary: a pixel belongs to one world, nothing blended, nothing fighting
// in depth). Each world has materials of its own (those the worlds would
// share are copied: prepareSeasonFlow), so each is cut on its own side.

const DURATION = 3.2; // s for the new season to reach the far end of the place
const MAX_REACH = 32; // m: beyond, the fog hides the front anyway
const RAGGED = 1.1; // m the noise pushes the front around
const FAR = 1e6;

const ORIGIN = { value: new THREE.Vector3() };

const VERTEX_HEAD = /* glsl */`
varying vec3 vSeasonPos;
`;

// The world position: the batch and instance transforms (the props' kits)
// as three's project_vertex applies them, then the model's
const VERTEX_BODY = /* glsl */`
{
	vec4 p = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		p = batchingMatrix * p;
	#endif
	#ifdef USE_INSTANCING
		p = instanceMatrix * p;
	#endif
	vSeasonPos = ( modelMatrix * p ).xyz;
}
`;

const FRAGMENT_HEAD = /* glsl */`
uniform vec3 uSeasonOrigin;
uniform vec2 uSeasonBand; // drawn where uSeasonBand.x <= field < uSeasonBand.y
varying vec3 vSeasonPos;
float seasonHash( vec3 p ) {
	p = fract( p * 0.3183099 + 0.1 );
	p *= 17.0;
	return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float seasonNoise( vec3 x ) {
	vec3 i = floor( x ), f = fract( x );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( seasonHash( i ), seasonHash( i + vec3( 1, 0, 0 ) ), f.x ),
		mix( seasonHash( i + vec3( 0, 1, 0 ) ), seasonHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( seasonHash( i + vec3( 0, 0, 1 ) ), seasonHash( i + vec3( 1, 0, 1 ) ), f.x ),
		mix( seasonHash( i + vec3( 0, 1, 1 ) ), seasonHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// How far the season has to travel to reach this point: from the car's foot
// across the ground, climbing the trees a bit slower, pushed about by the noise
float seasonField( vec3 p ) {
	vec3 d = p - uSeasonOrigin;
	float n = seasonNoise( p * 0.35 ) * 0.65 + seasonNoise( p * 1.3 ) * 0.35;
	return length( vec3( d.x, d.y * 1.4, d.z ) ) + ( n - 0.5 ) * 2.0 * ${ RAGGED.toFixed( 3 ) };
}
`;

const FRAGMENT_TEST = /* glsl */`
	if ( uSeasonBand.x > - ${ FAR.toFixed( 1 ) } || uSeasonBand.y < ${ FAR.toFixed( 1 ) } ) {
		float field = seasonField( vSeasonPos );
		if ( field < uSeasonBand.x || field >= uSeasonBand.y ) discard;
	}
`;

const bands = new WeakMap(); // material → its { value: Vector2 } band

function materialsOf( root ) {

	const set = new Set();
	root.traverse( ( o ) => {

		if ( o.isMesh ) for ( const m of Array.isArray( o.material ) ? o.material : [ o.material ] ) set.add( m );

	} );
	return set;

}


const owners = new WeakMap(); // material → the world it was prepared for
const bare = new WeakMap(); // material → its shader hooks before the mask (for copies)

// Every material of a world learns the mask (once; before its first compile
// where possible). A material another world already uses (the verges'
// bushes, rocks…) is copied first: each world its own, cut on its own side
export function prepareSeasonFlow( root ) {

	const copies = new Map();
	root.traverse( ( o ) => {

		if ( ! o.isMesh ) return;
		const own = ( m ) => {

			if ( ! owners.has( m ) || owners.get( m ) === root ) return m;
			if ( ! copies.has( m ) ) {

				const c = m.clone();
				const hooks = bare.get( m );
				c.onBeforeCompile = hooks.before;
				if ( hooks.key ) c.customProgramCacheKey = hooks.key;
				copies.set( m, c );

			}

			return copies.get( m );

		};
		o.material = Array.isArray( o.material ) ? o.material.map( own ) : own( o.material );

	} );

	for ( const m of materialsOf( root ) ) {

		if ( bands.has( m ) ) continue;
		owners.set( m, root );
		const band = { value: new THREE.Vector2( - FAR, FAR ) };
		bands.set( m, band );
		const before = m.onBeforeCompile;
		const key = m.customProgramCacheKey;
		bare.set( m, { before, key: key === THREE.Material.prototype.customProgramCacheKey ? null : key } );
		const baseKey = key === THREE.Material.prototype.customProgramCacheKey ? () => before.toString() : () => key.call( m );

		m.onBeforeCompile = function ( shader, renderer ) {

			before.call( this, shader, renderer );
			Object.assign( shader.uniforms, { uSeasonOrigin: ORIGIN, uSeasonBand: band } );
			shader.vertexShader = shader.vertexShader
				.replace( '#include <common>', '#include <common>\n' + VERTEX_HEAD )
				.replace( '#include <project_vertex>', VERTEX_BODY + '#include <project_vertex>' );
			shader.fragmentShader = shader.fragmentShader
				.replace( '#include <common>', '#include <common>\n' + FRAGMENT_HEAD )
				.replace( /void\s+main\s*\(\s*\)\s*\{/, ( s ) => s + '\n' + FRAGMENT_TEST );

		};

		m.customProgramCacheKey = () => baseKey() + '|season';
		m.needsUpdate = true;

	}

}

// A pile of seasons spreading from the car: layers[ 0 ] is the base (drawn
// beyond every front), each later layer a newer season started later, so its
// front lies inside the one before: layer i is drawn between the next one's
// front and its own (each pixel by one world). Another change while one is
// spreading is a new layer on top; nothing is cut short. A layer whose front
// has covered everything drops every layer under it
export class SeasonFlow {

	constructor() {

		this.layers = []; // { world, bands, time, go }
		this.reach = 40;

	}

	get running() {

		return this.layers.length > 1;

	}

	// The newest layer (its time drives the light)
	get top() {

		return this.layers[ this.layers.length - 1 ] || null;

	}

	has( world ) {

		return this.layers.some( ( l ) => l.world === world );

	}

	// from: the world on screen (the base when nothing is spreading); to: the
	// next one (prepared, not in the pile); origin: the car's foot; reach: m to
	// the far end of the place. The new layer starts hidden until its `go`
	// (HomeSet sets it once compiled). Returns the layer
	start( from, to, origin, reach ) {

		if ( ! this.layers.length ) this.layers.push( this.layer( from ) );
		const layer = this.layer( to );
		this.layers.push( layer );
		this.reach = Math.min( reach, MAX_REACH );
		ORIGIN.value.copy( origin );
		this.apply();
		return layer;

	}

	layer( world ) {

		return { world, bands: [ ...materialsOf( world ) ].map( ( m ) => bands.get( m ) ).filter( Boolean ), time: 0, go: false };

	}

	// A layer's front: slow from under the car, faster and faster out to the edges
	front( layer ) {

		const t = Math.min( 1, layer.time / DURATION );
		return - RAGGED + Math.pow( t, 1.6 ) * ( this.reach + RAGGED * 2 );

	}

	// When ( s after it starts ) a front reaches a field value
	timeTo( field ) {

		const share = Math.min( 1, Math.max( 0, ( field + RAGGED ) / ( this.reach + RAGGED * 2 ) ) );
		return Math.pow( share, 1 / 1.6 ) * DURATION;

	}

	apply() {

		const n = this.layers.length;
		for ( let i = 0; i < n; i ++ ) {

			const below = i + 1 < n ? this.front( this.layers[ i + 1 ] ) : - FAR; // the newer layer's front
			const own = i === 0 ? FAR : this.front( this.layers[ i ] );
			for ( const b of this.layers[ i ].bands ) b.value.set( n > 1 ? below : - FAR, own );

		}

	}

	// Returns the worlds no longer drawn (covered by a newer season)
	update( dt ) {

		if ( ! this.running ) return [];
		for ( const l of this.layers ) if ( l.go && l !== this.layers[ 0 ] ) l.time += dt;
		let done = 0;
		for ( let i = 1; i < this.layers.length; i ++ ) if ( this.layers[ i ].time >= DURATION ) done = i;
		const gone = this.layers.splice( 0, done ).map( ( l ) => l.world );
		if ( this.layers.length === 1 ) this.finish();
		else this.apply();
		return gone;

	}

	// Done (or cut short): only the newest world is left; returns the others
	finish() {

		const top = this.top;
		if ( ! top ) return [];
		const gone = this.layers.filter( ( l ) => l !== top ).map( ( l ) => l.world );
		for ( const b of top.bands ) b.value.set( - FAR, FAR );
		this.layers = [];
		return gone;

	}

}
