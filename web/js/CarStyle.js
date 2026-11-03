// Shared visual contract for the rally pack and every newly built car.
export const CAR_STYLE = Object.freeze({
 runtimeScale: .5,
 roughness: .6,
 metalness: 0,
 referenceModelScale: .86,
 wheelSides: 12,
 maxTriangles: 5000,
 maxDrawCalls: 9,
 maxModelBytes: 300000,
 // Explicit exception for the source-based GR Yaris approved on 2026-11-03.
 reviewedYaris: Object.freeze({ maxTriangles: 15000, maxDrawCalls: 9, maxModelBytes: 650000 }),
});
