import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { yarisScale, stretchYaris, YARIS_CAR, YARIS_TRACK_ID } from '../web/js/YarisMode.js';
import { CAR_STYLE } from '../web/js/CarStyle.js';
import { CARS, GARAGE_CARS } from '../web/js/Cars.js';
import { audioVolumes, loadSettings, saveSettings } from '../web/js/Settings.js';
import { MenuMusic, shuffleTracks } from '../web/js/menu/MenuMusic.js';
import { raceParams } from '../web/js/multi/LobbyRace.js';
import { warmupShaders } from '../web/js/PageTransition.js';
import { CircuitOnline } from '../web/js/CircuitOnline.js';

test('reference squash/stretch is periodic and never moves the physical car', () => {
 const physical = new THREE.Group(); physical.position.set(2,3,4); physical.rotation.y=0.7;
 const visual = new THREE.Group(); visual.userData.yaris=true;
 const stretch = new THREE.Group(); visual.add(stretch); physical.add(visual);
 const position=physical.position.clone(), quaternion=physical.quaternion.clone();
 for(let i=0;i<1000;i++) {
  const time=i/120, scale=yarisScale(time);
  assert.ok(Object.values(scale).every(v=>Number.isFinite(v)&&v>=0.8&&v<=1.2));
  const next=yarisScale(time+1/2.2);
  for(const axis of ['x','y','z']) assert.ok(Math.abs(scale[axis]-next[axis])<1e-12);
  stretchYaris(visual,time);
  assert.deepEqual(physical.position,position);
  assert.deepEqual(physical.quaternion.toArray(),quaternion.toArray());
  assert.deepEqual(visual.scale,new THREE.Vector3(1,1,1));
  assert.deepEqual(stretch.scale,new THREE.Vector3(scale.x,scale.y,scale.z));
 }
 assert.equal(yarisScale(0).y,1.2);
 assert.ok(Math.abs(yarisScale(0.12/2.2).y-0.8)<1e-12);
});

test('Yaris geometry stays inside the reviewed rendering budget and available in the regular garage', async()=>{
 const bytes=await fs.readFile(new URL('../web/models/yaris.glb',import.meta.url));
 assert.equal(bytes.toString('ascii',0,4),'glTF');
 const model=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
 let triangles=0, draws=0;
 for(const node of model.nodes.filter(n=>n.mesh!==undefined))for(const p of model.meshes[node.mesh].primitives){triangles+=model.accessors[p.indices??p.attributes.POSITION].count/3;draws++;}
 assert.ok(triangles<=CAR_STYLE.maxTriangles && draws<=CAR_STYLE.maxDrawCalls);
 assert.ok(bytes.length<CAR_STYLE.maxModelBytes && (model.images?.length??0)===0);
 assert.ok(CARS.some(c=>c.id===YARIS_CAR));
 assert.ok(GARAGE_CARS.some(c=>c.id===YARIS_CAR));
 assert.ok(model.nodes.filter(n=>['FL','FR'].includes(n.name)).every(n=>n.translation[2]>0));
 assert.ok(model.nodes.filter(n=>['BL','BR'].includes(n.name)).every(n=>n.translation[2]<0));
 assert.ok(!model.nodes.find(n=>n.name==='car').rotation);
 const reference=model.asset.extras;
 assert.equal(reference.reference,'Toyota GR Yaris XP210 2020');
 const factor=reference.referenceScale;
 const front=model.nodes.find(n=>n.name==='FL'),rear=model.nodes.find(n=>n.name==='BL');
 assert.ok(Math.abs((front.translation[2]-rear.translation[2])/factor-2.560)<1e-6);
 assert.ok(Math.abs((1.9975-front.translation[2]/factor)-.830)<1e-6);
 assert.ok(Math.abs((rear.translation[2]/factor+1.9975)-.605)<1e-6);
 for(const m of model.materials){assert.ok(m&&m.alphaMode!=='BLEND');assert.equal(m.pbrMetallicRoughness.metallicFactor,CAR_STYLE.metalness);}
 assert.ok(model.meshes.every(m=>m.primitives.every(p=>model.materials[p.material])));
 const bin=28+bytes.readUInt32LE(12);
 for(const mesh of model.meshes)for(const primitive of mesh.primitives){
  for(const name of ['POSITION','NORMAL']){
   const a=model.accessors[primitive.attributes[name]], view=model.bufferViews[a.bufferView];
   const at=bin+(view.byteOffset||0)+(a.byteOffset||0);
   for(let i=0;i<a.count;i++){
    const v=[0,1,2].map(k=>bytes.readFloatLE(at+(i*3+k)*4));
    assert.ok(v.every(Number.isFinite));
    if(name==='NORMAL')assert.ok(Math.abs(Math.hypot(...v)-1)<1e-5);
   }
  }
 }
});

