// Ambiances lumineuses de DirtBound : change les valeurs, enregistre, recharge la page.
// Couleurs en hexadécimal CSS : '#rrggbb'. Pour en créer de nouvelles à l'œil :
// lab/atmo.html (« Copier tout » donne des blocs au même format).
//
// Chaque ambiance :
//   sun       lumière directe, celle qui fait les ombres : teinte + force
//   ambient   lumière du ciel (dessus des objets) et du sol (dessous) + force
//   brightness  luminosité globale de l'image : 0.8 plus sombre, 1 normal, 1.2 plus clair
//   fog       couleur du brouillard (c'est aussi celle du ciel) + densité :
//             1 normal, 2 deux fois plus dense, 0.5 moitié moins, 0 aucun

export const PRESETS = {

	// Celle d'origine du jeu
	classic: {
		sun: { color: '#ffffff', intensity: 3 },
		ambient: { sky: '#c8d8e8', ground: '#7a8a5a', intensity: 2 },
		brightness: 1,
		fog: { color: '#adb2ba', density: 1 },
	},

	// Cinematic Dark Fog : lumière froide et dure, ombres noires, brume épaisse
	cinematic: {
		sun: { color: '#5cabff', intensity: 8 },
		ambient: { sky: '#000000', ground: '#000000', intensity: 2 },
		brightness: 1,
		fog: { color: '#d4d4d4', density: 5 },
	},

	sunset: {
		sun: { color: '#ff7a7a', intensity: 8 },
		ambient: { sky: '#febebe', ground: '#000000', intensity: 1 },
		brightness: 1,
		fog: { color: '#ffa052', density: 0.65 },
	},

	day: {
		sun: { color: '#fffbf0', intensity: 3.5 },
		ambient: { sky: '#c9cbe8', ground: '#605b8b', intensity: 2 },
		brightness: 1,
		fog: { color: '#c8cfda', density: 1.1 },
	},

};

// Quelle ambiance où : le nom d'une ambiance ci-dessus
export const USE = {
	game: 'classic', // les courses (circuits et spéciales) et l'éditeur
	menu: 'cinematic', // le menu principal
};

export default PRESETS[ USE.game ];
