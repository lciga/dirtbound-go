import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('web');
async function walk(p){let out=[];for(const e of await fs.readdir(p,{withFileTypes:true})){const q=path.join(p,e.name);if(e.isDirectory())out.push(...await walk(q));else out.push(q)}return out}
const missing=[];let modules=0;
for(const f of await walk(root)){
 if(!/\.(js|html)$/.test(f)||f.includes('/vendor/'))continue;
 const src=await fs.readFile(f,'utf8');
 for(const match of src.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"`$]+)['"]/g)){
  const ref=match[1];if(!ref.startsWith('.'))continue;
  const target=path.resolve(path.dirname(f),ref);if(!target.startsWith(root+path.sep))continue;
  try{await fs.access(target);modules++}catch{missing.push({file:path.relative(root,f),ref})}
 }
}
if(missing.length){console.error(missing);process.exit(1)}
for(const name of ['index.html','play.html','editor.html','wasm/physics.wasm','wasm/wasm_exec.js','vendor/three/build/three.module.js','seed-circuits.json'])await fs.access(path.join(root,name));
console.log(`Asset check passed: ${modules} relative module imports, all entry points and Go WASM present.`);
