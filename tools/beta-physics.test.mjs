import test from 'node:test';
import assert from 'node:assert/strict';
import * as crash from '../web/js/vendor/crashcat.js';
import {drivingRig} from './beta-physics-fixture.mjs';
import {BETA_METRES_PER_WORLD, speedKmh, worldLength} from '../web/js/RaceUnits.js';
import {Gearbox} from '../web/js/Gearbox.js';

test('real collision solver launches on flat, 10%, 18% and 30% climbs', () => {
 for (const grade of [0,.10,.18,.30]) {
  const rig = drivingRig({grade});
  const speed = rig.run(5,{z:1})*7.2;
  assert.ok(speed>80 && speed<160, `grade ${grade}: ${speed} km/h`);
  assert.ok(rig.vehicle.transmission.grounded);
  assert.ok(rig.vehicle.spherePos.z>20);
 }
});

test('reverse, braking and forward relaunch recover repeatedly on flat and uphill', () => {
 for (const grade of [0,.18]) {
  const rig = drivingRig({grade});
  for(let cycle=0;cycle<3;cycle++) {
   rig.run(cycle ? 6 : 3,{z:-1});
   assert.equal(rig.vehicle.transmission.gear,-1);
   assert.equal(rig.vehicle.transmission.gearLabel,'R');
   assert.ok(rig.speed() < -1 && rig.speed()*7.2 > -45);
   assert.ok(rig.run(5,{z:1})*7.2>75, `failed relaunch on ${grade}, cycle ${cycle}`);
   assert.ok(rig.vehicle.transmission.gear>0);
  }
 }
});

test('a stopped car launches in first even if its previous gear was fifth', () => {
 const rig = drivingRig();
 Object.assign(rig.vehicle.transmission,{gear:5,rpm:1900,shift:.1,hold:0});
 rig.step({z:1});
 assert.equal(rig.vehicle.transmission.gear,1);
 assert.equal(rig.vehicle.transmission.shifting,false);
 assert.ok(rig.run(2,{z:1})*7.2>45);
});

test('fifth is reachable and the collision body no longer imposes a 170 km/h ceiling', () => {
 const rig=drivingRig();rig.run(60,{z:1});
 assert.equal(rig.vehicle.transmission.gear,5);
 assert.ok(rig.speed()*7.2>210 && rig.speed()*7.2<300);
 assert.ok(rig.vehicle.transmission.rpm<7500);
});

test('hill rollback never selects reverse without reverse input', () => {
 const rig=drivingRig({grade:.18});rig.run(3,{});
 assert.ok(rig.speed()<0);
 assert.equal(rig.vehicle.transmission.gear,1);
 // Includes arresting rollback before accelerating up the 18% slope.
 assert.ok(rig.run(5,{z:1})*7.2>80);
});

test('handbrake holds an uphill stop with throttle and releases cleanly', () => {
 const rig=drivingRig({grade:.18});rig.run(2,{handbrake:true});
 const start=rig.vehicle.spherePos.clone();rig.run(5,{z:1,handbrake:true});
 assert.ok(rig.vehicle.spherePos.distanceTo(start)<.1);
 assert.ok(Math.abs(rig.speed())<.01);
 assert.ok(rig.run(5,{z:1})*7.2>90);
});

test('braking is stronger than coasting and off-road reduces real acceleration', () => {
 const coast=drivingRig(),brake=drivingRig(),road=drivingRig(),grass=drivingRig();
 coast.run(6,{z:1});brake.run(6,{z:1});
 coast.run(1,{});brake.run(1,{z:-1});
 assert.ok(brake.speed()<coast.speed()-3);
 grass.vehicle.speedFactor=.4;road.run(5,{z:1});grass.run(5,{z:1});
 assert.ok(grass.speed()>0 && grass.speed()<road.speed()*.8);
});

test('airborne throttle cannot apply ground traction', () => {
 const rig=drivingRig();
 crash.rigidBody.setPosition(rig.world,rig.vehicle.rigidBody,[0,20,0],true);
 rig.vehicle.spherePos.set(0,20,0);rig.run(1,{z:1});
 assert.equal(rig.vehicle.transmission.grounded,false);
 assert.ok(Math.hypot(rig.vehicle.sphereVel.x,rig.vehicle.sphereVel.z)<1e-6);
 assert.ok(rig.vehicle.spherePos.y<20);
});

test('reset clears reverse and ordinary sound gearbox has exactly five forward gears', () => {
 const rig=drivingRig();rig.run(2,{z:-1});rig.vehicle.respawn([0,.5,0],0);
 assert.equal(rig.vehicle.transmission.gear,1);
 assert.equal(rig.vehicle.transmission.rpm,1800);
 const gearbox=new Gearbox(),gears=new Set();
 for(let i=0;i<120*15;i++){gearbox.update(1/120,.94,1);gears.add(gearbox.gear);}
 assert.deepEqual([...gears].sort(),[1,2,3,4,5]);assert.equal(gearbox.revLimit,false);
});

