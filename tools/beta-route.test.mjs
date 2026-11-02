import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {RallyRoute} from '../web/js/RallyRoute.js';
import {BETA_RALLY_FEATURE_SCALE,worldLength} from '../web/js/RaceUnits.js';
import {ROAD_HALF} from '../web/js/SplineTrack.js';

test('beta routes end at the advertised distance and streamed generation matches eager generation',()=>{
 for(const seed of [152428,19381,2026,7,99])for(const landscape of ['low','varied','high']){
  const length=worldLength(10000),options={featureScale:BETA_RALLY_FEATURE_SCALE};
  const eager=new RallyRoute(seed,ROAD_HALF,landscape,length,options);eager.growTo(length+100);
  const stream=new RallyRoute(seed,ROAD_HALF,landscape,length,options);let chunk,count=0;
  while((chunk=stream.chunk(120))){assert.ok(chunk.length>0);assert.ok(++count<100);}
  assert.ok(Math.abs(eager.length-length)<1e-7);
  assert.deepEqual(stream.nodes,eager.nodes);
  assert.ok(eager.nodes.length<250);
  assert.ok(eager.nodes.every(n=>[n.x,n.y,n.z,n.s].every(Number.isFinite)));
 }
});

test('ordinary stage geometry matches the pre-change release for all three landscapes',()=>{
 const fixtures=[
  [152428,'low','f96d39aaa7262ea431bf2a4d7597d1509c8b4d5d15358447bc5040b816ec651b'],
  [19381,'varied','078a8cda51a9fa6b32d4848fa6c940cdcf8adf433e37ee531e03325d0bfce93a'],
  [2026,'high','ef9c3ec9e6c71cc719908810cbb1d87dc52a3e481e499e844b8fccd5fdaf4f96'],
 ];
 for(const[seed,landscape,expected]of fixtures){
  const route=new RallyRoute(seed,ROAD_HALF,landscape,10000);route.growTo(10000);
  assert.equal(createHash('sha256').update(JSON.stringify(route.nodes)).digest('hex'),expected);
 }
});
