// Ordinary arcade stages retain their original scale. Beta uses the same
// half-scale metres as the Go powertrain and car models.
export const BETA_METRES_PER_WORLD = 2;
export const BETA_RALLY_FEATURE_SCALE = 6;
export function speedKmh(velocity, metresPerWorld = BETA_METRES_PER_WORLD) {
 return Math.hypot(velocity.x, velocity.y || 0, velocity.z) * metresPerWorld * 3.6;
}
export function worldLength(metres, metresPerWorld = BETA_METRES_PER_WORLD) {
 if (!Number.isFinite(metresPerWorld) || metresPerWorld <= 0) throw new RangeError('Invalid world scale');
 return metres > 0 ? metres / metresPerWorld : 0;
}
