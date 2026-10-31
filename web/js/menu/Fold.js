import * as THREE from 'three';

// Scene changes of the menu, in a wave running out from under the car: going,
// white spreads over the ground (the garage's white) and everything standing
// on it shrinks to nothing; coming, everything grows back out of the white
// and the ground's own colours come through again, from under the car
// outwards. Only the car is never touched (the garage's plinth has its own
// move: it sinks and rises, GarageSet).
//
// Done in the shaders of the set's own materials (patched once, before their
// first compile), and of the Ultra effects' own scene passes (the depth of
// field's depth, the AO's normals: Showroom.foldEffects), which draw every
// mesh with one material of theirs: so what takes part is told by the mesh's
// geometry, a `foldMode` attribute (foldify; none = never touched: the car,
// the sky):
//   1 object: shrinks onto its own origin (a prop, a tree, a title; an
//     instanced or batched mesh: each instance onto its origin, a tree into
//     the ground under its trunk)
//   2 floor: a big flat mesh (ground, road, terrain tile): turns white
//   3 pieces: a big or far-off-centre mesh (merged things): each triangle
//     shrinks onto its centre (`foldCenter`; indexed geometry is made
//     non-indexed for that)
// A channel = the uniforms its materials share: the sets use one, the home
// screen's 3D titles their own.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

export const FOLD_IDLE = 0, FOLD_OUT = 1, FOLD_IN = 2, FOLD_GONE = 3;
export const FOLD_NONE = 0, FOLD_OBJECT = 1, FOLD_FLOOR = 2, FOLD_PIECES = 3;

const FLOOR_SIZE = 9; // m: a flat mesh wider than that is ground
const PIECES_SIZE = 7; // m: a mesh bigger than that (or whose origin is off it) shrinks in pieces

export function foldChannel() {

	return {
		uFoldOrigin: { value: new THREE.Vector3() },
		uFoldRadius: { value: 0 }, // m: where the wave is
		uFoldWidth: { value: 5 }, // m from a thing starting to shrink to gone
		uFoldState: { value: FOLD_IDLE },
		uFoldWhite: { value: new THREE.Color( 1, 1, 1 ) }, // what the ground turns to
	};

}

const PARS = /* glsl */`
uniform vec3 uFoldOrigin;
uniform float uFoldRadius;
uniform float uFoldWidth;
uniform float uFoldState;
attribute vec3 foldCenter;
attribute float foldMode;
varying vec3 vFoldWorld;
varying float vFoldFloor;
float foldHash( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
`;

// After batching_vertex (batchingMatrix is a local of main()): how far this
// thing has shrunk, and onto what
const SETUP = /* glsl */`
	float foldS = 1.0;
	vec3 foldC = vec3( 0.0 );
	float foldFloor = foldMode > 1.5 && foldMode < 2.5 ? 1.0 : 0.0;
	#if ! defined( USE_INSTANCING ) && ! defined( USE_BATCHING )
		if ( foldMode > 2.5 ) foldC = foldCenter;
	#endif
	vFoldFloor = foldFloor;
	if ( uFoldState > 0.5 && foldMode > 0.5 && foldFloor < 0.5 ) {
		vec4 w = vec4( foldC, 1.0 );
		#ifdef USE_BATCHING
			w = batchingMatrix * w;
		#endif
		#ifdef USE_INSTANCING
			w = instanceMatrix * w;
		#endif
		w = modelMatrix * w;
		float h = foldHash( floor( w.xyz * 7.0 ) );
		float d = length( w.xz - uFoldOrigin.xz ) + h * uFoldWidth * 0.5; // a ragged front
		float p = clamp( ( uFoldRadius - d ) / uFoldWidth, 0.0, 1.0 );
		p = p * p * ( 3.0 - 2.0 * p );
		foldS = uFoldState > 2.5 ? 0.0 : uFoldState > 1.5 ? p : 1.0 - p;
	}
`;

const FRAGMENT_PARS = /* glsl */`
uniform vec3 uFoldOrigin;
uniform float uFoldRadius;
uniform float uFoldWidth;
uniform float uFoldState;
uniform vec3 uFoldWhite;
varying vec3 vFoldWorld;
varying float vFoldFloor;
float foldHash3( vec3 p ) {
	p = fract( p * 0.3183099 + 0.1 );
	p *= 17.0;
	return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float foldNoise( vec3 x ) {
	vec3 i = floor( x ), f = fract( x );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( foldHash3( i ), foldHash3( i + vec3( 1, 0, 0 ) ), f.x ),
		mix( foldHash3( i + vec3( 0, 1, 0 ) ), foldHash3( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( foldHash3( i + vec3( 0, 0, 1 ) ), foldHash3( i + vec3( 1, 0, 1 ) ), f.x ),
		mix( foldHash3( i + vec3( 0, 1, 1 ) ), foldHash3( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
`;

