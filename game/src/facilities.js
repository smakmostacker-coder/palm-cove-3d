// Real-world facilities (Part I), wired into the economy + hotbar inventory:
// COVE MART minimarket (food), APOTIK SEHAT pharmacy (healing), MARLIN ARMS
// gun shop (AMMO ONLY — weapons are found in the world, never sold or given),
// SOLANO GAS + COVE BANK flavour frontage, the hospital treatment fee, and
// PALM COVE CORRECTIONAL — the prison that replaces the plain busted respawn:
// serve a short timed stay in the yard, or pay bail; the gate always opens.
import { G } from './state.js';
import { colliders } from './city.js';
import { addItem, ITEM_DEFS } from './inventory.js';
import { sfx } from './audio.js';
import { saveGame } from './save.js';

function signTex(text, fg, bg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
  g.font = '900 26px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = fg; g.shadowBlur = 12; g.fillStyle = fg; g.fillText(text, 128, 32);
  return new THREE.CanvasTexture(c);
}
const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
export const PRISON = { x: -168, z: -262, hw: 30, hd: 24, gate: { x: -168, z: -236 } };
export const FACILITIES = [
  { id: 'mart', name: 'COVE MART 24H', x: 30, z: 88, color: 0x27ae60, sign: '#7ef0d4', shop: [{ item: 'snack', price: 15 }, { item: 'cola', price: 8 }] },
  { id: 'apotik', name: 'APOTIK SEHAT', x: 88, z: -34, color: 0xf5f6fa, sign: '#2ed573', shop: [{ item: 'medkit', price: 60 }, { item: 'snack', price: 20 }] },
  { id: 'arms', name: 'MARLIN ARMS', x: -34, z: -88, color: 0x57606f, sign: '#ffd32a', shop: [{ item: 'ammo', price: 40 }, { item: 'armour', price: 120 }] },
  { id: 'gas', name: 'SOLANO GAS', x: 152, z: 34, color: 0xe67e22, sign: '#ffe9a8', shop: [{ item: 'cola', price: 8 }] },
  { id: 'bank', name: 'COVE BANK · ATM', x: -18, z: 20, color: 0x8e9aaf, sign: '#ffffff', shop: [] },
];
export function buildFacilities(scene) {
  for (const f of FACILITIES) {
    // Shops take over their plot: clear random building footprints nearby.
    for (let ci = colliders.length - 1; ci >= 0; ci--) if (Math.hypot(colliders[ci].x - f.x, colliders[ci].z - f.z) < 15) colliders.splice(ci, 1);
    const b = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 12), mat(f.color));
    b.position.set(f.x, 4, f.z); scene.add(b); colliders.push({ x: f.x, z: f.z, hw: 8, hd: 6 });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.2), new THREE.MeshBasicMaterial({ map: signTex(f.name, f.sign, '#14101f'), side: THREE.DoubleSide }));
    s.position.set(f.x, 7.2, f.z + 6.2); scene.add(s);
    f.door = { x: f.x, z: f.z + 8 };
  }
  // Prison compound on the Glades edge: cell block, yard, fence, watchtower.
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(PRISON.hw * 2, PRISON.hd * 2), mat(0x9a8f7a));
  yard.rotation.x = -Math.PI / 2; yard.position.set(PRISON.x, 0.02, PRISON.z); scene.add(yard);
  const cells = new THREE.Mesh(new THREE.BoxGeometry(34, 9, 10), mat(0x8e9aaf));
  cells.position.set(PRISON.x, 4.5, PRISON.z - PRISON.hd + 6); scene.add(cells);
  colliders.push({ x: PRISON.x, z: PRISON.z - PRISON.hd + 6, hw: 17, hd: 5 });
  const cs = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.4), new THREE.MeshBasicMaterial({ map: signTex('PALM COVE CORRECTIONAL', '#ffd32a', '#14101f'), side: THREE.DoubleSide }));
  cs.position.set(PRISON.x, 8.4, PRISON.z - PRISON.hd + 11.4); scene.add(cs);
  const fenceMat = mat(0x636e72);
  for (const [w, d, x, z] of [[PRISON.hw * 2, 0.4, PRISON.x, PRISON.z - PRISON.hd], [PRISON.hw * 2, 0.4, PRISON.x, PRISON.z + PRISON.hd], [0.4, PRISON.hd * 2, PRISON.x - PRISON.hw, PRISON.z], [0.4, PRISON.hd * 2, PRISON.x + PRISON.hw, PRISON.z]]) {
    const f2 = new THREE.Mesh(new THREE.BoxGeometry(w, 3.4, d), fenceMat); f2.position.set(x, 1.7, z); scene.add(f2);
  }
  const tower = new THREE.Mesh(new THREE.BoxGeometry(3, 11, 3), mat(0x57606f));
  tower.position.set(PRISON.x + PRISON.hw - 3, 5.5, PRISON.z - PRISON.hd + 3); scene.add(tower);
}
export function nearestFacility(pos) {
  for (const f of FACILITIES) if (Math.hypot(pos.x - f.door.x, pos.z - f.door.z) < 5) return f;
  return null;
}
export function buyItem(fac, itemId, sayFn) {
  const row = fac.shop.find((r) => r.item === itemId);
  if (!row) return 'Not sold here.';
  if (G.money < row.price) { sfx.fail(); return 'Not enough cash — $' + row.price + ' needed.'; }
  if (!addItem(itemId)) { sfx.fail(); return 'Inventory full — the clerk shakes their head.'; }
  G.money -= row.price; sfx.cash(); saveGame();
  return 'Bought ' + ITEM_DEFS[itemId].name + ' for $' + row.price + '.';
}
// Prison state lives on G: inPrison seconds remaining (0 = free).
G.inPrison = 0;
export function sendToPrison() {
  G.inPrison = 25;
  return { x: PRISON.x, z: PRISON.z + 6 };
}
export function updatePrison(dt, playerPos, sayFn) {
  if (G.inPrison <= 0) return '';
  G.inPrison -= dt;
  // The fence holds until release: clamp inside the yard.
  playerPos.x = Math.max(PRISON.x - PRISON.hw + 2, Math.min(PRISON.x + PRISON.hw - 2, playerPos.x));
  playerPos.z = Math.max(PRISON.z - PRISON.hd + 2, Math.min(PRISON.z + PRISON.hd - 2, playerPos.z));
  if (G.inPrison <= 0) { releasePrison(playerPos); sayFn && sayFn('Guard', 'Time served. Gate is open — stay out of trouble, Vera.', 4); return ''; }
  const bail = Math.min(200, G.money);
  return 'PRISON — serving ' + Math.ceil(G.inPrison) + 's · press B to pay $' + bail + ' bail';
}
export function payBail(playerPos, sayFn) {
  if (G.inPrison <= 0) return false;
  const bail = Math.min(200, G.money);
  G.money -= bail; G.inPrison = 0; releasePrison(playerPos);
  sayFn && sayFn('Guard', 'Bail posted: $' + bail + '. You are free to go.', 4);
  saveGame(); return true;
}
function releasePrison(playerPos) {
  playerPos.set(PRISON.gate.x, 0.3, PRISON.gate.z + 4);
}
