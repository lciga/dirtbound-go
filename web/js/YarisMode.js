// Visual-only squash/stretch adapted from the user's UralCUP yaris reference.
// Never scale the vehicle container or the physics body.
export const YARIS_CAR = 'Toyota Yaris';
export const YARIS_TRACK_ID = 'niko-b-whys-this-dealer-guy-arthur-remix';
export const YARIS_TRACK = Object.freeze( {
	id: YARIS_TRACK_ID, artist: 'Niko B', title: 'Why’s This Dealer? (Guy Arthur Remix)',
	src: 'audio/music/club/' + YARIS_TRACK_ID + '.m4a', bpm: 122, offset: 0, calm: [],
} );

export function yarisScale( time, phase = 0, out = {} ) {
	const c = ( ( time * 2.2 + phase / ( Math.PI * 2 ) ) % 1 + 1 ) % 1;
	const s = c < 0.12 ? c / 0.12 : 1 - ( c - 0.12 ) / 0.88;
	out.x = out.z = 0.8 + 0.4 * s;
	out.y = 1.2 - 0.4 * s;
	return out;
}

export function stretchYaris( visual, time ) {
	if ( ! visual?.userData.yaris ) return;
	yarisScale( Math.max( 0, time ), 0, visual.children[ 0 ].scale );
}
