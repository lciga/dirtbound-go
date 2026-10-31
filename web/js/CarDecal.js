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

// Project only onto the roof of the body. Attached to the body node, the
// sticker follows suspension lean and is cloned with the car/ghost.
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
	const ray = new THREE.Raycaster( new THREE.Vector3( center.x, box.max.y + 1, center.z ), new THREE.Vector3( 0, - 1, 0 ) );
	const hit = ray.intersectObjects( surfaces, false ).find( ( h ) => h.face.normal.clone().transformDirection( h.object.matrixWorld ).y > 0.65 );
	if ( ! hit ) return model;
	const width = Math.min( size.x * 0.62, size.z * 0.28 );
	const projector = new THREE.Vector3( width, width, Math.max( size.y * 0.15, 0.08 ) );
	const orientation = new THREE.Euler( - Math.PI / 2, 0, Math.PI );
	const parts = surfaces.map( ( mesh ) => new DecalGeometry( mesh, hit.point, orientation, projector ) );
	const projected = parts.filter( ( part ) => part.attributes.position.count > 0 );
	const geometry = projected.length ? mergeGeometries( projected ) : null;
	for ( const part of parts ) part.dispose();
	if ( ! geometry || ! geometry.attributes.position.count ) return model;
	geometry.applyMatrix4( body.matrixWorld.clone().invert() );
	const decal = new THREE.Mesh( geometry, stickerMaterial || decalMaterial() );
	decal.name = 'iskander-decal';
	decal.receiveShadow = true;
	decal.renderOrder = 2;
	body.add( decal );
	return model;

}
