import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {decodeTrack,TrackPath,GRASS_UV,buildRoadGeometry,buildRoadChunks} from '../web/js/SplineTrack.js';
import {Terrain,buildGroundGeometry,buildGroundChunks} from '../web/js/Terrain.js';
import {CIRCUIT_BUDGET,selectForestCells,shouldBakeCircuitProbes} from '../web/js/CircuitBudget.js';
import * as THREE from 'three';
const seeds=JSON.parse(await fs.readFile('web/seed-circuits.json','utf8')).data.circuits;
for(const c of seeds)test(c.name+': chunked ground preserves every triangle, normal and rock weight',async()=>{
 const data=await decodeTrack(c.data),path=new TrackPath(data.nodes,data.closed),terrain=Terrain.fromData(data.terrain);terrain.conform(path);
 const old=buildGroundGeometry(terrain,{grass:GRASS_UV}),chunks=buildGroundChunks(terrain,{grass:GRASS_UV});
 assert.equal(chunks.reduce((n,g)=>n+(g.index?.count||g.attributes.position.count),0),old.attributes.position.count);
 let offset=0;
 for(const g of chunks){const count=g.index?.count||g.attributes.position.count;
  for(let i=0;i<count;i++){const idx=g.index?g.index.getX(i):i;for(const name of ['position','normal','uv','aRock']){const a=g.attributes[name],b=old.attributes[name];for(let j=0;j<a.itemSize;j++)assert.ok(a.array[idx*a.itemSize+j]===b.array[offset*b.itemSize+j],name+' differs at vertex '+offset);}offset++;}
 }
 if(terrain.chunks.size>48)assert.equal(shouldBakeCircuitProbes(path,terrain),false);
 if(c.name.includes('Nordschleife')){assert.ok(chunks.length>100);assert.ok(chunks.reduce((n,g)=>n+g.attributes.position.count,0)<old.attributes.position.count/4);}
 old.dispose();chunks.forEach(g=>g.dispose());
});
test('forest selection is deterministic and strictly bounded for arbitrarily long circuits',()=>{
 const cells=Array.from({length:50000},(_,i)=>({gx:i%500,gz:Math.floor(i/500)}));
 const selected=selectForestCells(cells);assert.equal(selected.length,CIRCUIT_BUDGET.maxForestCells);assert.deepEqual(selected,selectForestCells(cells));assert.ok(selected.some(c=>c.gz>90));
});
test('road partition keeps the same triangle count and finite bounds',async()=>{
 const c=seeds.find(c=>c.name.includes('Nordschleife')),data=await decodeTrack(c.data),path=new TrackPath(data.nodes,true),tile=new THREE.BoxGeometry(10,1,10).toNonIndexed();
 const old=buildRoadGeometry(path,tile),chunks=buildRoadChunks(path,tile,null,null);
 assert.ok(chunks.length>20);assert.equal(chunks.reduce((n,g)=>n+g.index.count,0),old.index.count);for(const g of chunks)assert.ok(Number.isFinite(g.boundingSphere.radius)&&g.boundingSphere.radius<100);
});
