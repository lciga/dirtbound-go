import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { SmokeTrails } from "../web/js/Particles.js";
import { decodeTrack, TrackPath } from "../web/js/SplineTrack.js";
import {
  ROCKET_ID,
  rocketId,
  OFFICIAL_PUBLISHED,
} from "../web/js/multi/Protocol.js";
test("all nine supplied circuits decode and have matching content IDs", async () => {
  const {
    data: { circuits },
  } = JSON.parse(await fs.readFile("web/seed-circuits.json", "utf8"));
  assert.equal(circuits.length, 9);
  for (const c of circuits) {
    assert.equal(
      createHash("sha256")
        .update("spline." + c.data)
        .digest("hex"),
      c.id,
    );
    const decoded = await decodeTrack(c.data),
      path = new TrackPath(decoded.nodes, decoded.closed);
    assert.equal(decoded.closed, true);
    assert.ok(path.sampleCount > 100);
    assert.ok([...path.px, ...path.pz].every(Number.isFinite));
    assert.ok(OFFICIAL_PUBLISHED.some((o) => o.id === c.id));
  }
});
test("smoke draws only live instances, expires completely, and idle frames upload nothing", () => {
  const smoke = new SmokeTrails(new THREE.Scene(), 0xffffff, { perShape: 4 }),
    vehicle = { driftIntensity: 0 };
  assert.deepEqual(
    smoke.meshes.map((m) => m.count),
    [0, 0, 0, 0],
  );
  const versions = smoke.meshes.map((m) => m.instanceMatrix.version);
  for (let i = 0; i < 100; i++) smoke.update(1 / 60, vehicle);
  assert.deepEqual(
    smoke.meshes.map((m) => m.instanceMatrix.version),
    versions,
  );
  for (let i = 0; i < 40; i++) smoke.emitAt(i, 0, 0);
  smoke.update(1 / 60, vehicle);
  const live = smoke.particles.filter((p) => p.life > 0).length;
  assert.equal(smoke.active, live);
  assert.equal(
    smoke.meshes.reduce((n, m) => n + m.count, 0),
    live,
  );
  assert.ok(live <= 16);
  for (const mesh of smoke.meshes)
    if (mesh.count) {
      assert.deepEqual(mesh.instanceMatrix.updateRanges, [
        { start: 0, count: mesh.count * 16 },
      ]);
      assert.deepEqual(mesh.instanceColor.updateRanges, [
        { start: 0, count: mesh.count * 3 },
      ]);
    }
  smoke.update(5, vehicle);
  assert.equal(smoke.active, 0);
  assert.deepEqual(
    smoke.meshes.map((m) => m.count),
    [0, 0, 0, 0],
  );
});
test("bonus rocket protocol accepts both existing and new PostgreSQL account IDs", () => {
  for (const account of ["abc123", "0123456789abcdef01234567"])
    assert.ok(ROCKET_ID.test(rocketId(account, 123, 0)));
  assert.ok(!ROCKET_ID.test(rocketId("x".repeat(40), 123, 0)));
});
test("mode previews exist and no longer depend on missing menu videos", async () => {
  const menu = await fs.readFile("web/js/menu/Menu.js", "utf8");
  assert.ok(!menu.includes("video/menu/"));
  for (const name of ["images/modes/circuit.svg", "images/themes/summer.webp"])
    assert.ok((await fs.stat("web/" + name)).size > 500);
});
