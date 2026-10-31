// One visual season for the home, stages and circuits. URL overrides are
// useful for shared races; they do not change the saved preference.
export const THEME_SEASONS = [ 'summer', 'spring', 'autumn', 'winter' ];

export function themeSeason( settings = {}, override = null ) {

	return [ override, settings.season, settings.homeSeason, settings.rally?.season ]
		.find( ( id ) => THEME_SEASONS.includes( id ) ) || 'summer';

}

export function setThemeSeason( settings, id ) {

	if ( ! THEME_SEASONS.includes( id ) ) return;
	settings.season = settings.homeSeason = id;
	settings.rally = { ...settings.rally, season: id };

}
