// HUD: DOM bars/text plus a 2D-canvas minimap (roads, player arrow, mission
// marker, police blips, beach edge).
import { G } from './state.js';
import { ROADS, WORLD } from './config.js';

const el = {};
export function initHud() {
  for (const id of ['healthFill', 'money', 'stars', 'objective', 'district', 'weapon', 'prompt', 'dialogue', 'dialogueWho', 'dialogueText', 'bustWrap', 'bustFill', 'banner', 'speed'])
    el[id] = document.getElementById(id);
  el.map = document.getElementById('minimap');
  el.mapCtx = el.map.getContext('2d');
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
let lastStars = -1, lastMoney = -1;
export function updateHud(playerPos, targetPos, copPositions) {
  el.healthFill.style.width = Math.max(0, G.health) + '%';
  el.healthFill.style.background = G.health > 30 ? '#2ed573' : '#ff4757';
  if (G.money !== lastMoney) { lastMoney = G.money; el.money.textContent = '$' + G.money; }
  if (G.wanted !== lastStars) {
    lastStars = G.wanted;
    el.stars.textContent = G.wanted ? '★'.repeat(G.wanted) + '☆'.repeat(5 - G.wanted) : '';
    el.stars.style.color = Math.floor(G.time * 4) % 2 && G.wanted >= 4 ? '#ff6b81' : '#ffd32a';
  }
  el.objective.textContent = G.objective || '';
  el.district.textContent = G.district;
  el.weapon.textContent = G.weapon + (G.driving ? ' · ' + Math.abs(Math.round((G.driving.speed || 0) * 3.6)) + ' km/h' : '');
  el.prompt.textContent = G.prompt || '';
  el.prompt.style.display = G.prompt ? 'block' : 'none';
  el.bustWrap.style.display = G.bust > 0.02 ? 'block' : 'none';
  el.bustFill.style.width = (G.bust * 100) + '%';
  if (el.dialogue.style.display === 'block' && G.time > G.dialogueUntil) el.dialogue.style.display = 'none';
  drawMinimap(playerPos, targetPos, copPositions);
}
function drawMinimap(playerPos, targetPos, copPositions) {
  const c = el.mapCtx, S = el.map.width, half = S / 2;
  const scale = S / (WORLD * 2 + 60);
  const px = (x) => half + x * scale, pz = (z) => half + z * scale;
  c.fillStyle = '#58b368'; c.fillRect(0, 0, S, S);
  c.fillStyle = '#118ab2'; c.fillRect(px(WORLD + 28), 0, S, S);
  c.fillStyle = '#f7e3a1'; c.fillRect(px(WORLD - 2), 0, px(WORLD + 28) - px(WORLD - 2), S);
  c.strokeStyle = '#3d4451'; c.lineWidth = Math.max(2, 15 * scale);
  c.beginPath();
  for (const r of ROADS) { c.moveTo(px(r), 0); c.lineTo(px(r), S); c.moveTo(0, pz(r)); c.lineTo(S, pz(r)); }
  c.stroke();
  if (targetPos) { c.fillStyle = '#ffd32a'; c.beginPath(); c.arc(px(targetPos.x), pz(targetPos.z), 5, 0, 7); c.fill(); }
  c.fillStyle = '#0066ff';
  for (const p of copPositions || []) { c.beginPath(); c.arc(px(p.x), pz(p.z), 3, 0, 7); c.fill(); }
  // Player arrow, pointing along the camera/move heading
  c.save(); c.translate(px(playerPos.x), pz(playerPos.z)); c.rotate(Math.atan2(Math.sin(G.camYaw), Math.cos(G.camYaw)) * 0 + (Math.PI - G.camYaw) * -1 + Math.PI);
  c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath(); c.fill(); c.restore();
}
