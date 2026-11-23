// HUD v2: GTA-register DOM (gold stars top-right, green money, bold italic
// district name), the 5-slot hotbar (Part H), and canvas maps that draw the
// Florida silhouette — peninsula, both beaches, the Keys arc and the marsh.
import { G } from './state.js';
import { ROADS, WORLD, KEYS } from './config.js';
import { ITEM_DEFS } from './inventory.js';

const el = {};
export function initHud() {
  for (const id of ['healthFill', 'money', 'stars', 'objective', 'district', 'weapon', 'prompt', 'dialogue', 'dialogueWho', 'dialogueText', 'bustWrap', 'bustFill', 'banner', 'speed', 'hotbar', 'armourWrap', 'armourFill'])
    el[id] = document.getElementById(id);
  el.map = document.getElementById('minimap');
  el.mapCtx = el.map.getContext('2d');
  buildHotbar();
}
function buildHotbar() {
  if (!el.hotbar) return;
  el.hotbar.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('div');
    d.className = 'slot'; d.dataset.slot = i;
    d.innerHTML = '<span class="slotKey">' + (i + 1) + '</span><span class="slotIcon"></span><span class="slotCount"></span>';
    d.title = 'Select slot ' + (i + 1);
    d.addEventListener('click', () => { window.__selectSlot && window.__selectSlot(i); });
    el.hotbar.appendChild(d);
  }
}
export function showDialogue(who, text, seconds) {
  if (!el.dialogue) return;
  el.dialogueWho.textContent = who; el.dialogueText.textContent = text;
  el.dialogue.style.display = 'block'; G.dialogueUntil = G.time + (seconds || 4);
}
export function showBanner(text, seconds) {
  if (!el.banner) return;
  el.banner.textContent = text; el.banner.style.display = 'block';
  setTimeout(() => { el.banner.style.display = 'none'; }, (seconds || 2.5) * 1000);
}
let lastStars = -1, lastMoney = -1, lastInv = '';
export function updateHud(playerPos, targetPos, copPositions) {
  el.healthFill.style.width = Math.max(0, G.health) + '%';
  el.healthFill.style.background = G.health > 30 ? '#2ed573' : '#ff4757';
  if (el.armourWrap) { el.armourWrap.style.display = G.armour > 0 ? 'block' : 'none'; el.armourFill.style.width = Math.min(100, G.armour / 60 * 100) + '%'; }
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
  // Hotbar refresh only when contents/selection change.
  const invKey = G.selectedSlot + '|' + G.inventory.map((s) => s ? s.id + s.count : '').join(',');
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
// World -> map transform covering the whole peninsula: x [-250,250], z [-450,455].
function mapProj(S, W2) {
  const sx = W2 / 500, sz = S / 905;
  return { px: (x) => W2 / 2 + x * sx, pz: (z) => (z + 450) * sz, sx, sz };
}
export function drawFloridaMap(c, S, W2, playerPos, targetPos, copPositions) {
  const { px, pz, sx } = mapProj(S, W2);
  c.fillStyle = '#0e6e8c'; c.fillRect(0, 0, W2, S);                       // ocean on three sides
  c.fillStyle = '#5c6b35'; c.fillRect(px(-212), pz(-436), 424 * sx, (436 - 200) * (S / 905)); // marsh
  c.fillStyle = '#4c8a4f'; c.fillRect(px(-205), pz(-205), 410 * sx, 415 * (S / 905));          // city plateau
  c.fillStyle = '#f2d492';
  c.fillRect(px(-232), pz(-205), 27 * sx, 415 * (S / 905)); c.fillRect(px(205), pz(-205), 27 * sx, 415 * (S / 905)); // beaches
  c.strokeStyle = '#39404d'; c.lineWidth = Math.max(2, 12 * sx);
  c.beginPath(); c.moveTo(px(0), pz(200)); c.lineTo(px(0), pz(436)); c.stroke();              // causeway
  c.lineWidth = Math.max(1, 7 * sx);
  c.beginPath();
  for (const r of ROADS) { c.moveTo(px(r), pz(-200)); c.lineTo(px(r), pz(200)); c.moveTo(px(-200), pz(r)); c.lineTo(px(200), pz(r)); }
  c.stroke();
  for (const k of KEYS) { c.fillStyle = '#4c8a4f'; c.beginPath(); c.ellipse(px(0), pz(k.z), k.rx * sx, k.rz * (S / 905), 0, 0, 7); c.fill(); c.strokeStyle = '#f2d492'; c.stroke(); }
  if (targetPos) { c.fillStyle = '#ffd32a'; c.beginPath(); c.arc(px(targetPos.x), pz(targetPos.z), 5, 0, 7); c.fill(); }
  c.fillStyle = '#0066ff';
  for (const p of copPositions || []) { c.beginPath(); c.arc(px(p.x), pz(p.z), 3, 0, 7); c.fill(); }
  if (playerPos) {
    c.save(); c.translate(px(playerPos.x), pz(playerPos.z)); c.rotate(Math.PI - G.camYaw + Math.PI);
    c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath(); c.fill(); c.restore();
  }
}
function drawMinimap(playerPos, targetPos, copPositions) {
  drawFloridaMap(el.mapCtx, el.map.height, el.map.width, playerPos, targetPos, copPositions);
}
export function drawFullMap() {
  const cv = document.getElementById('fullmap');
  if (!cv) return;
  const c = cv.getContext('2d');
  drawFloridaMap(c, cv.height, cv.width, window.__playerPos || { x: 0, z: 0 }, null, []);
  c.fillStyle = '#ffd32a'; c.font = '900 15px system-ui'; c.fillText('PALM COVE · FLORIDA PENINSULA', 14, 22);
  c.font = '12px system-ui'; c.fillStyle = '#fff';
  c.fillText('THE GLADES (marsh)', 14, 44); c.fillText('KEY SOLANO →', 14, cv.height - 12);
}
