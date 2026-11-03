import * as THREE from 'three';
import { CAR_STYLE } from './CarStyle.js';

// One mesh download; racers and paint variants share all GPU geometry.
let template;
const variants = new Map();
export const YARIS_PAINTS = [ '#eb4896', '#3078c6', '#1e345d', '#75a542', '#f2c23a' ];
const WHEELS = { FL: 'wheel-front-left', FR: 'wheel-front-right', BL: 'wheel-back-left', BR: 'wheel-back-right' };

async function paintVariant( model, variant, manager ) {

 const styled = model.clone( true );
 if ( variant !== 1 ) {
  const bitmap = await new THREE.ImageBitmapLoader( manager )
   .setOptions( { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } )
   .loadAsync( `models/yaris/wrap-${ variant }.jpg` );
  const atlas = new THREE.Texture( bitmap );
  atlas.flipY = false;
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  atlas.needsUpdate = true;
  const body = styled.getObjectByName( 'body' );
  body.material = body.material.clone();
  body.material.map = atlas;
  body.material.needsUpdate = true;
 }
 return styled;

}

export function loadYaris( loader, color = 1 ) {

 if ( ! template ) template = new Promise( ( resolve, reject ) => {
  loader.load( 'models/yaris.glb', gltf => {
   const content = gltf.scene;
   content.scale.setScalar( CAR_STYLE.runtimeScale );
   content.traverse( node => {
    if ( WHEELS[ node.name ] ) node.name = WHEELS[ node.name ];
    else if ( node.name === 'car' ) node.name = 'body';
    if ( node.isMesh ) {
     node.castShadow = node.receiveShadow = true;
     for ( const material of [ node.material ].flat() ) {
      if ( material.map ) material.map.anisotropy = 4;
     }
    }
   } );
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
  const variant = Math.min( 5, Math.max( 1, Math.round( color ) || 1 ) );
  if ( ! variants.has( variant ) ) {
   const pending = paintVariant( model, variant, loader.manager ).catch( error => {
    variants.delete( variant );
    throw error;
   } );
   variants.set( variant, pending );
  }
  return variants.get( variant ).then( styled => styled.clone( true ) );
 } );

}
