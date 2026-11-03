// Install the approved authored model, preserving its exact geometry and UVs.
// Re-running the former procedural generator must never overwrite this model.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { CAR_STYLE } from '../web/js/CarStyle.js';
const source = new URL('./reference/yaris/', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', source), 'utf8'));
const bytes = await fs.readFile(new URL('approved.glb', source));
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256, 'Approved Yaris source changed; review the new export before importing it.');
assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
const model = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
let triangles = 0, draws = 0;
for (const node of model.nodes.filter(n => n.mesh !== undefined)) for (const p of model.meshes[node.mesh].primitives) {
 triangles += model.accessors[p.indices ?? p.attributes.POSITION].count / 3;
 draws++;
}
const budget = CAR_STYLE.reviewedYaris;
assert(triangles <= budget.maxTriangles && draws <= budget.maxDrawCalls && bytes.length <= budget.maxModelBytes);
assert.equal(model.images.length, 2, 'Keep the colour atlas and selective lamp mask.');
await fs.writeFile(new URL('../web/models/yaris.glb', import.meta.url), bytes);
console.log(`Approved GR Yaris: ${triangles} triangles, ${draws} draws, ${bytes.length} bytes; source SHA-256 verified.`);
