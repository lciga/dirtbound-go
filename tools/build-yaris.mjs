// Procedural Toyota GR Yaris, matching the user-provided three-door reference.
// Same compact proportions and flat materials as the game's rally cars. +Z is FRONT.
// Usage: node tools/build-yaris.mjs
import fs from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const paint=0xe5e8e2, glass=0x183343, rubber=0x20252c, silver=0xadb6bd;
function colorGeometry(g,hex){
 if(g.index)g=g.toNonIndexed();
 g.deleteAttribute('uv');g.computeVertexNormals();
 const color=new THREE.Color(hex), a=new Uint8Array(g.attributes.position.count*3);
 for(let i=0;i<a.length;i+=3)a.set([Math.round(color.r*255),Math.round(color.g*255),Math.round(color.b*255)],i);
 g.setAttribute('color',new THREE.BufferAttribute(a,3,true));return g;
}
const parts=[];
function box(w,h,d,x,y,z,color=paint){parts.push(colorGeometry(new THREE.BoxGeometry(w,h,d).translate(x,y,z),color));}
function quad(points,color){
 const a=points.flatMap(p=>p), positions=[...a.slice(0,9),...a.slice(0,3),...a.slice(6,12)];
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 parts.push(colorGeometry(g,color));
}
function triangle(points,color){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));parts.push(colorGeometry(g,color));
}
function loft(sections){
 const rings=sections.map(([z,w,top,bottom=0.24,base=w])=>[
  [-base*0.86,bottom,z],[base*0.86,bottom,z],[base,bottom+Math.min(0.10,(top-bottom)/3),z],[w,top-Math.min(0.08,(top-bottom)/3),z],
  [w*0.87,top,z],[-w*0.87,top,z],[-w,top-Math.min(0.08,(top-bottom)/3),z],[-base,bottom+Math.min(0.10,(top-bottom)/3),z],
 ]);
 for(let r=0;r<rings.length-1;r++)for(let i=0;i<8;i++)quad([rings[r][i],rings[r][(i+1)%8],rings[r+1][(i+1)%8],rings[r+1][i]],paint);
 for(let i=1;i<7;i++){
  triangle([rings[0][0],rings[0][i+1],rings[0][i]],paint);
  const end=rings.at(-1);triangle([end[0],end[i],end[i+1]],paint);
 }
}
// GR Yaris: short three-door body, broad shoulders, raked screen and black roof.
// Coordinates are metres; +Z is the nose, -Z is the hatch.
function polygon(points,color,normal){
 if(normal){
  const a=new THREE.Vector3().fromArray(points[1]).sub(new THREE.Vector3().fromArray(points[0]));
  const b=new THREE.Vector3().fromArray(points[2]).sub(new THREE.Vector3().fromArray(points[0]));
  if(a.cross(b).dot(new THREE.Vector3().fromArray(normal))<0)points=points.toReversed();
 }
 for(let i=1;i<points.length-1;i++)triangle([points[0],points[i],points[i+1]],color);
}
const axles=[-1.25,1.24], tyreRadius=0.34;
const bodySections=[[-2.00,.77,.84],[-1.85,.87,.95],[-1.25,.94,1.00],[-.65,.89,.98],[.25,.87,1.00],[1.00,.94,.96],[1.35,.94,.91],[1.80,.88,.84],[2.00,.78,.77]];
function atSection(z,column){
 for(let i=1;i<bodySections.length;i++)if(z<=bodySections[i][0]){
  const a=bodySections[i-1],b=bodySections[i],t=(z-a[0])/(b[0]-a[0]);return a[column]+(b[column]-a[column])*t;
 }
 return bodySections.at(-1)[column];
}
const sectionZ=new Set(bodySections.map(s=>s[0]));
for(const axle of axles)for(let i=0;i<=12;i++)sectionZ.add(axle+Math.cos(Math.PI*i/12)*.39);
const bodyRings=[...sectionZ].sort((a,b)=>a-b).map(z=>{
 let bottom=.20;
 for(const axle of axles){const dz=z-axle;if(Math.abs(dz)<.39)bottom=Math.max(bottom,.34+Math.sqrt(.39**2-dz**2));}
 const width=atSection(z,1),top=atSection(z,2);
 return [z,width,top,bottom,width];
});
loft(bodyRings);
const bodySurface=parts.slice();
const cabinStart=parts.length;
const cabinSections=[[-1.78,.71,1.06,.89,.86],[-1.10,.71,1.41,.94,.90],[-.20,.70,1.48,.96,.87],[.30,.69,1.47,.98,.87],[1.04,.79,1.025,.95,.92]];
loft(cabinSections);
const cabinSurface=parts.slice(cabinStart);
// Clip glass/lights against the actual flat body triangles. A single floating
// polygon would cut through a faceted panel and produce white triangles in glass.
function surfacePanel(surface,outline,axes,normalTest,color,offset=.006){
 let area=0;for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length];area+=a[0]*b[1]-b[0]*a[1];}
 if(area<0)outline=outline.toReversed();
 for(const geometry of surface){
  const pos=geometry.attributes.position,norm=geometry.attributes.normal;
  for(let k=0;k<pos.count;k+=3){
   const n=[norm.getX(k),norm.getY(k),norm.getZ(k)],centre=[0,1,2].map(j=>(pos.array[k*3+j]+pos.array[(k+1)*3+j]+pos.array[(k+2)*3+j])/3);
   if(!normalTest(n,centre))continue;
   let clipped=[0,1,2].map(i=>[pos.getX(k+i),pos.getY(k+i),pos.getZ(k+i)]);
   for(let i=0;i<outline.length&&clipped.length;i++){
    const a=outline[i],b=outline[(i+1)%outline.length];
    const distance=p=>(b[0]-a[0])*(p[axes[1]]-a[1])-(b[1]-a[1])*(p[axes[0]]-a[0]);
    const result=[];
    for(let j=0;j<clipped.length;j++){
     const p=clipped[j],q=clipped[(j+1)%clipped.length],dp=distance(p),dq=distance(q);
     if(dp>=-1e-10)result.push(p);
     if((dp>1e-10&&dq< -1e-10)||(dp< -1e-10&&dq>1e-10)){const t=dp/(dp-dq);result.push(p.map((v,l)=>v+(q[l]-v)*t));}
    }
    clipped=result;
   }
   if(clipped.length>=3)polygon(clipped.map(p=>p.map((v,j)=>v+n[j]*offset)),color,n);
  }
 }
}
function panel(side,zy,color){surfacePanel(cabinSurface,zy,[2,1],n=>n[0]*side>.35,color);}
for(const side of [-1,1]){
 // One long door and a tapering rear quarter window. No rear-door handle.
 panel(side,[[.84,1.045],[.28,1.375],[-.16,1.385],[-.63,1.355],[-.72,1.065]],glass);
 panel(side,[[-.79,1.065],[-.72,1.335],[-1.08,1.315],[-1.54,1.105],[-1.42,1.052]],glass);
 box(.035,.028,.18,side*.891,1.015,-.64,0xc5cbd0);
 const mirror=new THREE.BoxGeometry(.24,.13,.23).rotateY(-side*.18).translate(side*.955,1.09,.64);
 parts.push(colorGeometry(mirror,0x111920));
 box(.035,.04,1.40,side*.875,.22,-.01,0x343c42);
 // Broad painted arch lips; an actual opening is cut into the lower body above.
 for(const axle of axles){
  for(let i=0;i<12;i++){
   const a=Math.PI*i/12,b=Math.PI*(i+1)/12;
   const point=(angle,r)=>[side*(atSection(axle+Math.cos(angle)*r,1)+.012),.34+Math.sin(angle)*r,axle+Math.cos(angle)*r];
   polygon([point(a,.39),point(b,.39),point(b,.425),point(a,.425)],paint,[side,0,0]);
  }
  // Calipers remain attached to the body rather than rotating with the wheel.
  box(.035,.23,.095,side*.946,.36,axle-.17,0xc92332);
 }
 // Sharply swept headlamp housings and cool LED blades.
 const light=(xz,color,offset)=>surfacePanel(bodySurface,xz.map(([x,z])=>[side*x,z]),[0,2],n=>n[1]>.20,color,offset);
 light([[.35,1.998],[.77,1.958],[.895,1.70],[.80,1.68],[.47,1.88]],0x101d29,.006);
 light([[.40,1.978],[.75,1.94],[.855,1.725],[.79,1.715],[.49,1.91]],0xb4d9e8,.010);
 light([[.43,1.982],[.76,1.948],[.865,1.728],[.85,1.71],[.745,1.928]],0xe9f4f5,.014);
 // Tall bumper inlets below the lights, as on the supplied GR reference.
 polygon([[side*.63,.27,2.015],[side*.79,.30,1.982],[side*.83,.66,1.96],[side*.65,.65,2.015]],0x10171c,[0,0,1]);
 box(.095,.065,.022,side*.729,.335,2.025,0xdbe8e4);
 // Red rear clusters wrap over the actual rear corner panels.
 const rearOutline=[[.56,.77],[.75,.76],[.88,.88],[.87,.98],[.74,.94],[.68,.83]];
 surfacePanel(bodySurface,rearOutline.map(([x,y])=>[side*x,y]),[0,1],(n,c)=>n[2]<-.15&&c[2]<-1.7,0xa81730,.009);
 surfacePanel(bodySurface,[[side*.58,.80],[side*.74,.79],[side*.84,.89],[side*.83,.925],[side*.72,.86]],[0,1],(n,c)=>n[2]<-.15&&c[2]<-1.7,0xef3046,.014);
 surfacePanel(bodySurface,[[-2,.79],[-1.83,.91],[-1.64,.955],[-1.70,.99],[-1.88,.955],[-2,.85]],[2,1],(n,c)=>n[0]*side>.25&&c[2]<-1.6,0xc9233b,.010);
 // Short, subtle single-door shut line below the glass.
 const door=[[side*.892,.32,-.80],[side*.90,.91,-.80],[side*.902,.91,-.788],[side*.895,.32,-.788]];
 polygon(door,0xa8afb1,[side,0,0]);
}
// Front/rear windows and carbon-black roof, inset to leave a white frame.
surfacePanel(cabinSurface,[[-.755,1.046],[.755,1.046],[.585,1.435],[-.585,1.435]],[0,1],(n,c)=>n[2]>.20&&c[2]>.30,glass);
surfacePanel(cabinSurface,[[.64,1.12],[-.64,1.12],[-.595,1.365],[.595,1.365]],[0,1],(n,c)=>n[2]<-.20&&c[2]<-1.10,glass);
surfacePanel(cabinSurface,[[-.595,-1.065],[.595,-1.065],[.607,-.20],[.60,.255],[-.60,.255],[-.607,-.20]],[0,2],n=>n[1]>.8,0x182127,.007);
box(1.40,.065,.18,0,1.412,-1.15,0x192228);
// Large six-sided grille, split from the narrow upper intake by a white bridge.
polygon([[-.61,.24,2.025],[.61,.24,2.025],[.635,.59,2.025],[.48,.69,2.025],[-.48,.69,2.025],[-.635,.59,2.025]],0x11181d,[0,0,1]);
for(let row=0;row<5;row++)for(let col=0;col<12;col++){
 const cx=(col-5.5)*.092+(row%2)*.022,cy=.285+row*.075;
 if(Math.abs(cx)>.55||(cy>.56&&Math.abs(cx)>.48))continue;
 // Sparse polygon grille pattern: vertex colour, no transparent texture or extra material.
 for(let j=0;j<6;j++){
  const a=Math.PI/3*j,b=Math.PI/3*(j+1);
  polygon([[cx+Math.cos(a)*.038,cy+Math.sin(a)*.029,2.030],[cx+Math.cos(b)*.038,cy+Math.sin(b)*.029,2.030],[cx+Math.cos(b)*.030,cy+Math.sin(b)*.022,2.031],[cx+Math.cos(a)*.030,cy+Math.sin(a)*.022,2.031]],0x29343b,[0,0,1]);
 }
}
box(.95,.043,.028,0,.775,2.027,0x11181d);
// Toyota's small oval nose badge. Geometry is shared with the body draw.
function oval(cx,cy,z,rx,ry,width,color){
 for(let i=0;i<16;i++){
  const a=i*Math.PI/8,b=(i+1)*Math.PI/8;
  polygon([[cx+rx*Math.cos(a),cy+ry*Math.sin(a),z],[cx+rx*Math.cos(b),cy+ry*Math.sin(b),z],[cx+(rx-width)*Math.cos(b),cy+(ry-width)*Math.sin(b),z],[cx+(rx-width)*Math.cos(a),cy+(ry-width)*Math.sin(a),z]],color,[0,0,1]);
 }
}
oval(0,.796,2.055,.074,.055,.009,silver);
oval(0,.796,2.057,.025,.050,.007,silver);
oval(0,.818,2.058,.059,.021,.006,silver);
box(.37,.10,.025,0,.535,2.054,0x1e252a);
box(.065,.055,.028,-.12,.535,2.07,0xd32636);
box(.034,.055,.029,-.17,.535,2.07,0xe1e6e4);
box(1.46,.045,.12,0,.198,1.99,paint);
box(1.41,.11,.11,0,.245,-1.99,0x182127);
box(.44,.13,.035,0,.64,-2.027,0xf1cc55);
for(const side of [-1,1])box(.14,.065,.11,side*.58,.235,-2.07,0x414d54);
const body=mergeGeometries(parts);
function cylinder(radius,width,segments,color){return colorGeometry(new THREE.CylinderGeometry(radius,radius,width,segments,1,false).rotateZ(Math.PI/2),color);}
const wheelParts=[cylinder(tyreRadius,.19,16,rubber),cylinder(.265,.197,16,0x303a43),cylinder(.235,.202,16,0x11181f)];
for(const side of [-1,1])for(let i=0;i<10;i++){
 const spoke=new THREE.BoxGeometry(.012,.45,.017).rotateX(i*Math.PI/10).translate(side*.106,0,0);
 wheelParts.push(colorGeometry(spoke,0x626e77));
}
wheelParts.push(cylinder(.055,.225,12,0x77838b));
const wheel=mergeGeometries(wheelParts);
for(const g of [body,wheel])g.setIndex(new THREE.BufferAttribute(Uint16Array.from({length:g.attributes.position.count},(_,i)=>i),1));
const doc={asset:{version:'2.0',generator:'Racing Club 1sk4nd3r · tools/build-yaris.mjs'},scene:0,scenes:[{nodes:[0,1,2,3,4]}],nodes:[{name:'car',mesh:0},...Object.entries({FL:[0.86,0.34,1.24],FR:[-0.86,0.34,1.24],BL:[0.86,0.34,-1.25],BR:[-0.86,0.34,-1.25]}).map(([name,translation])=>({name,mesh:1,translation}))],meshes:[],materials:[
 {name:'Yaris paint and tinted glass',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:0.6}},
 {name:'Yaris tyres and alloy wheels',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:0.65}},
],accessors:[],bufferViews:[],buffers:[{byteLength:0}]};
let offset=0;const buffers=[];
function accessor(array,size,componentType,type,normalized=false,bounds=false){
 const padding=(4-offset%4)%4;if(padding){buffers.push(Buffer.alloc(padding));offset+=padding;}
 const view=doc.bufferViews.length, bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);
 doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});buffers.push(bytes);offset+=bytes.length;
 const a={bufferView:view,componentType,count:array.length/size,type};
 if(normalized)a.normalized=true;
 if(bounds){a.min=Array(size).fill(Infinity);a.max=Array(size).fill(-Infinity);for(let i=0;i<array.length;i++){
  const j=i%size;a.min[j]=Math.min(a.min[j],array[i]);a.max[j]=Math.max(a.max[j],array[i]);}}
 return doc.accessors.push(a)-1;
}
for(const [i,g] of [body,wheel].entries()){
 const attrs={};for(const [name,key] of [['position','POSITION'],['normal','NORMAL'],['color','COLOR_0']]){
  const a=g.attributes[name];attrs[key]=accessor(a.array,3,name==='color'?5121:5126,'VEC3',name==='color',name==='position');}
 const index=g.index.array;
 doc.meshes.push({name:i?'Yaris wheel shared':'Yaris body',primitives:[{attributes:attrs,indices:accessor(index,1,index instanceof Uint32Array?5125:5123,'SCALAR'),material:i}]});
}
const tail=(4-offset%4)%4;if(tail)buffers.push(Buffer.alloc(tail));doc.buffers[0].byteLength=offset;
const bin=Buffer.concat(buffers), text=Buffer.from(JSON.stringify(doc)), padded=Buffer.alloc(Math.ceil(text.length/4)*4,0x20);text.copy(padded);
const result=Buffer.alloc(12+8+padded.length+8+bin.length);result.write('glTF');result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);
result.writeUInt32LE(padded.length,12);result.writeUInt32LE(0x4e4f534a,16);padded.copy(result,20);
result.writeUInt32LE(bin.length,20+padded.length);result.writeUInt32LE(0x004e4942,24+padded.length);bin.copy(result,28+padded.length);
fs.writeFileSync('web/models/yaris.glb',result);
console.log(JSON.stringify({bytes:result.length,draws:5,triangles:body.index.count/3+4*wheel.index.count/3,materials:2,textures:0}));
