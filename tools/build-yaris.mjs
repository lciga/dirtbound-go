// Procedural Toyota GR Yaris, matching the user-provided three-door reference.
// Same compact proportions and flat materials as the game's rally cars. +Z is FRONT.
// Usage: node tools/build-yaris.mjs
import fs from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_STYLE } from '../web/js/CarStyle.js';
const paint=0xe5e8e2, glass=0x171e26, rubber=0x20252c, silver=0xadb6bd;
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
 const ab=new THREE.Vector3().fromArray(points[1]).sub(new THREE.Vector3().fromArray(points[0]));
 const ac=new THREE.Vector3().fromArray(points[2]).sub(new THREE.Vector3().fromArray(points[0]));
 if(ab.cross(ac).lengthSq()<1e-16)return; // clipping can leave an edge-only polygon
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));parts.push(colorGeometry(g,color));
}
function loft(sections,roofColor=paint){
 const rings=sections.map(([z,w,top,bottom=0.24,base=w])=>[
  [-base*0.86,bottom,z],[base*0.86,bottom,z],[base,bottom+Math.min(0.10,(top-bottom)/3),z],[w,top-Math.min(0.08,(top-bottom)/3),z],
  [w*0.87,top,z],[-w*0.87,top,z],[-w,top-Math.min(0.08,(top-bottom)/3),z],[-base,bottom+Math.min(0.10,(top-bottom)/3),z],
 ]);
 for(let r=0;r<rings.length-1;r++)for(let i=0;i<8;i++)quad([rings[r][i],rings[r][(i+1)%8],rings[r+1][(i+1)%8],rings[r+1][i]],i===4?roofColor:paint);
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
// Reference: Toyota's 2021 UK brochure, pp. 14–15 and 32–33; 2020 rescue
// sheet for the roof/side outlines. Work in reference metres, then apply the
// pack's uniform toy scale once at export. +Z is the front of the car.
const axles=[-1.3925,1.1675], tyreRadius=.3186;
const bodySections=[[-1.9975,.79,.84],[-1.89,.865,.96],[-1.3925,.9025,1.025],[-.90,.87,1.015],[-.15,.84,1.015],[.60,.86,1.015],[1.1675,.9025,.985],[1.52,.89,.95],[1.82,.83,.89],[1.9975,.76,.835]];
function atSection(z,column){
 for(let i=1;i<bodySections.length;i++)if(z<=bodySections[i][0]){
  const a=bodySections[i-1],b=bodySections[i],t=(z-a[0])/(b[0]-a[0]);return a[column]+(b[column]-a[column])*t;
 }
 return bodySections.at(-1)[column];
}
const archRadius=.373;
const sectionZ=new Set(bodySections.map(s=>s[0]));
for(const axle of axles)for(let i=0;i<=8;i++)sectionZ.add(axle+Math.cos(Math.PI*i/8)*archRadius);
const bodyRings=[...sectionZ].sort((a,b)=>a-b).map(z=>{
 let bottom=.145;
 for(const axle of axles){const dz=z-axle;if(Math.abs(dz)<archRadius)bottom=Math.max(bottom,tyreRadius+Math.sqrt(archRadius**2-dz**2));}
 const width=atSection(z,1),top=atSection(z,2);
 return [z,width,top,bottom,width];
});
loft(bodyRings);
const bodySurface=parts.slice();
const cabinStart=parts.length;
const cabinSections=[[-1.93,.735,1.065,.94,.80],[-1.57,.66,1.37,1.00,.855],[-1.20,.65,1.435,1.01,.855],[-.55,.655,1.455,1.015,.84],[.22,.64,1.405,1.015,.84],[.91,.78,1.015,.975,.86]];
loft(cabinSections,0x20272c);
const cabinSurface=parts.slice(cabinStart);
const lightParts=[];
function luminous(...args){const at=parts.length;surfacePanel(...args);lightParts.push(...parts.splice(at));}
for(const side of [-1,1]){
 const sideGlass=p=>surfacePanel(cabinSurface,p,[2,1],n=>n[0]*side>.3,glass,.007);
 // The three-door Yaris has a single long front door and a short rising
 // quarter window. The narrow B-pillar is black, not a wide white wedge.
 sideGlass([[.815,1.047],[.22,1.355],[-.45,1.385],[-.64,1.345],[-.72,1.06]]);
 sideGlass([[-.76,1.06],[-.69,1.34],[-1.12,1.34],[-1.48,1.235],[-1.48,1.12],[-1.27,1.075]]);
 box(.026,.032,.145,side*.86,1.025,-.59,0xb7bdbb);
 const mirror=new THREE.BoxGeometry(.19,.12,.22).rotateY(-side*.18).translate(side*.94,1.06,.65);
 parts.push(colorGeometry(mirror,0x161d22));
 box(.026,.045,1.52,side*.845,.17,-.08,0x30373c);
 for(const axle of axles)for(let i=0;i<8;i++){
  const a=Math.PI*i/8,b=Math.PI*(i+1)/8;
  const point=(angle,r)=>[side*(atSection(axle+Math.cos(angle)*r,1)+.006),tyreRadius+Math.sin(angle)*r,axle+Math.cos(angle)*r];
  polygon([point(a,archRadius),point(b,archRadius),point(b,archRadius+.026),point(a,archRadius+.026)],paint,[side,0,0]);
 }
 const lamp=(p,color,offset=.009)=>surfacePanel(bodySurface,p.map(([x,z])=>[side*x,z]),[0,2],n=>n[1]>.15,color,offset);
 lamp([[.30,1.992],[.73,1.90],[.875,1.57],[.80,1.56],[.46,1.83]],0x19232b);
 lamp([[.36,1.972],[.715,1.88],[.84,1.61],[.79,1.605],[.48,1.855]],0xaab7bc,.013);
 luminous(bodySurface,[[side*.37,1.975],[side*.72,1.886],[side*.851,1.609],[side*.825,1.606],[side*.70,1.863],[side*.39,1.955]],[0,2],n=>n[1]>.15,0xf0f1e9,.017);
 // The characteristic vertical GR bumper openings, kept as broad planes.
 polygon([[side*.675,.245,2.001],[side*.78,.265,1.985],[side*.805,.63,1.97],[side*.68,.61,2.001]],0x172026,[0,0,1]);
 polygon([[side*.66,.64,2.005],[side*.80,.63,1.985],[side*.82,.67,1.967],[side*.68,.685,2.005]],0x172026,[0,0,1]);
 box(.075,.045,.022,side*.733,.325,2.012,0xe2e7e1);
 const rear=(outline,color,offset=.009)=>surfacePanel(bodySurface,outline.map(([x,y])=>[side*x,y]),[0,1],(n,c)=>n[2]<-.12&&c[2]<-1.70,color,offset);
 rear([[.49,.965],[.70,1.015],[.86,1.00],[.87,.845],[.72,.795],[.57,.845]],0x171d22);
 for(const stroke of [
  [[.53,.958],[.70,.99],[.835,.975],[.805,.947],[.70,.962],[.56,.932]],
  [[.805,.947],[.835,.975],[.835,.86],[.805,.878]],
  [[.835,.86],[.71,.827],[.60,.868],[.60,.895],[.715,.856],[.805,.878]],
 ])rear(stroke,0xd32c3c,.014);
 surfacePanel(bodySurface,[[-1.995,.87],[-1.84,.94],[-1.68,.965],[-1.69,1.005],[-1.88,.975],[-1.995,.925]],[2,1],(n,c)=>n[0]*side>.3&&c[2]<-1.65,0xc72c39,.011);
 // Only one door shut line; flared rear quarter remains uninterrupted.
 surfacePanel(bodySurface,[[-.89,.25],[-.89,1.00],[-.875,1.00],[-.875,.25]],[2,1],n=>n[0]*side>.3,0x899292,.009);
}
surfacePanel(cabinSurface,[[-.735,1.04],[.735,1.04],[.55,1.375],[-.55,1.375]],[0,1],(n,c)=>n[2]>.2&&c[2]>.2,glass,.008);
surfacePanel(cabinSurface,[[-.66,1.075],[.66,1.075],[.57,1.34],[-.57,1.34]],[0,1],(n,c)=>n[2]<-.2&&c[2]<-1.4,glass,.008);
box(1.31,.055,.19,0,1.389,-1.59,0x1a2227);
// Narrow upper grille, large lower opening and a painted bridge between them.
polygon([[-.60,.20,2.006],[.60,.20,2.006],[.645,.58,2.006],[.51,.695,2.006],[-.51,.695,2.006],[-.645,.58,2.006]],0x151d23,[0,0,1]);
for(let i=0;i<3;i++)box(1.05,.018,.012,0,.29+i*.12,2.017,0x343c42);
box(.90,.035,.018,0,.796,2.01,0x172026);
// Small flat badge, not a separate high-detail chrome object.
function oval(cx,cy,z,rx,ry,width,color){for(let i=0;i<12;i++){
 const a=i*Math.PI/6,b=(i+1)*Math.PI/6;
 polygon([[cx+rx*Math.cos(a),cy+ry*Math.sin(a),z],[cx+rx*Math.cos(b),cy+ry*Math.sin(b),z],[cx+(rx-width)*Math.cos(b),cy+(ry-width)*Math.sin(b),z],[cx+(rx-width)*Math.cos(a),cy+(ry-width)*Math.sin(a),z]],color,[0,0,1]);
}}
oval(0,.813,2.025,.065,.045,.009,silver);oval(0,.813,2.027,.021,.039,.007,silver);
box(.34,.09,.021,0,.535,2.025,0x20262c);box(.055,.045,.022,-.11,.535,2.038,0xcb2d35);
box(1.43,.035,.09,0,.155,1.97,paint);
// The connected black rear garnish and C-shaped clusters are GR signatures.
box(1.23,.047,.018,0,.963,-2.005,0x192127);
box(.34,.105,.021,0,.737,-2.008,0x1d252c);
box(1.30,.12,.09,0,.205,-1.97,0x1b2329);
for(const side of [-1,1]){
 const exhaust=new THREE.CylinderGeometry(.057,.057,.09,8).rotateX(Math.PI/2).translate(side*.56,.215,-1.998);
 parts.push(colorGeometry(exhaust,0x89969a));
 const bore=new THREE.CircleGeometry(.041,8).rotateY(Math.PI).translate(side*.56,.215,-2.045);
 parts.push(colorGeometry(bore,0x141b20));
}
// Broad geometric livery, like the pack's paint atlas and number plates.
const accent=0xcc2e32;
for(const side of [-1,1]){
 const flank=(p,color,offset=.009)=>surfacePanel(bodySurface,p,[2,1],n=>n[0]*side>.3,color,offset);
 flank([[-1.72,.25],[-1.20,.25],[.80,.93],[.43,.985]],accent);
 flank([[-1.72,.22],[-1.42,.22],[.72,.94],[.57,.98]],0x242b31,.013);
 flank([[-.48,.45],[.42,.45],[.42,.93],[-.48,.93]],0x1a2127,.016);
 const digits={2:[0,1,3,4,6],4:[1,2,3,5]};
 const segments=[[0,.115,.16,.024],[.075,.058,.025,.11],[-.075,.058,.025,.11],[0,0,.16,.024],[-.075,-.058,.025,.11],[.075,-.058,.025,.11],[0,-.115,.16,.024]];
 for(let d=0;d<2;d++)for(const segment of digits[d?4:2]){
  const [x,y,w,h]=segments[segment],z=side*((d?-.19:.13)-x);
  flank([[z-w/2,.69+y-h/2],[z+w/2,.69+y-h/2],[z+w/2,.69+y+h/2],[z-w/2,.69+y+h/2]],0xf2f2ea,.021);
 }
}
surfacePanel(bodySurface,[[-.19,1.00],[.22,1.00],[.31,1.91],[-.25,1.94]],[0,2],n=>n[1]>.5,0x20272c,.009);
surfacePanel(bodySurface,[[.23,1.00],[.34,1.00],[.43,1.88],[.33,1.91]],[0,2],n=>n[1]>.5,accent,.013);
const body=mergeGeometries(parts),lights=mergeGeometries(lightParts);
function cylinder(radius,width,segments,color){return colorGeometry(new THREE.CylinderGeometry(radius,radius,width,segments,1,false).rotateZ(Math.PI/2),color);}
const wheelParts=[cylinder(tyreRadius,.225,CAR_STYLE.wheelSides,rubber),cylinder(.237,.231,CAR_STYLE.wheelSides,0xd9dcda),cylinder(.208,.235,CAR_STYLE.wheelSides,0x192127)];
for(const side of [-1,1])for(let i=0;i<5;i++){
 const spoke=new THREE.BoxGeometry(.016,.202,.045).translate(0,.113,0).rotateX(i*Math.PI*2/5).translate(side*.122,0,0);
 wheelParts.push(colorGeometry(spoke,0xe4e8e1));
}
wheelParts.push(cylinder(.055,.247,10,0x929da0));
const wheel=mergeGeometries(wheelParts);
for(const g of [body,wheel,lights]){
 g.scale(CAR_STYLE.referenceModelScale,CAR_STYLE.referenceModelScale,CAR_STYLE.referenceModelScale);
 g.setIndex(new THREE.BufferAttribute(Uint16Array.from({length:g.attributes.position.count},(_,i)=>i),1));
}

const doc={asset:{version:'2.0',generator:'Racing Club 1sk4nd3r · tools/build-yaris.mjs',extras:{reference:'Toyota GR Yaris XP210 2020',referenceScale:CAR_STYLE.referenceModelScale,dimensionsMetres:[1.805,1.455,3.995],wheelbaseMetres:2.56}},scene:0,scenes:[{nodes:[0,1,2,3,4]}],nodes:[{name:'car',mesh:0,children:[5]},...Object.entries({FL:[.768,tyreRadius,axles[1]],FR:[-.768,tyreRadius,axles[1]],BL:[.786,tyreRadius,axles[0]],BR:[-.786,tyreRadius,axles[0]]}).map(([name,translation])=>({name,mesh:1,translation:translation.map(v=>v*CAR_STYLE.referenceModelScale)})),{name:'headlights',mesh:2}],meshes:[],materials:[
 {name:'Yaris paint and tinted glass',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:CAR_STYLE.roughness}},
 {name:'Yaris tyres and alloy wheels',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:0.65}},
 {name:'Lights',emissiveFactor:[.22,.22,.20],pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.6}}
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
for(const [i,g] of [body,wheel,lights].entries()){
 const attrs={};for(const [name,key] of [['position','POSITION'],['normal','NORMAL'],['color','COLOR_0']]){
  const a=g.attributes[name];attrs[key]=accessor(a.array,3,name==='color'?5121:5126,'VEC3',name==='color',name==='position');}
 const index=g.index.array;
 doc.meshes.push({name:i===2?'Yaris headlights':i?'Yaris wheel shared':'Yaris body',primitives:[{attributes:attrs,indices:accessor(index,1,index instanceof Uint32Array?5125:5123,'SCALAR'),material:i}]});
}
const tail=(4-offset%4)%4;if(tail)buffers.push(Buffer.alloc(tail));doc.buffers[0].byteLength=offset;
const bin=Buffer.concat(buffers), text=Buffer.from(JSON.stringify(doc)), padded=Buffer.alloc(Math.ceil(text.length/4)*4,0x20);text.copy(padded);
const result=Buffer.alloc(12+8+padded.length+8+bin.length);result.write('glTF');result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);
result.writeUInt32LE(padded.length,12);result.writeUInt32LE(0x4e4f534a,16);padded.copy(result,20);
result.writeUInt32LE(bin.length,20+padded.length);result.writeUInt32LE(0x004e4942,24+padded.length);bin.copy(result,28+padded.length);
fs.writeFileSync('web/models/yaris.glb',result);
console.log(JSON.stringify({bytes:result.length,draws:6,triangles:body.index.count/3+4*wheel.index.count/3+lights.index.count/3,materials:3,textures:0}));
