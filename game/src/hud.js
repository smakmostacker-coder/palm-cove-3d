// HUD: the GTA-register DOM layer (green money, gold stars, italic district
// name), the five-slot hotbar, and the canvas maps.
//
// Two maps, two jobs. The MINIMAP is a local window centred on the player —
// at peninsula scale a whole-world minimap would be unreadable — showing
// nearby roads, the mission marker, police blips and a HOME marker. The
// pause-menu FULL MAP draws the entire Florida silhouette: city at the
// southern tip, marsh, the long spine, the panhandle, the Keys arc.
import { G } from './state.js';
import { ROADS, WORLD, KEYS } from './config.js';
import { NORTH_END, PANHANDLE_Z } from './city.js';
import { ITEM_DEFS } from './inventory.js';
import { HOME } from './facilities.js';

const el = {};
export function initHud() {
  for (const id of ['healthFill', 'money', 'stars', 'objective', 'district', 'weapon', 'prompt', 'dialogue', 'dialogueWho', 'dialogueText', 'bustWrap', 'bustFill', 'banner', 'speed', 'hotbar', 'armourWrap', 'armourFill']) {
    el[id] = document.getElementById(id);
  }
  el.map = document.getElementById('minimap');
  el.mapCtx = el.map.getContext('2d');
  buildHotbar();
}

function buildHotbar() {
  if (!el.hotbar) return;
  el.hotbar.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('div');
    d.className = 'slot';
    d.dataset.slot = i;
    d.innerHTML = '<span class="slotKey">' + (i + 1) + '</span><span class="slotIcon"></span><span class="slotCount"></span>';
    d.title = 'Select slot ' + (i + 1);
    d.addEventListener('click', () => { window.__selectSlot && window.__selectSlot(i); });
    el.hotbar.appendChild(d);
  }
}

export function showDialogue(who, text, seconds) {
  if (!el.dialogue) return;
  el.dialogueWho.textContent = who;
  el.dialogueText.textContent = text;
  el.dialogue.style.display = 'block';
  G.dialogueUntil = G.time + (seconds || 4);
}
export function showBanner(text, seconds) {
  if (!el.banner) return;
  el.banner.textContent = text;
  el.banner.style.display = 'block';
  setTimeout(() => { el.banner.style.display = 'none'; }, (seconds || 2.5) * 1000);
}

let lastStars = -1, lastMoney = -1, lastInv = '';
export function updateHud(playerPos, targetPos, copPositions) {
  el.healthFill.style.width = Math.max(0, G.health) + '%';
  el.healthFill.style.background = G.health > 30 ? '#2ed573' : '#ff4757';
  if (el.armourWrap) {
    el.armourWrap.style.display = G.armour > 0 ? 'block' : 'none';
    el.armourFill.style.width = Math.min(100, G.armour / 60 * 100) + '%';
  }
  if (G.money !== lastMoney) { lastMoney = G.money; el.money.textContent = '$' + G.money; }
  if (G.wanted !== lastStars) {
    lastStars = G.wanted;
    el.stars.textContent = G.wanted ? '★'.repeat(G.wanted) + '☆'.repeat(5 - G.wanted) : '';
  }
  el.stars.style.color = Math.floor(G.time * 4) % 2 && G.wanted >= 4 ? '#ff6b81' : '#ffd32a';
  el.objective.textContent = G.objective || '';
  el.district.textContent = G.district;
  const ammo = G.weapon === 'Sniper' ? ' · ' + G.sniperAmmo + ' rounds' : G.weapon === 'Pistol' ? ' · ∞' : '';
  el.weapon.textContent = G.weapon + ammo + (G.driving ? ' · ' + Math.abs(Math.round((G.driving.speed || 0) * 3.6)) + ' km/h' : '');
  el.prompt.textContent = G.prompt || '';
  el.prompt.style.display = G.prompt ? 'block' : 'none';
  el.bustWrap.style.display = G.bust > 0.02 ? 'block' : 'none';
  el.bustFill.style.width = (G.bust * 100) + '%';
  if (el.dialogue.style.display === 'block' && G.time > G.dialogueUntil) el.dialogue.style.display = 'none';
  const invKey = G.selectedSlot + '|' + (G.inventory || []).map((s) => s ? s.id + s.count : '').join(',');
  if (invKey !== lastInv && el.hotbar) {
    lastInv = invKey;
    [...el.hotbar.children].forEach((d, i) => {
      const s = G.inventory[i];
      d.classList.toggle('sel', i === G.selectedSlot);
      d.querySelector('.slotIcon').textContent = s ? ITEM_DEFS[s.id].icon : '';
      d.querySelector('.slotCount').textContent = s && s.count > 1 ? '×' + s.count : '';
      d.title = s ? ITEM_DEFS[s.id].name : 'Empty slot';
    });
  }
  drawMinimap(playerPos, targetPos, copPositions);
}

