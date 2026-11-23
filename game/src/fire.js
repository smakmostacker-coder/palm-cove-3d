// Fire system (Part C): heavily damaged vehicles catch fire, burn, and explode;
// a damkar fire truck responds to long-burning fires and sprays them out.
// Flames/smoke/water are cheap canvas-texture sprites from small fixed pools.
import { G } from './state.js';
import { FIRE_STATION } from './config.js';
import { makeVehicle, collideBuildings } from './city.js';
import { allVehicles } from './traffic.js';
import { peds } from './pedestrians.js';
import { commitCrime } from './police.js';
import { sfx } from './audio.js';

function dotTex(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let flameTex, smokeTex, waterTex, sceneRef = null;
const fires = [];        // {veh, t, group, smokes:[], exploded}
let truck = null;        // dispatched damkar unit {mesh,pos,angle,target,state,spray}
let sprayPts = null, sprayData = null;
export function initFire(scene) {
  sceneRef = scene;
  flameTex = dotTex('rgba(255,220,120,1)', 'rgba(255,80,0,0)');
  smokeTex = dotTex('rgba(90,90,90,0.55)', 'rgba(90,90,90,0)');
  waterTex = dotTex('rgba(190,230,255,0.9)', 'rgba(120,190,255,0)');
  const geo = new THREE.BufferGeometry();
  sprayData = new Float32Array(90 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(sprayData, 3));
  sprayPts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.9, map: waterTex, transparent: true, depthWrite: false }));
  sprayPts.visible = false; sprayPts.frustumCulled = false; scene.add(sprayPts);
}
function ignite(veh) {
  if (veh.burning || veh.burnt || !sceneRef) return;
  veh.burning = 1; veh.burnT = 0;
  const group = new THREE.Group();
  const flames = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false }));
    s.position.set((i - 1) * 0.7, 1.3 + i * 0.35, (i % 2 ? 0.5 : -0.5));
    s.scale.setScalar(1.6 + i * 0.5); group.add(s); flames.push(s);
  }
  const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false }));
  smoke.position.y = 3.4; smoke.scale.setScalar(2.6); group.add(smoke);
  group.position.copy(veh.pos); sceneRef.add(group);
  fires.push({ veh, t: 0, group, flames, smoke, exploded: false });
  sfx.crash();
}
export function charVehicle(veh) {
  veh.mesh.traverse((o) => { if (o.isMesh && o.material && o.material.color) o.material = o.material.clone(), o.material.color.multiplyScalar(0.22); });
}
function explode(f, playerPos) {
  f.exploded = true;
  const v = f.veh; v.burning = 0; v.burnt = true; v.health = 0; v.speed = 0;
  charVehicle(v);
  if (sceneRef) sceneRef.remove(f.group);
  sfx.boom(); commitCrime(Math.min(5, Math.max(3, G.wanted)), 'Vehicle explosion');
  for (const o of allVehicles()) {
    if (o === v || o.burnt) continue;
    const d = o.pos.distanceTo(v.pos);
    if (d < 10) { o.health -= 55; if (o.health < 35) ignite(o); }
  }
  for (const p of peds) if (p.mesh.position.distanceTo(v.pos) < 8) p.down = Math.max(p.down, 3);
  if (playerPos && playerPos.distanceTo(v.pos) < 9) G.health = Math.max(1, G.health - 30);
}
function dispatchTruck(firePos) {
  if (!sceneRef) return;
  const mesh = makeVehicle('firetruck', 0xd63031, {});
  mesh.position.set(FIRE_STATION.x - 14, 0, FIRE_STATION.z + 4); sceneRef.add(mesh);
  truck = { mesh, pos: mesh.position, angle: 0, state: 'drive', target: firePos, sprayT: 0 };
  sfx.firetruck();
}
export function updateFire(dt, playerPos) {
  // Ignition check: anything badly damaged can catch.
  for (const v of allVehicles()) if (!v.burning && !v.burnt && v.health > 0 && v.health < 32) ignite(v);
  if (G.driving && !G.driving.burning && !G.driving.burnt && G.driving.health > 0 && G.driving.health < 32) ignite(G.driving);
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i], v = f.veh;
    f.t += dt; v.burnT = f.t;
    f.group.position.copy(v.pos);
    f.flames.forEach((s, k) => { const sc = 1.5 + Math.sin(G.time * 17 + k * 2.1) * 0.45 + f.t * 0.05; s.scale.set(sc, sc * 1.5, 1); });
    f.smoke.position.y = 3.4 + Math.sin(G.time * 2) * 0.3; f.smoke.scale.setScalar(2.6 + f.t * 0.22);
    v.health -= 5 * dt;
    // Standing in the fire hurts.
    if (playerPos && G.onFoot && playerPos.distanceTo(v.pos) < 3.2) G.health = Math.max(0, G.health - 11 * dt);
    // Water from the damkar shrinks the fire back.
    if (v.sprayed > 0) { v.sprayed -= dt; f.t -= dt * 2.4; v.health = Math.min(45, v.health + 14 * dt); if (f.t <= 0) { v.burning = 0; v.health = 30; if (sceneRef) sceneRef.remove(f.group); fires.splice(i, 1); continue; } }
    const boomAt = truck ? 17 : 7.5; // a dispatched damkar buys the fire time to be fought
    if (f.t > boomAt && !f.exploded) { explode(f, playerPos); fires.splice(i, 1); continue; }
    // Long-burning fire calls the damkar.
    if (f.t > 4.5 && !truck) dispatchTruck(v.pos);
    if (truck && truck.state === 'park') truck.target = v.pos;
  }
  // Fire truck AI: drive to the fire, park, spray until it is out, then leave.
  if (truck) {
    const dx = truck.target.x - truck.pos.x, dz = truck.target.z - truck.pos.z;
    const d = Math.hypot(dx, dz);
    if (truck.state === 'drive') {
      if (d < 11) { truck.state = 'park'; }
      else {
        // Stuck recovery: if a building face blocks the straight line for over
        // a second, sidestep along the wall until the way is clear again.
        if (!truck.lastPos) { truck.lastPos = { x: truck.pos.x, z: truck.pos.z }; truck.stuckT = 0; truck.sideT = 0; }
        truck.stuckT += dt;
        if (truck.stuckT > 1) {
          const moved = Math.hypot(truck.pos.x - truck.lastPos.x, truck.pos.z - truck.lastPos.z);
          if (moved < 0.6 && truck.sideT <= 0) truck.sideT = 0.9;
          truck.lastPos = { x: truck.pos.x, z: truck.pos.z }; truck.stuckT = 0;
        }
        const sp = Math.min(17, 8 + d * 0.1);
        let mx = dx / d, mz = dz / d;
        if (truck.sideT > 0) { truck.sideT -= dt; const px = -mz, pz = mx; mx = px; mz = pz; }
        truck.pos.x += mx * sp * dt; truck.pos.z += mz * sp * dt;
        truck.angle = Math.atan2(mx, mz);
        collideBuildings(truck.pos, 2);
      }
    } else if (truck.state === 'park') {
      const f = fires.find((x) => x.veh.pos === truck.target) || fires[0];
      if (!f) { truck.state = 'leave'; sprayPts.visible = false; }
      else {
        f.veh.sprayed = 0.3; truck.angle = Math.atan2(f.veh.pos.x - truck.pos.x, f.veh.pos.z - truck.pos.z);
        sprayPts.visible = true; sfx.splash();
        for (let k = 0; k < 90; k++) {
          const u = (k % 30) / 30, side = (Math.floor(k / 30) - 1) * 0.35;
          sprayData[k * 3] = truck.pos.x + (f.veh.pos.x - truck.pos.x) * u + side * u * 3;
          sprayData[k * 3 + 1] = 2.6 - u * u * 1.4 + Math.sin(G.time * 9 + k) * 0.15;
          sprayData[k * 3 + 2] = truck.pos.z + (f.veh.pos.z - truck.pos.z) * u + side * u * 2;
        }
        sprayPts.geometry.attributes.position.needsUpdate = true;
      }
    } else { // leave: drive back toward the station, despawn on arrival
      const hx = FIRE_STATION.x - truck.pos.x, hz = FIRE_STATION.z - truck.pos.z, hd = Math.hypot(hx, hz);
      if (hd < 12) { sceneRef.remove(truck.mesh); truck = null; }
      else { truck.pos.x += (hx / hd) * 16 * dt; truck.pos.z += (hz / hd) * 16 * dt; truck.angle = Math.atan2(hx, hz); }
    }
    if (truck) {
      truck.mesh.position.copy(truck.pos); truck.mesh.rotation.y = truck.angle;
      if (truck.mesh.userData.lightbar) truck.mesh.userData.lightbar.material.color.setHex(Math.floor(G.time * 6) % 2 ? 0xff3838 : 0xffd32a);
      for (const w of truck.mesh.userData.wheels) w.rotation.x += dt * 6;
    }
  }
}
export function fireState() { return { fires: fires.length, truckOut: !!truck, truckState: truck ? truck.state : '' }; }
export function forceIgnite(veh) { if (veh) { veh.health = Math.min(veh.health, 20); ignite(veh); } }
