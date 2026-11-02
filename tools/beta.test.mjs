import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { presenceChanges } from '../web/js/multi/LobbyClient.js';
import { mapSamples } from '../web/js/BetaHUD.js';
import * as crash from '../web/js/vendor/crashcat.js';
import { raceParams } from '../web/js/multi/LobbyRace.js';
const source=(await fs.readFile(new URL('../web/js/YarisWallGuard.js',import.meta.url),'utf8')).replace("from 'crashcat'",`from '${new URL('../web/js/vendor/crashcat.js',import.meta.url).href}'`);
const {bodyWallContact,YarisWallGuard}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('Yaris full footprint clears the front, side, diagonal and finite wall end',()=>{
 const wall={x:0,z:0,hx:.1,hz:5,c:1,s:0};
 for(const angle of [0,.4,Math.PI/2]){
  const x=.4,z=0,hit=bodyWallContact(x,z,angle,.57,1.16,wall);
  assert.ok(hit&&hit.x>0&&hit.depth>0);
  assert.equal(bodyWallContact(x+hit.x*(hit.depth+.001),z+hit.z*(hit.depth+.001),angle,.57,1.16,wall),null);
 }
 assert.equal(bodyWallContact(0,7,0,.57,1.16,wall),null);
 const end=bodyWallContact(.05,5.8,0,.57,1.16,wall);assert.ok(end&&end.z>0);
});

test('lobby presence ignores the first snapshot, self, readiness and navigation reconnects',()=>{
 const players=[{id:'me'},{id:'other',connected:true}];
 assert.deepEqual(presenceChanges(players,[{id:'me'},{id:'other',connected:false,ready:true}],'me'),{joined:0,left:0});
 assert.deepEqual(presenceChanges(players,[{id:'me'}],'me'),{joined:0,left:1});
 assert.deepEqual(presenceChanges([{id:'me'}],players,'me'),{joined:1,left:0});
});

test('beta and Yaris modifiers can be combined without a room mode collision',()=>{
 const p=raceParams({kind:'official',mode:'beta',yaris:true,grid:[{id:'p',car:'BMW E30',color:2}]},'p');
 assert.equal(p.get('beta'),'1');assert.equal(p.get('mode'),'yaris');assert.equal(p.get('car'),'Toyota Yaris');
 const normal=raceParams({kind:'official',mode:'classic',grid:[]},'p');assert.equal(normal.has('beta'),false);assert.equal(normal.has('mode'),false);
});

test('minimap sampling stays bounded on the longest circuits and streamed rally routes',()=>{
 const p={sampleCount:50000,px:Float32Array.from({length:50000},(_,i)=>i),pz:new Float32Array(50000),closed:true};
 assert.ok(mapSamples({path:p}).points.length<=256);
 const stage={route:{nodes:Array.from({length:10000},(_,i)=>({x:i,z:i/2}))}};
 assert.ok(mapSamples({stage}).points.length<=256);assert.equal(mapSamples({stage}).closed,false);
 assert.ok(mapSamples({}).points.length>0);
});

test('full-body wall correction updates the real collision solver without forward penetration',()=>{
 crash.registerAll();const settings=crash.createWorldSettings();const broad=crash.addBroadphaseLayer(settings),layer=crash.addObjectLayer(settings,broad);const world=crash.createWorld(settings);
 world._clubWalls=[{position:[0,.5,0],halfExtents:[.1,1,5],quaternion:[0,0,0,1]}];
 const body=crash.rigidBody.create(world,{shape:crash.sphere.create({radius:.5}),motionType:crash.MotionType.DYNAMIC,objectLayer:layer,position:[.4,.5,0],mass:1000});
 crash.rigidBody.setLinearVelocity(world,body,[-5,0,0]);
 new YarisWallGuard(world,{stretch:true}).resolve({rigidBody:body,container:{quaternion:{x:0,y:0,z:0,w:1}}});
 assert.ok(body.position[0]>=.71);assert.ok(body.motionProperties.linearVelocity[0]>=0);
});
