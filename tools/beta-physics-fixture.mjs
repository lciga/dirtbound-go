// Runs the real Go/WASM, Vehicle adapter and Crashcat solver without a renderer.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
import * as crash from '../web/js/vendor/crashcat.js';

await import('../web/wasm/wasm_exec.js');
const go = new Go();
const {instance} = await WebAssembly.instantiate(await fs.readFile(new URL('../web/wasm/physics.wasm', import.meta.url)), go.importObject);
go.run(instance);

async function loadModule(name) {
 const url = new URL('../web/js/' + name, import.meta.url);
 let source = (await fs.readFile(url, 'utf8')).replace("import { physics } from './GoPhysics.js';", 'const physics = globalThis.DirtboundGo;');
 source = source.replace(/from (['"])([^'"]+)\1/g, (all, quote, specifier) => {
  const resolved = specifier === 'crashcat' ? new URL('../web/js/vendor/crashcat.js', import.meta.url)
   : specifier === 'three' ? new URL('../node_modules/three/build/three.module.js', import.meta.url)
   : specifier.startsWith('.') ? new URL(specifier, url) : null;
  return resolved ? `from ${quote}${resolved.href}${quote}` : all;
 });
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'club-beta-'));
 const file = path.join(dir, name);
 try { await fs.writeFile(file, source); return await import(pathToFileURL(file).href); }
 finally { await fs.rm(dir, {recursive: true, force: true}); }
}
const {Vehicle} = await loadModule('Vehicle.js');
const {createGroundProxy, createSphereBody} = await loadModule('Physics.js');
crash.registerAll();

export function drivingRig({grade = 0, beta = true, dt = 1/120, surface} = {}) {
 const settings = crash.createWorldSettings();
 const moving = crash.addObjectLayer(settings, crash.addBroadphaseLayer(settings));
 const fixed = crash.addObjectLayer(settings, crash.addBroadphaseLayer(settings));
 crash.enableCollision(settings, moving, fixed);
 const world = crash.createWorld(settings); world._OL_MOVING = moving; world._OL_STATIC = fixed;
 const normal = new THREE.Vector3(0, 1, -grade).normalize();
 const sample = surface || ((x, z, out) => {out.copy(normal); return grade*z;});
 const ground = createGroundProxy(world, sample);
 const vehicle = new Vehicle({beta});
 vehicle.physicsWorld = world;
 vehicle.groundBody = ground.body;
 vehicle.rigidBody = createSphereBody(world, [0, .5/normal.y, 0], {beta});
 vehicle.getGroundNormal = (x,z,out) => {sample(x,z,out); return out;};
 const model = new THREE.Group();
 const body = new THREE.Group(); body.name = 'body'; model.add(body);
 for(const name of ['front-left','front-right','back-left','back-right']) {const wheel = new THREE.Group(); wheel.name = 'wheel-'+name; model.add(wheel);}
 vehicle.init(model); vehicle.respawn([0, .5/normal.y, 0], 0);
 const tangent = new THREE.Vector3(0, grade, 1).normalize();
 const rig = {
  vehicle, world, ground, normal, tangent, dt,
  step(input = {}) {
   ground.update(vehicle.spherePos.x, vehicle.spherePos.z);
   crash.updateWorld(world, {}, dt);
   vehicle.update(dt, {x:0,z:0,handbrake:false,...input});
   return vehicle.sphereVel.dot(tangent);
  },
  run(seconds, input) {for(let n = 0; n < Math.round(seconds/dt); n++) rig.step(input); return rig.speed();},
  speed() {return vehicle.sphereVel.dot(tangent);},
 };
 return rig;
}
