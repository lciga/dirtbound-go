// Browser interop only: the driving equations are compiled from internal/vehicle.
import '../wasm/wasm_exec.js';
const go = new Go();
const response = await fetch(new URL('../wasm/physics.wasm', import.meta.url));
if (!response.ok) throw new Error('Go physics is missing. Run ./tools/build.sh');
const { instance } = typeof WebAssembly.instantiateStreaming === 'function' && response.headers.get('Content-Type')?.startsWith('application/wasm')
 ? await WebAssembly.instantiateStreaming(response, go.importObject)
 : await WebAssembly.instantiate(await response.arrayBuffer(), go.importObject);
go.run(instance).catch(error => { console.error('Go runtime stopped', error); });
if (!globalThis.DirtboundGo) throw new Error('Go physics failed to initialize');
export const physics = globalThis.DirtboundGo;
