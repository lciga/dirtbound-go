// Optional microbenchmark. Compare an existing baseline binary passed as argv[2].
// This measures JS↔WASM calls, not frame rate or rendering performance.
import fs from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { performance } from "node:perf_hooks";
globalThis.crypto ??= webcrypto;
await import("../web/wasm/wasm_exec.js");
async function load(path) {
  const go = new Go();
  const { instance } = await WebAssembly.instantiate(
    await fs.readFile(path),
    go.importObject,
  );
  go.run(instance);
  return globalThis.DirtboundGo;
}
const baseline = process.argv[2] ? await load(process.argv[2]) : null,
  current = await load("web/wasm/physics.wasm");
function run(api, steps) {
  let sum = 0;
  const start = performance.now();
  for (let i = 0; i < steps; i++) {
    const out = api.advance(
      12,
      0.1,
      2,
      1 / 120,
      0.4,
      1,
      false,
      0,
      false,
      1,
      2,
      0.3,
    );
    sum += out[0] + out[3];
    const drift = api.drift(12, 0.3, 2, 1, 2, 0.3, false);
    sum += drift[1];
  }
  return { ms: performance.now() - start, sum };
}
for (const api of [baseline, current].filter(Boolean)) run(api, 5000);
const before = [],
  after = [];
let checksum = true;
for (let i = 0; i < 7; i++) {
  const a = baseline ? run(baseline, 30000) : null,
    b = run(current, 30000);
  if (a) {
    before.push(a.ms);
    checksum &&= a.sum === b.sum;
  }
  after.push(b.ms);
}
const median = (list) =>
  list.sort((a, b) => a - b)[Math.floor(list.length / 2)];
const result = {
  benchmark: "30000 advance+drift pairs, median of 7, warmed runtime",
  currentMs: median(after),
  sameChecksum: checksum,
  limitation: "JS/WASM call microbenchmark; not game FPS",
};
if (baseline) {
  result.baselineMs = median(before);
  result.changePercent = (result.currentMs / result.baselineMs - 1) * 100;
}
console.log(JSON.stringify(result, null, 2));
process.exit(checksum ? 0 : 1);
