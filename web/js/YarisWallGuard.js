import { rigidBody } from 'crashcat';

// SAT rectangle contact, used only for Yaris body clearance. The rolling sphere
// remains the ground solver. Test all four separating axes, including wall ends.
export function bodyWallContact(x,z,angle,halfWidth,halfLength,wall,out={}){
 const c=Math.cos(angle),s=Math.sin(angle),wc=wall.c,ws=wall.s,dx=x-wall.x,dz=z-wall.z;
 let depth=Infinity,nx=0,nz=0;
 for(let i=0;i<4;i++){
  const ax=i===0?c:i===1?s:i===2?wc:ws,az=i===0?-s:i===1?c:i===2?-ws:wc;
  const car=halfWidth*Math.abs(ax*c-az*s)+halfLength*Math.abs(ax*s+az*c);
  const edge=wall.hx*Math.abs(ax*wc-az*ws)+wall.hz*Math.abs(ax*ws+az*wc);
  const d=dx*ax+dz*az,overlap=car+edge-Math.abs(d);
  if(overlap<=0)return null;
  if(overlap<depth){depth=overlap;const sign=d<0?-1:1;nx=ax*sign;nz=az*sign;}
 }
 out.x=nx;out.z=nz;out.depth=depth;return out;
}
export class YarisWallGuard {
 constructor(world,{stretch=false}={}){
  this.world=world;this.hw=stretch?.61:.51;this.hl=stretch?1.16:.98;this.cells=new Map();this.seen=new Set();this.contact={};
  for(const b of world._clubWalls||[]){
   const q=b.quaternion||[0,0,0,1],angle=2*Math.atan2(q[1],q[3]),c=Math.cos(angle),s=Math.sin(angle),hx=b.halfExtents[0],hz=b.halfExtents[2];
   const w={x:b.position[0],y:b.position[1],z:b.position[2],hy:b.halfExtents[1],hx,hz,c,s};
   const ex=Math.abs(c)*hx+Math.abs(s)*hz+2,ez=Math.abs(s)*hx+Math.abs(c)*hz+2;
   for(let x=Math.floor((w.x-ex)/12);x<=Math.floor((w.x+ex)/12);x++)for(let z=Math.floor((w.z-ez)/12);z<=Math.floor((w.z+ez)/12);z++){const key=x+','+z;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(w);}
  }
 }
 resolve(vehicle){
  const body=vehicle.rigidBody,pos=body.position;let x=pos[0],y=pos[1],z=pos[2];
  const q=vehicle.container.quaternion,angle=Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.x*q.x));
  let vx=body.motionProperties.linearVelocity[0],vz=body.motionProperties.linearVelocity[2],changed=false;
  // Two passes settle corners without scanning the whole circuit.
  for(let pass=0;pass<2;pass++){
   this.seen.clear();const candidates=this.cells.get(Math.floor(x/12)+','+Math.floor(z/12))||[];
   for(const wall of candidates){
    if(this.seen.has(wall)||Math.abs(y-.1-wall.y)>wall.hy+.3)continue;this.seen.add(wall);
    const hit=bodyWallContact(x,z,angle,this.hw,this.hl,wall,this.contact);if(!hit)continue;
    x+=hit.x*(hit.depth+.002);z+=hit.z*(hit.depth+.002);
    const into=vx*hit.x+vz*hit.z;if(into<0){vx-=hit.x*into;vz-=hit.z*into;}
    changed=true;
   }
  }
  if(changed){rigidBody.setTransform(this.world,body,[x,y,z],body.quaternion,true);rigidBody.setLinearVelocity(this.world,body,[vx,body.motionProperties.linearVelocity[1],vz]);}
 }
}
