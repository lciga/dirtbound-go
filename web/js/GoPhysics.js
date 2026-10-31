// Browser interop only: the driving equations are compiled from internal/vehicle.
import '../wasm/wasm_exec.js';
const go = new Go();
const response = await fetch(new URL('../wasm/physics.wasm', import.meta.url));
if (!response.ok) throw new Error('Go physics is missing. Run ./tools/build.sh');
const bytes = await response.arrayBuffer();
const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
go.run(instance).catch(error => { console.error('Go runtime stopped', error); });
if (!globalThis.DirtboundGo) throw new Error('Go physics failed to initialize');
export const physics = globalThis.DirtboundGo;
