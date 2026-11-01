import * as THREE from 'three';

// One GLB fetch and shared GPU geometry/materials for every racer.
let template;
const WHEELS = { FL: 'wheel-front-left', FR: 'wheel-front-right', BL: 'wheel-back-left', BR: 'wheel-back-right' };

export function loadYaris( loader ) {
	if ( ! template ) template = new Promise( ( resolve, reject ) => {
		loader.load( 'models/yaris.glb', gltf => {
			const content = gltf.scene;
			content.scale.setScalar( 0.5 );
			content.traverse( node => {
				if ( WHEELS[ node.name ] ) node.name = WHEELS[ node.name ];
				else if ( node.name === 'car' ) node.name = 'body';
				if ( node.isMesh ) node.castShadow = node.receiveShadow = true;
			} );
			// Stretch around the tyre contact plane, not around the chassis centre.
			content.updateMatrixWorld( true );
			content.position.y -= new THREE.Box3().setFromObject( content ).min.y;
			const visual = new THREE.Group();
			visual.name = 'YarisVisual';
			visual.userData.yaris = true;
			visual.userData.bodyY = content.getObjectByName( 'body' )?.position.y ?? 0;
			const stretch = new THREE.Group();
			stretch.name = 'YarisStretch';
			stretch.add( content );
			visual.add( stretch );
			resolve( visual );
		}, undefined, error => { template = null; reject( error ); } );
	} );
	return template.then( model => model.clone( true ) );
}
