import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { themeSeason, setThemeSeason } from '../web/js/Theme.js';
import { BackfireGate } from '../web/js/Backfire.js';
import { Gearbox, REDLINE_RPM } from '../web/js/Gearbox.js';
import { seasonScenery } from '../web/js/Seasons.js';
import { TurboState, turboNoise } from '../web/js/TurboSound.js';

test('saved home/rally themes migrate; explicit valid URL overrides win', () => {
	assert.equal(themeSeason(), 'summer');
	assert.equal(themeSeason({homeSeason:'winter',rally:{season:'summer'}}), 'winter');
	assert.equal(themeSeason({rally:{season:'autumn'}}), 'autumn');
	const settings={homeSeason:'winter',rally:{length:5000}};
	setThemeSeason(settings, 'spring');
	assert.equal(themeSeason(settings), 'spring');
	assert.equal(settings.homeSeason, settings.rally.season);
	assert.equal(settings.rally.length, 5000);
	assert.equal(themeSeason(settings, 'autumn'), 'autumn');
	assert.equal(themeSeason(settings, 'invalid'), 'spring');
	assert.equal(themeSeason(settings), 'spring');
});

test('seasonal circuit meshes still share one material and keep geometry', () => {
	const root=new THREE.Group(), material=new THREE.MeshStandardMaterial();
	const geometry=new THREE.BoxGeometry();
	root.add(new THREE.Mesh(geometry,material), new THREE.Mesh(geometry,material));
	seasonScenery(root,'winter');
	assert.equal(root.children[0].material,root.children[1].material);
	assert.equal(root.children[0].geometry,geometry);
	assert.notEqual(root.children[0].material,material);
	assert.match(root.children[0].material.customProgramCacheKey(), /winter/);
});

test('all characters of the 3D logo produce nonempty finite geometry', async () => {
	const font=new FontLoader().parse(JSON.parse(await fs.readFile(new URL('../web/fonts/brand-logo.typeface.json',import.meta.url))));
	for (const char of new Set('RacingClub1sk4nd3r')) {
		const geometry=new TextGeometry(char,{font,size:1,depth:0.4});
		assert.ok(geometry.attributes.position.count>0,char);
		assert.ok(geometry.attributes.position.array.every(Number.isFinite),char);
	}
});

test('limiter pops require throttle and high RPM, stop during shifts, never catch up a stall', () => {
	const gate=new BackfireGate(()=>0.5);
	const state={rpm:7500,redline:7500,load:1,shifting:false};
	assert.equal(gate.update({...state,rpm:6500},0),false);
	assert.equal(gate.update({...state,load:0},0),false);
	assert.equal(gate.update({...state,shifting:true},0),false);
	const burst=[];
	for(let frame=0;frame<60;frame++) if(gate.update(state,frame/60)) burst.push({time:frame/60,level:gate.level});
	assert.equal(burst.length,6);
	assert.equal(burst[0].level,1);
	assert.equal(burst.at(-1).level,0.7);
	for(let i=1;i<burst.length;i++) assert.ok(burst[i].time-burst[i-1].time>=0.065);
	assert.equal(gate.update(state,6),false);
	assert.equal(gate.update({...state,load:0},6.1),false);
	assert.equal(gate.update(state,6.2),false);
	assert.equal(gate.update(state,10),true);
	assert.equal(gate.update(state,10),false);
	assert.equal(gate.update({...state,load:0},10.1),false);
});

test('ordinary cruising shifts through gears and stays below the continuous limiter',()=>{
 const box=new Gearbox();let shifts=0,previous=1;
 for(let i=0;i<120*15;i++){box.update(1/120,.94,1);if(box.gear!==previous){shifts++;previous=box.gear;}}
 assert.ok(shifts>=3);assert.equal(box.revLimit,false);assert.ok(box.rpm<box.redline-300);
 box.update(1/120,.5,-1);assert.equal(box.load,0);
});

test('turbo pressure builds under load and releases once on lift or shift', () => {
	const turbo=new TurboState();
	const state={rpm:7000,redline:7500,load:1,shifting:false};
	assert.equal(turbo.update(1/60,state),0);
	assert.ok(turbo.pressure<0.05); // no instant full boost
	for(let i=0;i<180;i++) assert.equal(turbo.update(1/60,state),0);
	assert.ok(turbo.pressure>0.8);
	const release=turbo.update(1/60,{...state,load:0});
	assert.ok(release>0.8);
	assert.ok(turbo.pressure<0.3);
	for(let i=0;i<120;i++) assert.equal(turbo.update(1/60,{...state,load:0}),0);
	assert.ok(turbo.pressure<0.001);
	for(let i=0;i<120;i++) turbo.update(1/60,state);
	assert.ok(turbo.update(1/60,{...state,shifting:true})>0.5);
	assert.equal(turbo.update(1/60,{...state,shifting:true}),0);
});

test('turbo remains quiet at idle and brief taps do not produce a valve burst', () => {
	const state={rpm:2100,redline:7500,load:0,shifting:false};
	const turbo=new TurboState();
	for(let i=0;i<120;i++) assert.equal(turbo.update(1/60,state),0);
	assert.equal(turbo.pressure,0);
	turbo.update(1/60,{...state,rpm:7000,load:1});
	assert.equal(turbo.update(1/60,state),0);
	const before=turbo.pressure;
	turbo.update(0,{...state,rpm:7000,load:1});
	assert.equal(turbo.pressure,before);
});

test('turbo noise is reusable bounded audio with faded endpoints', () => {
	for(const valve of [false,true]) {
		const data=turboNoise(44100,0.36,valve);
		assert.ok(data.every(x=>Number.isFinite(x)&&Math.abs(x)<=1));
		assert.equal(Math.abs(data[0]),0);
		assert.equal(Math.abs(data.at(-1)),0);
	}
});

test('recorded exhaust WAVs are short, nonempty PCM with faded endpoints', async () => {
	for(const index of [1,2,3]) {
		const bytes=await fs.readFile(new URL('../web/audio/backfire/'+index+'.wav',import.meta.url));
		assert.equal(bytes.toString('ascii',0,4),'RIFF');
		assert.equal(bytes.toString('ascii',8,12),'WAVE');
		assert.equal(bytes.readUInt16LE(20),1); // PCM
		assert.equal(bytes.readUInt16LE(22),1); // mono
		assert.equal(bytes.readUInt32LE(24),48000);
		assert.equal(bytes.readUInt16LE(34),16);
		assert.ok(bytes.length>13000&&bytes.length<16000);
		assert.equal(bytes.readInt16LE(44),0);
		assert.equal(bytes.readInt16LE(bytes.length-2),0);
		let peak=0;
		for(let i=44;i<bytes.length;i+=2) peak=Math.max(peak,Math.abs(bytes.readInt16LE(i)));
		assert.ok(peak>20000&&peak<32767);
	}
});
