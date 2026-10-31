import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let material;
function decalMaterial() {

	if ( ! material ) {

		const map = new THREE.TextureLoader().load( 'images/iskander-car.jpg' );
		map.colorSpace = THREE.SRGBColorSpace;
		material = new THREE.MeshStandardMaterial( {
			map, roughness: 0.7, metalness: 0,
			polygonOffset: true, polygonOffsetFactor: - 4, polygonOffsetUnits: - 4,
			depthWrite: false,
		} );

	}
	return material;

}

// Project onto both door panels in the body's frame. The two patches are
// merged into one mesh/material, so every livery keeps a single extra draw.
export function addCarDecal( model, stickerMaterial = null ) {

	if ( model.getObjectByName( 'iskander-decal' ) ) return model;
	const body = model.getObjectByName( 'body' ) || model;
	model.updateMatrixWorld( true );
	const surfaces = [];
	body.traverse( ( o ) => {

		if ( ! o.isMesh || /wheel/i.test( o.name ) ) return;
		const materials = Array.isArray( o.material ) ? o.material : [ o.material ];
		if ( materials.some( ( m ) => /Vinyls|Lights/i.test( m.name ) ) ) return;
		surfaces.push( o );

	} );
	if ( ! surfaces.length ) return model;
	const box = new THREE.Box3();
	for ( const mesh of surfaces ) box.union( new THREE.Box3().setFromObject( mesh ) );
	const size = box.getSize( new THREE.Vector3() );
	const center = box.getCenter( new THREE.Vector3() );
	const front = model.getObjectByName( 'wheel-front-left' );
	const rear = model.getObjectByName( 'wheel-back-left' );
	const frontAt = front?.getWorldPosition( new THREE.Vector3() );
	const rearAt = rear?.getWorldPosition( new THREE.Vector3() );
	const wheelHeight = rear ? new THREE.Box3().setFromObject( rear ).getSize( new THREE.Vector3() ).y : size.y * 0.5;
	const wheelbase = frontAt && rearAt ? Math.abs( frontAt.z - rearAt.z ) : size.z * 0.55;
	const width = Math.min( size.y * ( body.isMesh ? 0.35 : 0.4 ), size.z * 0.18, wheelbase * 0.4 );
	// Front doors, below the windows and between the wheel arches.
	// The pickup's single mesh includes its cargo bed: its cab door sits
	// forward of the wheelbase centre; rally body groups have longer doors.
	const frontWeight = body.isMesh ? 0.65 : 0.35;
	const z = frontAt && rearAt ? frontAt.z * frontWeight + rearAt.z * ( 1 - frontWeight ) : center.z + size.z * 0.08;
	const y = Math.max( ( rearAt?.y ?? box.min.y ) + wheelHeight * 0.45, box.min.y + width * ( body.isMesh ? 0.85 : 0.55 ) );
	const projector = new THREE.Vector3( width, width, size.x * 0.09 );
	const parts = [], sides = [];

	for ( const side of [ - 1, 1 ] ) {

		const origin = new THREE.Vector3( side > 0 ? box.max.x + 1 : box.min.x - 1, y, z );
		const ray = new THREE.Raycaster( origin, new THREE.Vector3( - side, 0, 0 ) );
		const hit = ray.intersectObjects( surfaces, false ).find( ( h ) => h.face.normal.clone().transformDirection( h.object.matrixWorld ).x * side > 0.65 );
		if ( ! hit ) continue;
		const orientation = new THREE.Euler( 0, side * Math.PI / 2, 0 );
		let added = false;
		for ( const mesh of surfaces ) {

			const projection = new DecalGeometry( mesh, hit.point, orientation, projector );
			// Keep the side skin only; never wrap the image over the roof or sill.
			const normal = projection.attributes.normal;
			const indices = [];
			for ( let i = 0; normal && i < normal.count; i += 3 ) {

				if ( ( normal.getX( i ) + normal.getX( i + 1 ) + normal.getX( i + 2 ) ) * side / 3 > 0.55 ) indices.push( i, i + 1, i + 2 );

			}
			if ( indices.length ) {

				projection.setIndex( indices );
				parts.push( projection.toNonIndexed() );
				added = true;

			}
			projection.dispose();

		}
		if ( added ) sides.push( side );

	}
	const geometry = parts.length ? mergeGeometries( parts ) : null;
	for ( const part of parts ) part.dispose();
	if ( ! geometry ) return model;
	geometry.applyMatrix4( body.matrixWorld.clone().invert() );
	const decal = new THREE.Mesh( geometry, stickerMaterial || decalMaterial() );
	decal.name = 'iskander-decal';
	decal.userData.sides = sides;
	decal.receiveShadow = true;
	decal.renderOrder = 2;
	body.add( decal );
	return model;

}
