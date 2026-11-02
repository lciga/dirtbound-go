import * as THREE from 'three';

// One GLB fetch and shared GPU geometry/materials for every racer.
let template;
const variants=new Map();
const palettes=[[0xe5e8e2,0xcc2e32],[0x3a7ba9,0xf2c94c],[0x233c69,0xe5e8e2],[0x75a542,0x242b32],[0xf2c23a,0x282f36]];
export const YARIS_PAINTS = palettes.map( ( [ paint ] ) => `#${ paint.toString( 16 ).padStart( 6, '0' ) }` );
const WHEELS = { FL: 'wheel-front-left', FR: 'wheel-front-right', BL: 'wheel-back-left', BR: 'wheel-back-right' };

export function loadYaris( loader, color=1 ) {
	if ( ! template ) template = new Promise( ( resolve, reject ) => {
		loader.load( 'models/yaris.glb', gltf => {
			const content = gltf.scene;
			content.scale.setScalar( 0.46 );
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
			visual.userData.yarisModel = true;
 visual.userData.yaris = false;
			visual.userData.bodyY = content.getObjectByName( 'body' )?.position.y ?? 0;
			const stretch = new THREE.Group();
			stretch.name = 'YarisStretch';
			stretch.add( content );
			visual.add( stretch );
			resolve( visual );
		}, undefined, error => { template = null; reject( error ); } );
	} );
	return template.then( model => {
 const variant=Math.min(5,Math.max(1,Math.round(color)||1));
 if(!variants.has(variant)){
  const styled=model.clone(true),base=new THREE.Color(0xe5e8e2),accent=new THREE.Color(0xcc2e32),[paintColor,stripeColor]=palettes[variant-1].map(c=>new THREE.Color(c));
  const matches=(a,i,c)=>Math.abs(a.getX(i)-c.r)<.008&&Math.abs(a.getY(i)-c.g)<.008&&Math.abs(a.getZ(i)-c.b)<.008;
  styled.traverse(n=>{if(n.isMesh&&n.name==='body'){
   n.geometry=n.geometry.clone();const colors=n.geometry.attributes.color;
   for(let i=0;i<colors.count;i++){const c=matches(colors,i,base)?paintColor:matches(colors,i,accent)?stripeColor:null;if(c)colors.setXYZ(i,c.r,c.g,c.b);}
  }});
  variants.set(variant,styled);
 }
 return variants.get(variant).clone(true);
 });
}