test('legacy music level migrates; race/menu volumes and mute survive independently',()=>{
 assert.deepEqual(audioVolumes({music:0.2}),{engine:1,tyres:1,menuMusic:0.2,raceMusic:0.7});
 assert.deepEqual(audioVolumes({menuMusic:0.3,raceMusic:0.9,engine:4,tyres:-2}),{engine:1,tyres:0,menuMusic:0.3,raceMusic:0.9});
 const store=new Map([['racing.settings',JSON.stringify({raceMusic:false,volume:{music:0.25}})]]);
 globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const settings=loadSettings();
 assert.equal(settings.raceMusic,true);
 settings.volume.raceMusic=0.11;settings.raceMusic=false;saveSettings(settings);
 const loaded=loadSettings();
 assert.equal(loaded.volume.menuMusic,0.25);
 assert.equal(loaded.volume.raceMusic,0.11);
 assert.equal(loaded.raceMusic,false);
 delete globalThis.localStorage;
});

test('race room mode overrides arbitrary car parameters',()=>{
 const params=raceParams({mode:'yaris',kind:'circuit',id:'track-id',grid:[{id:'p1',car:'BMW E30',color:5}]},'p1');
 assert.equal(params.get('mode'),'yaris');
 assert.equal(params.get('car'),YARIS_CAR);
 assert.equal(params.get('color'),'1');
 assert.equal(params.get('circuit'),'track-id');
});

test('Yaris playlist remains one song before/after fetch and through track endings',async()=>{
 const manifest=JSON.parse(await fs.readFile(new URL('../web/audio/music/club/manifest.json',import.meta.url)));
 const original={Audio:globalThis.Audio,window:globalThis.window,fetch:globalThis.fetch};
 globalThis.window={addEventListener(){},removeEventListener(){}};
 globalThis.Audio=class {
  constructor(src){this.src=src;this.paused=true;this.handlers={};}
  addEventListener(k,fn){this.handlers[k]=fn;}
  pause(){this.paused=true;}
  play(){this.paused=false;return Promise.resolve();}
 };
 globalThis.fetch=async()=>({ok:true,json:async()=>manifest});
 try {
  const music=new MenuMusic({enabled:false,localPlaylist:true,trackIds:[YARIS_TRACK_ID]});
  assert.equal(music.currentTrack.id,YARIS_TRACK_ID);
  await music.localReady;
  assert.equal(music.tracks.length,1);
  for(let i=0;i<30;i++){music.audio.handlers.ended();assert.equal(music.currentTrack.id,YARIS_TRACK_ID);}
  music.setTrackIds(null);
  assert.equal(music.tracks.length,13);
  const seen=[];
  for(let i=0;i<13;i++){seen.push(music.currentTrack.id);music.audio.handlers.ended();}
  assert.deepEqual(new Set(seen),new Set(manifest.tracks.map(t=>t.id)));
  assert.equal(new Set(seen).size,13);
  assert.notEqual(music.currentTrack.id,seen.at(-1));
  music.setTrackIds([YARIS_TRACK_ID]);
  assert.equal(music.tracks.length,1);
  assert.equal(music.currentTrack.id,YARIS_TRACK_ID);
 } finally {Object.assign(globalThis,original);}
});

test('shuffle keeps every song, preserves the catalogue, and avoids boundary repeats',()=>{
 const tracks=[{src:'a'},{src:'b'},{src:'c'},{src:'d'}];
 const original=tracks.map(t=>t.src);
 for(const previous of original){
  const shuffled=shuffleTracks(tracks,previous,()=>0.5);
  assert.deepEqual(new Set(shuffled.map(t=>t.src)),new Set(original));
  assert.notEqual(shuffled[0].src,previous);
 }
 assert.deepEqual(tracks.map(t=>t.src),original);
 assert.deepEqual(shuffleTracks([{src:'only'}],'only'),[{src:'only'}]);
});

test('an unfinished optional shader warmup cannot block entry forever',async()=>{
 assert.equal(await warmupShaders({compileAsync:()=>Promise.resolve()},null,null,20),true);
 assert.equal(await warmupShaders({compileAsync:()=>new Promise(()=>{})},null,null,5),false);
 await assert.rejects(warmupShaders({compileAsync:()=>Promise.reject(new Error('driver'))},null,null,20),/driver/);
});


test('record and TAS ghosts also use the Yaris visual without changing recorded frames',async()=>{
 const requested=[];
 const loader={load(src,onLoad){
  requested.push(src);
  const scene=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial());
  body.geometry.setAttribute('color',new THREE.BufferAttribute(new Uint8Array(body.geometry.attributes.position.count*3).fill(255),3,true));
  body.name='car';scene.add(body);onLoad({scene});
 }};
 const online=Object.assign(Object.create(CircuitOnline.prototype),{yarisMode:true,car:{id:YARIS_CAR},loader,scene:new THREE.Scene(),ghostCar:null});
 const frames=[[0,0,0,0]];
 await online.showGhost({car:'Audi Quattro S1',color:3,frames});
 assert.deepEqual(requested,['models/yaris.glb']);
 assert.equal(online.ghostCar.car,YARIS_CAR);
 assert.equal(online.ghostCar.visual.userData.yaris,true);
 assert.equal(online.ghostCar.frames,frames);
 await online.showGhost({car:'BMW E30',color:5,frames});
 assert.equal(requested.length,1);
 assert.equal(online.scene.children.length,1);
});