// Draw the world into a canvas window: view = {cx, cz, halfW, halfH} in
// world units. Land, water, roads, the highway, the Keys, HOME, targets,
// police and the player arrow — clipped to the window, so the same code
// serves the local minimap and the whole-peninsula full map.
export function drawFloridaMap(c, S, W2, playerPos, targetPos, copPositions, view) {
  const v = view || { cx: 0, cz: (442 + NORTH_END) / 2, halfW: 720, halfH: (442 - NORTH_END) / 2 };
  const px = (x) => W2 / 2 + (x - v.cx) * (W2 / (v.halfW * 2));
  const pz = (z) => (z - (v.cz - v.halfH)) * (S / (v.halfH * 2));
  const sx = W2 / (v.halfW * 2), sz = S / (v.halfH * 2);
  c.fillStyle = '#0e6e8c'; c.fillRect(0, 0, W2, S); // ocean everywhere first
  c.fillStyle = '#5c6b35';
  c.fillRect(px(-212), pz(-436), 424 * sx, 236 * sz); // marsh
  c.fillStyle = '#4c8a4f';
  c.fillRect(px(-205), pz(-205), 410 * sx, 415 * sz); // city plateau
  c.fillRect(px(-188), pz(PANHANDLE_Z), 376 * sx, (-436 - PANHANDLE_Z) * sz); // spine land
  c.fillRect(px(-690), pz(NORTH_END), 1380 * sx, (PANHANDLE_Z - NORTH_END) * sz); // panhandle
  c.fillStyle = '#f2d492';
  c.fillRect(px(-232), pz(-205), 27 * sx, 415 * sz);
  c.fillRect(px(205), pz(-205), 27 * sx, 415 * sz); // city beaches
  c.strokeStyle = '#39404d';
  c.lineWidth = Math.max(2, 12 * sx);
  c.beginPath(); c.moveTo(px(0), pz(200)); c.lineTo(px(0), pz(436)); c.stroke(); // causeway
  c.beginPath(); c.moveTo(px(0), pz(-180)); c.lineTo(px(0), pz(NORTH_END)); c.stroke(); // highway
  c.lineWidth = Math.max(1, 7 * sx);
  c.beginPath();
  for (const r of ROADS) {
    c.moveTo(px(r), pz(-200)); c.lineTo(px(r), pz(200));
    c.moveTo(px(-200), pz(r)); c.lineTo(px(200), pz(r));
  }
  c.stroke();
  for (const k of KEYS) {
    c.fillStyle = '#4c8a4f';
    c.beginPath(); c.ellipse(px(0), pz(k.z), k.rx * sx, k.rz * sz, 0, 0, 7); c.fill();
    c.strokeStyle = '#f2d492'; c.stroke();
  }
  // HOME marker: a gold house square, on both maps.
  if (HOME) {
    c.fillStyle = '#ffd32a';
    c.fillRect(px(HOME.x) - 4, pz(HOME.z) - 4, 8, 8);
    c.fillStyle = '#14161c';
    c.font = '900 7px system-ui';
    c.fillText('H', px(HOME.x) - 2.5, pz(HOME.z) + 2.5);
  }
  if (targetPos) {
    c.fillStyle = '#ffd32a';
    c.beginPath(); c.arc(px(targetPos.x), pz(targetPos.z), 5, 0, 7); c.fill();
  }
  c.fillStyle = '#0066ff';
  for (const p of copPositions || []) { c.beginPath(); c.arc(px(p.x), pz(p.z), 3, 0, 7); c.fill(); }
  if (playerPos) {
    c.save();
    c.translate(px(playerPos.x), pz(playerPos.z));
    c.rotate(Math.PI - G.camYaw + Math.PI);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath(); c.fill();
    c.restore();
  }
}

function drawMinimap(playerPos, targetPos, copPositions) {
  // A local window: 110 units across, 140 deep, centred on the player.
  const view = { cx: playerPos.x, cz: playerPos.z, halfW: 55, halfH: 70 };
  drawFloridaMap(el.mapCtx, el.map.height, el.map.width, playerPos, targetPos, copPositions, view);
}

export function drawFullMap() {
  const cv = document.getElementById('fullmap');
  if (!cv) return;
  const c = cv.getContext('2d');
  drawFloridaMap(c, cv.height, cv.width, window.__playerPos || { x: 0, z: 0 }, null, []);
  c.fillStyle = '#ffd32a';
  c.font = '900 15px system-ui';
  c.fillText('PALM COVE · FLORIDA PENINSULA', 14, 22);
  c.font = '12px system-ui';
  c.fillStyle = '#fff';
  c.fillText('TALLAHASSEE PALMS — FAR SHORE', 14, 44);
  c.fillText('THE GLADES · THE SPINE →', 14, 62);
  c.fillText('KEY SOLANO →', 14, cv.height - 12);
}
