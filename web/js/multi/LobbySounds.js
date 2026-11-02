import { silenceWhenAway, isAway } from '../AudioFocus.js';

// One quiet two-note cue per membership update; ready/vote/state updates are silent.
export class LobbySounds {
 constructor(client){
  this.ctx=null;
  if(typeof window==='undefined')return;
  const unlock=()=>{try{if(!this.ctx){this.ctx=new AudioContext(); silenceWhenAway(this.ctx);} this.ctx.resume();}catch{} };
  window.addEventListener('pointerdown',unlock,{once:true});
  window.addEventListener('keydown',unlock,{once:true});
  client.addEventListener('presence',e=>{if(e.detail.left)this.play(false);if(e.detail.joined)this.play(true);});
 }
 play(joined){
  const ctx=this.ctx;if(!ctx||ctx.state!=='running'||isAway())return;
  const now=ctx.currentTime;
  for(let i=0;i<2;i++){
   const tone=ctx.createOscillator(),gain=ctx.createGain(),at=now+i*.10;
   tone.type='sine';tone.frequency.value=(joined?[440,660]:[520,330])[i];
   gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.055,at+.012);gain.gain.exponentialRampToValueAtTime(.0001,at+.16);
   tone.connect(gain).connect(ctx.destination);tone.start(at);tone.stop(at+.18);
   tone.onended=()=>{tone.disconnect();gain.disconnect();};
  }
 }
}
