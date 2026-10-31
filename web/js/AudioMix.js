// Relative levels before the user's engine/tyre volume controls.
// Keep the engine body below intake/valve transients instead of lowering
// their shared master, which would hide the turbo along with the engine.
export const RACE_AUDIO_MIX = Object.freeze( {

	combustion: 0.55, // -5.2 dB
	engineRaspDb: 3, // was +7 dB in the band occupied by the turbo
	tyres: 0.55, // -5.2 dB
	turbo: 1.35, // +2.6 dB
	backfire: 0.8, // headroom for the warmer exhaust EQ

} );