// The ground's white: a ragged front a little ahead of the shrinking
const FRAGMENT_WHITE = /* glsl */`
	if ( vFoldFloor > 0.5 && uFoldState > 0.5 ) {
		float n = foldNoise( vFoldWorld * 0.45 ) * 0.7 + foldNoise( vFoldWorld * 1.6 ) * 0.3;
		float d = length( vFoldWorld.xz - uFoldOrigin.xz ) + ( n - 0.5 ) * uFoldWidth * 0.8;
		float p = smoothstep( 0.0, 1.0, ( uFoldRadius + uFoldWidth * 0.3 - d ) / ( uFoldWidth * 0.25 ) );
		float white = uFoldState > 2.5 ? 1.0 : uFoldState > 1.5 ? 1.0 - p : p;
		diffuseColor.rgb = mix( diffuseColor.rgb, uFoldWhite, white );
	}
`;

function inject( shader, channel ) {

	Object.assign( shader.uniforms, channel );
	let v = shader.vertexShader.replace( '#include <common>', '#include <common>\n' + PARS );
	v = v.includes( '#include <batching_vertex>' )
		? v.replace( '#include <batching_vertex>', '#include <batching_vertex>\n' + SETUP )
		: v.replace( /void\s+main\s*\(\s*\)\s*\{/, ( m ) => m + '\n' + SETUP );
	v = v.replace( '#include <project_vertex>', 'transformed = foldC + ( transformed - foldC ) * foldS;\nvFoldWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n#include <project_vertex>' );
	shader.vertexShader = v;

	let f = shader.fragmentShader.replace( '#include <common>', '#include <common>\n' + FRAGMENT_PARS );
	f = f.includes( '#include <color_fragment>' )
		? f.replace( '#include <color_fragment>', '#include <color_fragment>\n' + FRAGMENT_WHITE )
		: f.replace( '#include <map_fragment>', '#include <map_fragment>\n' + FRAGMENT_WHITE );
	shader.fragmentShader = f;

}

// How a mesh goes (FOLD_OBJECT / FLOOR / PIECES), from its size in the world
function foldModeOf( o ) {

	if ( o.userData.foldMode !== undefined ) return o.userData.foldMode;
	const g = o.geometry;
	if ( ! g.boundingBox ) g.computeBoundingBox();
	o.updateWorldMatrix( true, false );
	_box.copy( g.boundingBox ).applyMatrix4( o.matrixWorld ).getSize( _size );
	const wide = Math.max( _size.x, _size.z );
	if ( o.userData.floor || ( wide > FLOOR_SIZE && _size.y < wide * 0.2 ) ) return FOLD_FLOOR;
	// Its origin off the geometry (merged things placed in the world): shrinking onto it would slide them
	g.boundingBox.getCenter( _a );
	g.boundingBox.getSize( _b );
	if ( wide > PIECES_SIZE || _a.length() > _b.length() * 0.75 + 0.5 ) return FOLD_PIECES;
	return FOLD_OBJECT;

}

export function setFoldMode( geometry, mode ) {

	const n = geometry.attributes.position.count;
	const a = geometry.attributes.foldMode;
	if ( a && a.count === n && a.array[ 0 ] === mode ) return;
	geometry.setAttribute( 'foldMode', new THREE.BufferAttribute( new Float32Array( n ).fill( mode ), 1 ) );

}


const patched = new WeakSet();

// Makes a material fold with a channel (once; materials already compiled
// recompile, so patch before the first frame where possible)
export function foldMaterial( material, channel ) {

	if ( patched.has( material ) ) return material;
	patched.add( material );

	const before = material.onBeforeCompile;
	const key = material.customProgramCacheKey;
	// three's default key is the onBeforeCompile source: keep the original's
	const baseKey = key === THREE.Material.prototype.customProgramCacheKey ? () => before.toString() : () => key.call( material );
	material.onBeforeCompile = function ( shader, renderer ) {

		before.call( this, shader, renderer );
		inject( shader, channel );

	};

	material.customProgramCacheKey = () => baseKey() + '|fold';

	material.needsUpdate = true;
	return material;

}

const flattened = new WeakMap(); // indexed geometry → its non-indexed copy with foldCenter

// Every triangle's centre on each of its vertices
export function addFoldCenters( geometry ) {

	if ( geometry.index ) {

		let copy = flattened.get( geometry );

		if ( ! copy ) {

			copy = geometry.toNonIndexed();
			addFoldCenters( copy );
			flattened.set( geometry, copy );
			geometry.addEventListener( 'dispose', () => copy.dispose() ); // owners dispose the geometry they built

		}

		return copy;

	}

	if ( geometry.attributes.foldCenter ) return geometry;

	const position = geometry.attributes.position;
	const centers = new Float32Array( position.count * 3 );

	for ( let i = 0; i + 2 < position.count; i += 3 ) {

		_a.fromBufferAttribute( position, i );
		_b.fromBufferAttribute( position, i + 1 );
		_c.fromBufferAttribute( position, i + 2 );
		_a.add( _b ).add( _c ).multiplyScalar( 1 / 3 );

		for ( let k = 0; k < 3; k ++ ) _a.toArray( centers, ( i + k ) * 3 );

	}

	geometry.setAttribute( 'foldCenter', new THREE.BufferAttribute( centers, 3 ) );
	return geometry;

}

// One shadow-pass material per channel, shrinking like the rest
const depths = new WeakMap();

function depthMaterial( channel ) {

	if ( ! depths.has( channel ) ) depths.set( channel, foldMaterial( new THREE.MeshDepthMaterial( { depthPacking: THREE.RGBADepthPacking } ), channel ) );
	return depths.get( channel );

}

// Everything under root goes and comes with the channel; cheap to call again
// (new chunks of a streaming stage), objects already done are skipped (and
// those marked userData.folded beforehand: the garage's plinth)
export function foldify( root, channel ) {

	root.traverse( ( o ) => {

		if ( o.userData.folded || ! o.isMesh ) return;
		o.userData.folded = true;

		if ( ! o.geometry.attributes.position ) return;
		if ( o.isInstancedMesh || o.isBatchedMesh ) setFoldMode( o.geometry, FOLD_OBJECT );
		else {

			const mode = foldModeOf( o );
			if ( mode === FOLD_PIECES ) o.geometry = addFoldCenters( o.geometry );
			setFoldMode( o.geometry, mode );

		}
		for ( const m of Array.isArray( o.material ) ? o.material : [ o.material ] ) foldMaterial( m, channel );
		// Its shadow shrinks with it (not a full-size shadow left on the white)
		if ( o.castShadow && ! o.customDepthMaterial ) o.customDepthMaterial = depthMaterial( channel );

	} );

}

// One wave: out (everything goes, nearest the car first) or in (everything
// comes, from under the car). radius = how far the fold reaches when done
export class FoldWave {

	constructor( channel ) {

		this.channel = channel;
		this.state = FOLD_IDLE;
		this.time = 0;
		this.duration = 1;
		this.reach = 20;
		this.resolve = null;

	}

	// state FOLD_OUT or FOLD_IN; origin = the car's position
	run( state, origin, { duration = 1.1, reach = 20, width = 5 } = {} ) {

		this.finish(); // a wave still running is cut short
		const ch = this.channel;
		ch.uFoldState.value = state;
		ch.uFoldOrigin.value.copy( origin );
		ch.uFoldWidth.value = width;
		ch.uFoldRadius.value = state === FOLD_IN ? - width : 0;
		this.state = state;
		this.time = 0;
		this.duration = duration;
		this.reach = reach;
		return new Promise( ( resolve ) => { this.resolve = resolve; } );

	}

	// Instant states: everything shown (idle) or nothing (gone)
	set( state ) {

		this.finish();
		this.state = state;
		this.channel.uFoldState.value = state;

	}

	get running() {

		return this.state === FOLD_OUT || this.state === FOLD_IN;

	}

	// 0..1 of the running wave
	get progress() {

		return this.running ? Math.min( 1, this.time / this.duration ) : 1;

	}

	update( dt ) {

		if ( ! this.running ) return;
		this.time += dt;
		const t = Math.min( 1, this.time / this.duration );
		// Out: starts briskly under the car, sweeps away; in: grows out of the car
		const e = this.state === FOLD_OUT ? t * t * ( 2 - t ) * 0.6 + t * 0.4 : 1 - Math.pow( 1 - t, 2.2 );
		const w = this.channel.uFoldWidth.value;
		this.channel.uFoldRadius.value = - w + e * ( this.reach + w * 2.6 );
		if ( t >= 1 ) this.finish();

	}

	finish() {

		if ( ! this.running ) return;
		const done = this.state === FOLD_OUT ? FOLD_GONE : FOLD_IDLE;
		this.state = done;
		this.channel.uFoldState.value = done;
		const resolve = this.resolve;
		this.resolve = null;
		if ( resolve ) resolve();

	}

}
