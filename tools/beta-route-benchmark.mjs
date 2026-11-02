// Repeatable full-distance powertrain benchmark, without rendering or props.
// This controller is a measuring tool, not a claim about every driver's time.
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {drivingRig} from './beta-physics-fixture.mjs';
import {RallyRoute} from '../web/js/RallyRoute.js';
import {TrackPath, ROAD_HALF} from '../web/js/SplineTrack.js';
import {worldLength, BETA_RALLY_FEATURE_SCALE} from '../web/js/RaceUnits.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const measurements=[];
for(const [seed,landscape] of [[152428,'low'],[19381,'varied'],[2026,'high']]) {
 const route=new RallyRoute(seed,ROAD_HALF,landscape,worldLength(10000),{featureScale:BETA_RALLY_FEATURE_SCALE});route.growTo(worldLength(10000)+50);
 const path=new TrackPath(route.nodes,false),radius=path.radii();
 // Use precisely the height function used by RallyStage.buildNext, rather
 // than the smoother default spline interpolation between route nodes.
 const k=route.length/path.length;
 for(let i=0;i<path.sampleCount;i++){path.py[i]=route.heightAt(path.s[i]*k);path.gy[i]=route.gradeAt(path.s[i]*k)*k;}
 let index=0,maxError=0,maxSpeed=0,elapsed=0;
 const nearby=(x,z)=>{let best=Infinity,bestI=index;for(let i=Math.max(0,index-20);i<Math.min(path.sampleCount,index+100);i++){const d=(path.px[i]-x)**2+(path.pz[i]-z)**2;if(d<best){best=d;bestI=i;}}index=bestI;return Math.sqrt(best);};
 const rig=drivingRig({surface:(x,z,out)=>{nearby(x,z);const g=path.gy[index],tx=path.tx[index],tz=path.tz[index];out.set(-tx*g,1,-tz*g).normalize();return path.py[index]+g*((x-path.px[index])*tx+(z-path.pz[index])*tz);}});
 const start=path.frameAt(0);rig.vehicle.respawn([start.x,start.y+.51,start.z],Math.atan2(start.tx,start.tz));
 const ahead={},front=new THREE.Vector3(),gears={};
 while(elapsed<900 && path.s[index]<worldLength(10000)-.5) {
  const v=rig.vehicle,speed=Math.hypot(v.sphereVel.x,v.sphereVel.z);
  const error=nearby(v.spherePos.x,v.spherePos.z);maxError=Math.max(maxError,error);
  if(error>ROAD_HALF*route.widthAt(path.s[index])-.7)break;
  path.frameAt(path.s[index]+clamp(2+speed*.2,2,9),ahead);
  front.set(0,0,1).applyQuaternion(v.container.quaternion);
  const steer=clamp(-2.2*wrap(Math.atan2(ahead.x-v.spherePos.x,ahead.z-v.spherePos.z)-Math.atan2(front.x,front.z)),-1,1);
  let target=32;
  for(let i=index;i<path.sampleCount&&path.s[i]-path.s[index]<100;i+=2){
   const ds=i>1?path.s[i]-path.s[i-2]:1;
   const crest=i>1?Math.sqrt(3.5/Math.max(1e-8,-(path.gy[i]-path.gy[i-2])/ds)):Infinity;
   const corner=Math.min(crest,Math.sqrt(10*Math.max(2,radius[i])));
   target=Math.min(target,Math.sqrt(corner*corner+2*4*(path.s[i]-path.s[index])));
  }
  rig.step({x:steer,z:speed>target+.5?-1:speed<target-.5?1:.15});elapsed+=rig.dt;
  maxSpeed=Math.max(maxSpeed,Math.hypot(v.sphereVel.x,v.sphereVel.y,v.sphereVel.z)*7.2);gears[v.transmission.gear]=(gears[v.transmission.gear]||0)+1;
 }
 const finished=path.s[index]>=worldLength(10000)-.5;
 const record={seed,landscape,finished,timeSeconds:+elapsed.toFixed(2),distanceMetres:+(path.s[index]*2).toFixed(1),meanKmh:+(path.s[index]*2/elapsed*3.6).toFixed(1),maxKmh:+maxSpeed.toFixed(1),maxLateralErrorMetres:+(maxError*2).toFixed(2),gears};
 measurements.push(record);console.log(JSON.stringify(record));
}
if(process.env.BETA_BENCH_REPORT)await fs.writeFile(process.env.BETA_BENCH_REPORT,JSON.stringify({scope:'Go/WASM + Vehicle + Crashcat, 10 km road centreline with elevation. Automatic measuring driver, without scenery, walls or network; not a human lap time.',measurements},null,2)+'\n');
process.exit(measurements.every(r=>r.finished)?0:1);