test('HUD distance and speed agree: 10 km at 150–200 km/h takes 4–3 minutes', () => {
 assert.equal(BETA_METRES_PER_WORLD,2);
 assert.equal(worldLength(10000),5000);
 assert.equal(speedKmh({x:0,y:0,z:10}),72);
 for(const kmh of [150,200]) {
  const worldSpeed=kmh/7.2;
  assert.ok(Math.abs(worldLength(10000)/worldSpeed-36000/kmh)<1e-8);
 }
});

test('sideways braking cannot engage reverse before the whole car stops',()=>{
 const r=drivingRig();r.run(.5,{});
 crash.rigidBody.setLinearVelocity(r.world,r.vehicle.rigidBody,[12,0,.001]);
 r.vehicle.sphereVel.set(12,0,.001);
 for(let n=0;n<12;n++){r.step({z:-1});assert.equal(r.vehicle.transmission.gear,1);}
 r.run(4,{z:-1});assert.equal(r.vehicle.transmission.gear,-1);assert.ok(r.speed()<-1);
});

test('changing ground grade does not impose the old low-speed rolling-friction plateau',()=>{
 const r=drivingRig({surface:(x,z,n)=>{n.set(0,1,-(.05+.03*Math.sin(z/30))).normalize();return .05*z-.9*Math.cos(z/30);}});
 r.run(20,{z:1});assert.ok(r.vehicle.sphereVel.length()*7.2>140);
});

test('launch results converge at 60, 120 and 240 physics steps per second',()=>{
 const results=[];
 for(const dt of [1/60,1/120,1/240]){const r=drivingRig({grade:.18,dt});r.run(8,{z:1});results.push(r.speed()*7.2);}
 assert.ok(Math.max(...results)-Math.min(...results)<3,JSON.stringify(results));
});

test('mixed steering, brakes, handbrake and reverse remain finite across 45 seconds',()=>{
 const r=drivingRig();let random=137;
 const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/2**32;};
 for(let i=0;i<45*120;i++){
  const input={x:Math.sin(i/110),z:i%900<600?1:-1,handbrake:next()<.015};r.step(input);
  assert.ok([...r.vehicle.spherePos.toArray(),...r.vehicle.sphereVel.toArray(),r.vehicle.transmission.rpm].every(Number.isFinite));
  assert.ok([-1,1,2,3,4,5].includes(r.vehicle.transmission.gear));
 }
});

test('touch compass directions drive forward instead of selecting R or cutting throttle',()=>{
 for(const input of [{x:1,z:0},{x:-1,z:0},{x:0,z:-1}]){
  const r=drivingRig();r.run(3,{...input,touchActive:true});
  const forward=r.vehicle.container.getWorldDirection(new (r.vehicle.sphereVel.constructor)());
  assert.ok(r.vehicle.sphereVel.dot(forward)>2);
  assert.ok(r.vehicle.transmission.gear>0);
  assert.equal(r.vehicle.inputZ,1);
 }
});

test('full throttle through a mild or full-lock turn no longer scrubs away straight-line speed',()=>{
 for(const steer of [.12,.25,1]){
  const r=drivingRig();r.run(6,{z:1});const entry=r.vehicle.sphereVel.length();let min=entry,maxSlip=0;
  for(let i=0;i<360;i++){r.step({z:1,x:steer});min=Math.min(min,r.vehicle.sphereVel.length());maxSlip=Math.max(maxSlip,r.vehicle.slipAngle);assert.ok(r.vehicle.transmission.gear>=3);}
  assert.ok(min>entry*.95,`steer ${steer}: ${min/entry}`);assert.ok(maxSlip<.12,`slip ${maxSlip}`);
  const exit=r.vehicle.sphereVel.length();r.run(2,{z:1});assert.ok(r.vehicle.sphereVel.length()>exit+1);
 }
});

test('an ordinary 40–60 km/h corner exit keeps second and responds to throttle',()=>{
 const r=drivingRig();r.run(6,{z:1});
 while(r.vehicle.sphereVel.length()*7.2>50)r.step({z:-1});
 const before=r.vehicle.sphereVel.length();
 for(let i=0;i<240;i++){r.step({z:1,x:.5});assert.notEqual(r.vehicle.transmission.gear,1);}
 assert.ok(r.vehicle.sphereVel.length()>before+5);
});

test('handbrake can still create a slide while ordinary steering stays within grip',()=>{
 const r=drivingRig();r.run(5,{z:1});let peak=0;
 for(let i=0;i<120;i++){r.step({x:1,z:1,handbrake:true});peak=Math.max(peak,r.vehicle.slipAngle);}
 assert.ok(peak>.25);
 r.run(6,{z:1});assert.ok(r.vehicle.sphereVel.length()*7.2>90);
});
