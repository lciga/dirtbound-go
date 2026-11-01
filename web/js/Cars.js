import { RALLY_CARS, loadRallyCar } from './RallyCars.js';
import { loadYaris } from './YarisCar.js';
import { YARIS_CAR } from './YarisMode.js';

// Every drivable car, for the garage and the game: the Kenney truck (four
// paint jobs as liveries) and the rally pack (five liveries each).

export const TRUCK_COLORS = [ 'yellow', 'green', 'purple', 'red' ];

export const CARS = [
	{ id: 'truck', label: 'Club Pick-up', liveries: TRUCK_COLORS.length },
	{ id: YARIS_CAR, label: YARIS_CAR, liveries: 1, modeOnly: 'yaris' },
	...RALLY_CARS.map( ( name ) => ( { id: name, label: name, liveries: 5 } ) ),
];

// What the garage offers: the rally pack only (the truck still drives
// through ?car=truck and old saves are moved onto a rally car)
export const GARAGE_CARS = CARS.filter( ( c ) => c.id !== 'truck' && ! c.modeOnly );

export function findCar( id ) {

	const simple = ( s ) => String( s ).toLowerCase().replace( /[^a-z0-9]/g, '' );
	return CARS.find( ( c ) => simple( c.id ) === simple( id ) ) || null;

}

// Resolves to a model ready for Vehicle.init. Unknown ids reject.
export function loadCar( loader, id, livery = 1 ) {

	const car = findCar( id );
	if ( ! car ) return Promise.reject( new Error( `Unknown car "${ id }"` ) );
	if ( car.id === YARIS_CAR ) return loadYaris( loader );

	if ( car.id !== 'truck' ) return loadRallyCar( loader, car.id, livery );

	const paint = TRUCK_COLORS[ ( Math.max( 1, Math.round( livery ) || 1 ) - 1 ) % TRUCK_COLORS.length ];

	return new Promise( ( resolve, reject ) => {

		loader.load( `models/vehicle-truck-${ paint }.glb`, ( gltf ) => {

			// Godot imports vehicle models at root_scale=0.5
			gltf.scene.scale.setScalar( 0.5 );
			resolve( gltf.scene );

		}, undefined, reject );

	} );

}
