// Actual trajectory, not body yaw: real Go/WASM + Vehicle + Crashcat.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {drivingRig} from './beta-physics-fixture.mjs';

export function measureTurn(kmh,{steer=1,surface=1,dt=1/120}={}) {
 const r=drivingRig({dt});r.vehicle.speedFactor=surface;
 for(let i=0;r.vehicle.sphereVel.length()*7.2<kmh && i<120/dt;i++)r.step({z:1});
 let heading=0,turn=0,distance=0,totalSpeed=0,maxSlip=0,samples=0;
 for(let i=0;i<Math.round(6/dt);i++){
  const speed=r.vehicle.sphereVel.length()*7.2,z=speed<kmh-1?1:speed>kmh+1?0:.15;
  r.step({x:steer,z});const v=r.vehicle.sphereVel,a=Math.atan2(v.x,v.z);
  if(i>=Math.round(1/dt)){
   turn+=Math.abs(Math.atan2(Math.sin(a-heading),Math.cos(a-heading)));
   distance+=Math.hypot(v.x,v.z)*2*dt;totalSpeed+=Math.hypot(v.x,v.z)*7.2;
   maxSlip=Math.max(maxSlip,r.vehicle.slipAngle);samples++;
  }
  heading=a;
 }
 return {entryKmh:kmh,meanKmh:totalSpeed/samples,radiusMetres:distance/turn,secondsFor90:5/(turn/(Math.PI/2)),maxSlip};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const measurements=[30,60,80,100,140,180].map(kmh=>measureTurn(kmh));
 const report={scope:'Real Go/WASM + Vehicle + Crashcat on a flat surface, no walls or renderer. Speed maintained by pedals, one second settling and five seconds sampling. Radius uses velocity heading and distance, not body orientation. Not a human lap or FPS test.',measurements};
 for(const row of measurements)console.log(JSON.stringify(row));
 if(process.env.BETA_HANDLING_REPORT)await fs.writeFile(process.env.BETA_HANDLING_REPORT,JSON.stringify(report,null,2)+'\n');
}
