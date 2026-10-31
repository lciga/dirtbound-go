import fs from 'node:fs/promises';
import path from 'node:path';
const target='web/vendor/three';
await fs.mkdir(target,{recursive:true});
for(const dir of ['build','examples/jsm'])await fs.cp(path.join('node_modules/three',dir),path.join(target,dir),{recursive:true});
await fs.copyFile('node_modules/three/LICENSE',path.join(target,'LICENSE'));
for(const name of await fs.readdir('web')){
 if(!name.endsWith('.html'))continue;
 const p=path.join('web',name);let source=await fs.readFile(p,'utf8');
 source=source.replaceAll('https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js','./vendor/three/build/three.module.js').replaceAll('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/','./vendor/three/examples/jsm/');
 await fs.writeFile(p,source);
}
console.log('Three.js 0.185.1 vendored locally.');
