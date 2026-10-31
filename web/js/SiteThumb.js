// Lightweight catalogue thumbnails: read node geometry only, without Three.js,
// terrain decompression, or the game's sampled collision path.
export function trackOutline(encoded) {
  const bytes = Uint8Array.from(
    atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  if (bytes.length < 4) throw Error("Truncated track");
  const v = new DataView(bytes.buffer),
    version = v.getUint8(0),
    stride = { 1: 6, 2: 8, 3: 9, 4: 13 }[version],
    count = v.getUint16(2, true),
    closed = !!(v.getUint8(1) & 1);
  if (!stride || count < 2 || count > 4096 || bytes.length < 4 + count * stride)
    throw Error("Invalid track");
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const o = 4 + i * stride,
      w = version === 4 ? 4 : 0;
    nodes.push({
      x: (w ? v.getInt32(o, true) : v.getInt16(o, true)) / 20,
      z: (w ? v.getInt32(o + 4, true) : v.getInt16(o + 2, true)) / 20,
      a: (v.getUint16(o + 4 + w, true) / 65536) * Math.PI * 2,
    });
  }
  const points = [];
  for (let i = 0; i < (closed ? count : count - 1); i++) {
    const a = nodes[i],
      b = nodes[(i + 1) % count],
      distance = Math.hypot(b.x - a.x, b.z - a.z);
    let delta = Math.abs(((b.a - a.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const arm =
      delta < 0.001
        ? distance / 3
        : (distance * (4 / 3) * Math.tan(delta / 4)) /
          (2 * Math.sin(delta / 2));
    const c = { x: a.x + Math.sin(a.a) * arm, z: a.z + Math.cos(a.a) * arm },
      d = { x: b.x - Math.sin(b.a) * arm, z: b.z - Math.cos(b.a) * arm };
    for (let k = 0; k < 8; k++) {
      const t = k / 8,
        u = 1 - t;
      points.push([
        u * u * u * a.x +
          3 * u * u * t * c.x +
          3 * u * t * t * d.x +
          t * t * t * b.x,
        u * u * u * a.z +
          3 * u * u * t * c.z +
          3 * u * t * t * d.z +
          t * t * t * b.z,
      ]);
    }
  }
  if (!closed) points.push([nodes.at(-1).x, nodes.at(-1).z]);
  const xs = points.map((p) => p[0]),
    zs = points.map((p) => p[1]),
    minX = Math.min(...xs),
    minZ = Math.min(...zs),
    dx = Math.max(...xs) - minX,
    dz = Math.max(...zs) - minZ,
    scale = 80 / Math.max(dx, dz, 1);
  const coords = points.map(([x, z]) => [
    (10 + (80 - dx * scale) / 2 + (x - minX) * scale).toFixed(2),
    (10 + (80 - dz * scale) / 2 + (z - minZ) * scale).toFixed(2),
  ]);
  return {
    d: "M" + coords.map((p) => p.join(" ")).join("L") + (closed ? "Z" : ""),
    start: coords[0],
    nodes: count,
    closed,
  };
}
export function thumbnail(encoded) {
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  try {
    const outline = trackOutline(encoded),
      path = document.createElementNS(ns, "path"),
      start = document.createElementNS(ns, "circle");
    path.setAttribute("d", outline.d);
    path.setAttribute("class", "road");
    start.setAttribute("cx", outline.start[0]);
    start.setAttribute("cy", outline.start[1]);
    start.setAttribute("r", "3");
    start.setAttribute("class", "start");
    svg.append(path, start);
  } catch {}
  return svg;
}
