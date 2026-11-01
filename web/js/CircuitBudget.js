// Rendering budgets are shared by every published/editor circuit.
export const CIRCUIT_BUDGET = Object.freeze({
 groundCell: 64, forestCell: 64, forestReach: 45, maxForestCells: 1200,
 maxProbeAxis: 4, maxProbeTerrainChunks: 48, maxProbeLength: 1200,
});
export function selectForestCells(cells) {
 if(cells.length<=CIRCUIT_BUDGET.maxForestCells)return cells;
 // Uniform deterministic thinning over the entire route, independent of spawn.
 const hash=c=>{let n=Math.imul(c.gx,374761393)^Math.imul(c.gz,668265263);n=Math.imul(n^(n>>>13),1274126177);return (n^(n>>>16))>>>0;};
 return cells.map(c=>({cell:c,score:hash(c)})).sort((a,b)=>a.score-b.score||a.cell.gx-b.cell.gx||a.cell.gz-b.cell.gz).slice(0,CIRCUIT_BUDGET.maxForestCells).map(c=>c.cell);
}
export function shouldBakeCircuitProbes(path,terrain){return (!path||path.length<=CIRCUIT_BUDGET.maxProbeLength)&&(!terrain||terrain.chunks.size<=CIRCUIT_BUDGET.maxProbeTerrainChunks);}
