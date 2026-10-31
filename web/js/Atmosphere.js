import * as THREE from 'three';
import ATMOSPHERE, { PRESETS, USE } from '../config/atmosphere.js';

// The menu's own mood (config: USE.menu), falling back to the game's
export const MENU_ATMOSPHERE = PRESETS[ USE.menu ] || ATMOSPHERE;
export { PRESETS };

// Applies config/atmosphere.js (sun tint and strength, ambient light,
// brightness, fog colour and density) to a scene. The fog colour is also the
// sky colour, so the horizon always blends into it. Both functions take an
// optional config of the same shape instead of the file (lab/atmo.html).

export { ATMOSPHERE };

// lights: { sun: DirectionalLight, ambient: HemisphereLight }. scale lets a
// view keep its own balance (the editor lights harder) while following the
// config: its intensities are multiplied by the config's.
export function applyAtmosphere( { scene, renderer, sun, ambient }, scale = {}, config = ATMOSPHERE ) {

	const { sun: s, ambient: a, brightness, fog } = config;

	renderer.toneMappingExposure = brightness;
	scene.background = new THREE.Color( fog.color );

	if ( sun ) {

		sun.color.set( s.color );
		sun.intensity = s.intensity * ( scale.sun ?? 1 );

	}

	if ( ambient ) {

		ambient.color.set( a.sky );
		ambient.groundColor.set( a.ground );
		ambient.intensity = a.intensity * ( scale.ambient ?? 1 );

	}

	if ( scale.fog !== false ) scene.fog = fog.density > 0 ? new THREE.Fog( fog.color, 1, 1000 ) : null;

}

// Sets where the fog starts and is complete, for density 1; a denser fog
// closes in proportionally (density 2 = half the distances)
export function setFogRange( scene, near, far, config = ATMOSPHERE ) {

	if ( ! scene.fog ) return;
	const density = config.fog.density;
	scene.fog.near = near / density;
	scene.fog.far = far / density;

}
