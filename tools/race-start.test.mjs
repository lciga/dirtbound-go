import test from 'node:test';
import assert from 'node:assert/strict';
import { RaceStart } from '../web/js/RaceStart.js';

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
