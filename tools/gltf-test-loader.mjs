import fs from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
// Node tests exercise real geometry, material and image wiring. Actual decoding
// and rendering of these images is checked separately in the browser.
globalThis.self ??= globalThis;
globalThis.ProgressEvent ??= class extends Event { constructor(type, values) { super(type); Object.assign(this, values); } };
globalThis.createImageBitmap ??= async () => ({width:1024,height:1024,close(){}});
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
 const url = String(input);
 if (/^models\/yaris\/wrap-[2-5]\.jpg$/.test(url)) {
  return new Response(await fs.readFile(new URL('../web/' + url, import.meta.url)), {headers:{'Content-Type':'image/jpeg'}});
 }
 return nativeFetch(input, init);
};
export function parseModel(bytes) {
 return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
