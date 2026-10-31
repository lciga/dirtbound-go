import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import * as THREE from 'three';
globalThis.crypto ??= webcrypto;
await import('../web/wasm/wasm_exec.js');
const go=new Go();
const {instance}=await WebAssembly.instantiate(await fs.readFile(new URL('../web/wasm/physics.wasm',import.meta.url)),go.importObject);
go.run(instance);
const {Vehicle:Original}=await import('./reference/Vehicle.js');
const source=(await fs.readFile(new URL('../web/js/Vehicle.js',import.meta.url),'utf8'))
 .replace("import { physics } from './GoPhysics.js';",'const physics = globalThis.DirtboundGo;')
 .replace("from 'crashcat'","from '../web/js/vendor/crashcat.js'");
const temporary=new URL('./.parity-vehicle.mjs',import.meta.url);
await fs.writeFile(temporary,source);
const {Vehicle:Ported}=await import(temporary.href);
await fs.unlink(temporary);
let randomState=19381;
const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/2**32};
let checks=0,maxError=0;
for(const mode of ['keyboard','gamepad','touch']){
 const a=new Original(),b=new Ported();
 for(const v of [a,b]){v.bodyNode=new THREE.Group();v.wheelFL=new THREE.Group();v.wheelFR=new THREE.Group();v.wheels=[v.wheelFL,v.wheelFR]}
 for(let frame=0;frame<12000;frame++){
  const input={x:mode==='gamepad'?random()*2-1:[-1,0,1][Math.floor(random()*3)],z:[-1,0,1][Math.floor(random()*3)],handbrake:random()<.15,boost:Math.floor(random()*3),touchActive:mode==='touch'};
  const factor=frame%400<100?.62:1;
  const vx=random()*30-15,vz=random()*30-15;
  for(const v of[a,b]){v.speedFactor=factor;v.sphereVel.set(vx,0,vz);v.update(1/120,input)}
  const aa=[a.linearSpeed,a.angularSpeed,a.acceleration,a.inputX,a.slipAngle,a.driftIntensity,...a.container.quaternion.toArray(),a.bodyNode.rotation.x,a.bodyNode.rotation.z,a.wheelFL.rotation.x,a.wheelFL.rotation.y];
  const bb=[b.linearSpeed,b.angularSpeed,b.acceleration,b.inputX,b.slipAngle,b.driftIntensity,...b.container.quaternion.toArray(),b.bodyNode.rotation.x,b.bodyNode.rotation.z,b.wheelFL.rotation.x,b.wheelFL.rotation.y];
  aa.forEach((value,index)=>{const error=Math.abs(value-bb[index]);maxError=Math.max(maxError,error);assert.ok(error<1e-9,`${mode} frame ${frame} field ${index}: ${value} vs ${bb[index]}`);checks++});
 }
}
console.log(JSON.stringify({physics:'Go WebAssembly',steps:36000,checks,maxAbsoluteError:maxError,collisionSolver:'unchanged Crashcat; this test compares driving equations and visuals'}));
process.exit(0);
