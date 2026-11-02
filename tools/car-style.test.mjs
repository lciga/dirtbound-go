import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadYaris} from '../web/js/YarisCar.js';
import {CAR_STYLE} from '../web/js/CarStyle.js';

test('the real Yaris GLB supports five distinct cached paints with shared wheels and materials',async()=>{
 const bytes=await fs.readFile(new URL('../web/models/yaris.glb',import.meta.url));let loads=0;
 const loader={load(url,done,progress,fail){loads++;new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',done,fail);}};
 const cars=await Promise.all([1,2,3,4,5].map(c=>loadYaris(loader,c)));
 assert.equal(loads,1);
 const bodies=cars.map(c=>c.getObjectByName('body'));
 assert.equal(new Set(bodies.map(b=>Array.from(b.geometry.attributes.color.array).join(','))).size,5);
 for(let i=0;i<5;i++){
  const again=await loadYaris(loader,i+1);
  assert.notEqual(again,cars[i]);assert.equal(again.getObjectByName('body').geometry,bodies[i].geometry);
  assert.equal(bodies[i].material,bodies[0].material);
  const wheel=cars[i].getObjectByName('wheel-front-left');
  assert.equal(wheel.geometry,cars[0].getObjectByName('wheel-back-right').geometry);
  assert.equal(cars[i].getObjectByName('body').parent.scale.x,CAR_STYLE.runtimeScale);
  const box=new THREE.Box3().setFromObject(cars[i]);assert.ok(Math.abs(box.min.y)<1e-6);assert.ok(box.max.z>0&&box.min.z<0);
  assert.equal(cars[i].userData.yaris,false);
 }
});
