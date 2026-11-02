import { TRACK_CELLS, CELL_RAW, GRID_SCALE } from './Track.js';
import { speedKmh } from './RaceUnits.js';

// Bounded map samples, cached road image and a 10 Hz DOM/canvas update.
export function mapSamples({path,customCells,stage},limit=256){
 if(path){const out=[],step=Math.max(1,Math.ceil(path.sampleCount/limit));for(let i=0;i<path.sampleCount;i+=step)out.push([path.px[i],path.pz[i]]);return {points:out,closed:path.closed!==false};}
 if(stage){const n=stage.route.nodes,out=[],step=Math.max(1,Math.ceil(n.length/limit));for(let i=0;i<n.length;i+=step)out.push([n[i].x,n[i].z]);return {points:out,closed:false};}
 return {points:(customCells||TRACK_CELLS).map(([x,z])=>[(x+.5)*CELL_RAW*GRID_SCALE,(z+.5)*CELL_RAW*GRID_SCALE]),grid:true};
}
export class BetaHUD {
 constructor(track){
  this.track=track;this.elapsed=1;this.version=-1;this.logTimer=0;this.debug=new URLSearchParams(location.search).has('debug');
  const style=document.createElement('style');style.textContent=`.beta-dash{position:fixed;right:24px;bottom:24px;z-index:15;background:var(--card,#fff);color:var(--ink,#222);padding:14px 20px;border-radius:16px;pointer-events:none;min-width:138px}.beta-dash strong{font:48px/1 var(--brand,sans-serif)}.beta-dash small{font:900 12px var(--text,sans-serif)}.beta-dash meter{display:block;width:100%;height:12px;accent-color:#ff6a1a}.beta-map{position:fixed;left:24px;bottom:24px;width:192px;height:144px;z-index:15;border-radius:16px;background:#182129dd;pointer-events:none}@media(max-width:600px),(pointer:coarse){.beta-map{width:144px;height:108px;bottom:150px;left:12px}.beta-dash{bottom:150px;right:12px;padding:10px;min-width:110px}.beta-dash strong{font-size:36px}}`;
  document.head.append(style);
  this.el=document.createElement('aside');this.el.className='beta-dash';this.el.setAttribute('aria-label','Спидометр');
  this.el.innerHTML='<strong data-speed>0</strong> <small>км/ч</small><div><b data-gear>1</b> · <span data-rpm>1800</span> об/мин</div><meter min="0" max="7500" value="1800" aria-label="Обороты двигателя"></meter>';
  document.body.append(this.el);this.speed=this.el.querySelector('[data-speed]');this.gear=this.el.querySelector('[data-gear]');this.rpm=this.el.querySelector('[data-rpm]');this.meter=this.el.querySelector('meter');
  this.canvas=document.createElement('canvas');this.canvas.width=384;this.canvas.height=288;this.canvas.className='beta-map';this.canvas.setAttribute('aria-label','Карта трассы');document.body.append(this.canvas);this.ctx=this.canvas.getContext('2d');this.ctx.scale(2,2);
  this.background=document.createElement('canvas');this.background.width=192;this.background.height=144;
  this.buildMap();
 }
 buildMap(){
  const route=mapSamples(this.track),p=route.points;if(!p.length)return;
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const [x,z]of p){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  this.scale=Math.min(164/Math.max(1,maxX-minX),116/Math.max(1,maxZ-minZ));this.ox=96-(minX+maxX)/2*this.scale;this.oz=72-(minZ+maxZ)/2*this.scale;
  const ctx=this.background.getContext('2d');ctx.clearRect(0,0,192,144);ctx.strokeStyle='#d6e0d7';ctx.lineWidth=4;ctx.lineJoin=ctx.lineCap='round';
  if(route.grid){ctx.fillStyle='#d6e0d7';for(const[x,z]of p){const s=CELL_RAW*GRID_SCALE*this.scale;ctx.fillRect(this.ox+x*this.scale-s/2,this.oz+z*this.scale-s/2,s,s);}}
  else {ctx.beginPath();p.forEach(([x,z],i)=>ctx[i?'lineTo':'moveTo'](this.ox+x*this.scale,this.oz+z*this.scale));if(route.closed)ctx.closePath();ctx.stroke();}
  ctx.fillStyle='#ff6a1a';ctx.beginPath();ctx.arc(this.ox+p[0][0]*this.scale,this.oz+p[0][1]*this.scale,3,0,Math.PI*2);ctx.fill();
  this.version=this.track.stage?.route.nodes.length||0;
 }
 update(dt,vehicle){
  this.logTimer+=dt;this.elapsed+=dt;if(this.elapsed<.1)return;this.elapsed=0;
  if(this.track.stage&&this.track.stage.route.nodes.length!==this.version)this.buildMap();
  const t=vehicle.transmission;
  if(this.debug&&this.logTimer>=2){this.logTimer=0;console.info('[beta-transmission] '+JSON.stringify({speedKmh:Math.round(speedKmh(vehicle.sphereVel)),gear:t.gear,rpm:Math.round(t.rpm),shifting:t.shifting,load:t.load,grounded:t.grounded}));}
  this.speed.textContent=Math.round(speedKmh(vehicle.sphereVel));this.gear.textContent=t.gearLabel;this.rpm.textContent=Math.round(t.rpm/50)*50;this.meter.value=t.rpm;
  const ctx=this.ctx;ctx.clearRect(0,0,192,144);ctx.drawImage(this.background,0,0);ctx.save();ctx.translate(this.ox+vehicle.container.position.x*this.scale,this.oz+vehicle.container.position.z*this.scale);
  const q=vehicle.container.quaternion;ctx.rotate(-Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.x*q.x)));
  ctx.fillStyle='#ff6a1a';ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,6);ctx.lineTo(-4,-4);ctx.lineTo(4,-4);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
 }
}
