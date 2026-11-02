import * as THREE from 'three';
import { loadSecureAsset } from './SecureAssets.js';
import { CAR_STYLE } from './CarStyle.js';

// "ARCADE Rally Cars" pack, converted by tools/convert_rally_cars.py into
// models/rally/<Name>.glb (parts named like the Kenney trucks: body,
// wheel-front-left, ...), then encrypted by tools/pack_rally_cars.mjs: the
// game only loads the packed copies (SecureAssets.js), models/rally/ is never
// deployed (paid asset). The GLBs carry no images: the textures are shared
// by every car and swapped per colour variant (1-5), by material name —
// Vinyls (stickers, alpha), Lights, anything else is the colour atlas.

export const RALLY_CARS = [
	'Alpine A110',
	'Audi Quattro S1',
	'BMW E30',
	'Cupra Leon WTCC',
	'Ford Escort RS Cosworth',
	'Ford Escort RS200',
	'Ford Focus',
	'Hyundai I20 N',
	'Lancia 037',
	'Lancia Delta HF',
	'Lancia Fulvia',
	'Mitsubishi Lancer EVO VIII',
	'Subaru Impreza',
	'Subaru Impreza WRC2008',
	'Suzuki Pikes Peak Escudo',
	'Toyota Celica',
	'Volkswagen Golf',
];

export const RALLY_COLORS = 5;

const textures = new Map();

// Returned at once and filled when the packed image is decoded
function texture( file ) {

	if ( ! textures.has( file ) ) {

		const t = new THREE.Texture();
		t.colorSpace = THREE.SRGBColorSpace;
		t.flipY = false; // glTF UV convention (ImageBitmaps are never flipped anyway)
		textures.set( file, t );

		loadSecureAsset( 'tex/' + file )
			.then( ( data ) => createImageBitmap( new Blob( [ data ], { type: 'image/png' } ), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } ) )
			.then( ( bitmap ) => {

				t.image = bitmap;
				t.needsUpdate = true;

			} )
			.catch( ( e ) => console.error( `Rally car texture ${ file }:`, e ) );

	}

	return textures.get( file );

}

// Case, spaces and punctuation ignored: "audi-quattro-s1" finds "Audi Quattro S1"
const simplify = ( name ) => String( name ).toLowerCase().replace( /[^a-z0-9]/g, '' );

// Resolves to the car's scene, ready for Vehicle.init. `name` is matched
// loosely against RALLY_CARS (see simplify); unknown names reject.
export function loadRallyCar( loader, name, color = 1 ) {

	const match = RALLY_CARS.find( ( n ) => simplify( n ) === simplify( name ) );
	if ( ! match ) return Promise.reject( new Error( `Unknown rally car "${ name }"` ) );

	const variant = Math.min( RALLY_COLORS, Math.max( 1, Math.round( color ) || 1 ) );

	return loadSecureAsset( 'car/' + match ).then( ( data ) => new Promise( ( resolve, reject ) => {

		loader.parse( data, '', ( gltf ) => {

			gltf.scene.traverse( ( child ) => {

				if ( ! child.isMesh ) return;

				const m = child.material;
				m.color.set( 0xffffff ); // exported as 0.8 grey
				m.metalness = CAR_STYLE.metalness; // glTF default is fully metallic
				m.roughness = CAR_STYLE.roughness;
				m.side = THREE.FrontSide;

				if ( m.name === 'Vinyls' ) {

					m.map = texture( `vinyls-${ variant }.png` );
					m.alphaTest = 0.5;
					// Stickers lie right on the body: pull them forward in depth
					m.polygonOffset = true;
					m.polygonOffsetFactor = - 1;
					m.polygonOffsetUnits = - 1;

				} else if ( m.name === 'Lights' ) {

					m.map = texture( 'lights.png' );

				} else {

					m.map = texture( `color-${ variant }.png` );

				}

				m.needsUpdate = true;

			} );

			// Same convention as the Kenney trucks (main.js scales vehicles by 0.5)
			gltf.scene.scale.setScalar( CAR_STYLE.runtimeScale );

			// The body's rest height, which Vehicle.js springs it back to (the
			// trucks use 0.3; this pack has the body origin on the ground)
			gltf.scene.userData.bodyY = 0;

			resolve( gltf.scene );

		}, reject );

	} ) );

}
