import test from 'node:test';
import assert from 'node:assert/strict';
import { RaceStart } from '../web/js/RaceStart.js';
import { LaunchBurnout } from '../web/js/LaunchBurnout.js';
import { SmokeTrails } from '../web/js/Particles.js';
import * as THREE from 'three';

test('loading never releases the car, even after a long frame', () => {
 const start = new RaceStart();
 for (let frame=0; frame<1000; frame++) start.update(1);
 assert.equal(start.blocked,true);
 assert.equal(start.label,'');
 start.begin();
 assert.equal(start.label,'3');
 assert.equal(start.blocked,true);
});

test('3, 2 and 1 each finish before throttle can move the car', () => {
 const start = new RaceStart();start.begin();
 const heldThrottle = 1;
 let distance = 0;
 for(let second=0;second<3;second++) {
  assert.equal(start.label,String(3-second));
  for(let frame=0;frame<60;frame++) {
   if(!start.blocked) distance += heldThrottle;
   start.update(1/60);
  }
 }
 assert.equal(distance,0);
 assert.equal(start.blocked,false);
 assert.equal(start.label,'go');
 for(let frame=0;frame<70;frame++) start.update(1/60);
 assert.equal(start.label,'');
});

test('pause and background tabs do not consume the start countdown', () => {
 const start = new RaceStart();start.begin();
 for(let frame=0;frame<600;frame++) {
  start.update(1/60,{paused:true});
  start.update(1/60,{visible:false});
 }
 assert.equal(start.remaining,3);
 assert.equal(start.blocked,true);
});

test('a shader or visibility hitch does not skip the countdown', () => {
 const start = new RaceStart();start.begin();start.update(10);
 assert.equal(start.label,'3');assert.equal(start.blocked,true);
});

test('launch burnout is blocked by the countdown, expires, and never re-arms on another lap', () => {
 const start=new RaceStart(); start.begin();
 const launch=new LaunchBurnout();
 for(let i=0;i<180;i++) {
  assert.equal(launch.update(1/60,!start.blocked,1),0);
  start.update(1/60);
 }
 assert.ok(launch.update(1/60,!start.blocked,1)>0.9);
 for(let i=0;i<100;i++) launch.update(1/60,true,1);
 assert.equal(launch.update(1/60,true,1),0);
 // A start-line crossing or a race-state toggle never creates a new GO.
 assert.equal(launch.update(1/60,false,1),0);
 assert.equal(launch.update(1/60,true,1),0);
});

test('launch needs throttle; late multiplayer joins and restarts do not burn out', () => {
 const launch=new LaunchBurnout();
 for(let i=0;i<120;i++) assert.equal(launch.update(1/60,true,0),0);
 assert.equal(launch.update(1/60,true,1),0);
 assert.equal(new LaunchBurnout().update(1/60,true,1,5),0);
 const restart=new LaunchBurnout();
 assert.ok(restart.update(1/60,true,1)>0);
 restart.cancel();
 assert.equal(restart.update(1/60,true,1),0);
});

test('burnout emits pooled rear-wheel smoke without changing the vehicle drift state', () => {
 const scene=new THREE.Scene(), container=new THREE.Group();
 const left=new THREE.Object3D(),right=new THREE.Object3D();
 left.position.set(-0.5,0,-1); right.position.set(0.5,0,-1);
 container.add(left,right); scene.add(container);
 const vehicle={container,wheelBL:left,wheelBR:right,driftIntensity:0};
 const smoke=new SmokeTrails(scene);
 smoke.update(0.1,vehicle,1);
 assert.ok(smoke.particles.some(p=>p.life>0));
 assert.equal(vehicle.driftIntensity,0);
 assert.equal(smoke.particles.length,640);
});
