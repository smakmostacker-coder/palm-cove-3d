// HUD and overlays: everything the player reads sits here, so the
// simulation files never touch the DOM directly.
import { G } from './state.js';
import { PLACES, FACILITIES, TOWNS } from './config.js';
import { MAP_DATA } from './city.js';
import { player } from './player.js';

// Every id index.html declares; cached once so lookups stay cheap.
const DOM_IDS = [
  'menu', 'btnNew', 'btnLoad', 'btnSettings', 'btnStats',
  'choiceMenu', 'btnVera', 'btnDax', 'hud', 'moneyEl', 'healthFill',
  'starsEl', 'objectiveEl', 'bannerEl', 'dialogEl', 'dialogName',
  'dialogText', 'choiceRow', 'choiceA', 'choiceB', 'promptEl',
  'minimap', 'btnZoom', 'btnQuests', 'btnPause', 'joy', 'joyKnob',
  'joyBtns', 'btnRun', 'btnInteract', 'btnEnter', 'btnAttack',
  'btnRadio', 'dpad', 'padUp', 'padDown', 'padLeft', 'padRight',
  'btnGas', 'pauseMenu', 'btnResume', 'btnPauseSettings',
  'btnPauseStats', 'btnQuitToTitle', 'settingsMenu', 'setSound',
  'setFps', 'setQuality', 'setBrightness', 'setJoystick',
  'btnSettingsBack', 'mapOverlay', 'mapCanvas', 'placesList',
  'btnMapClose', 'btnMapReset', 'btnMapIn', 'btnMapOut',
  'questOverlay', 'questMain', 'questSide', 'btnQuestClose',
  'shopOverlay', 'shopTitle', 'shopItems', 'shopMoney', 'btnShopClose',
  'statsScreen', 'statsBody', 'btnStatsBack', 'endingScreen',
  'endingTitle', 'endingText', 'endingMeta', 'btnEndingClose',
  'scopeOverlay', 'prisonEl', 'prisonText', 'fadeEl', 'radioEl',
];
const els = {};
// Overlay name -> element key, so showOverlay can hide the lot at once.
const OVERLAYS = {
  menu: 'menu', choice: 'choiceMenu', pause: 'pauseMenu',
  settings: 'settingsMenu', map: 'mapOverlay', quests: 'questOverlay',
  shop: 'shopOverlay', stats: 'statsScreen', ending: 'endingScreen',
};
const ZOOM_LEVELS = ['NEAR', 'MID', 'FAR'];
const ZOOM_HALF = { NEAR: 55, MID: 140, FAR: 380 };
const RADIO_NAMES = ['Radio off', 'Neon FM', 'Cove Funk', 'Sunset Chill'];
// Island bounds the full map must fit at scale 1.
const ISLAND = { minX: -260, maxX: 260, minZ: -4520, maxZ: 520 };
let overlayName = null;
let dialogTimer = 0;
let bannerTimer = 0;
let choiceCallback = null;
let choiceOpen = false;
let shopState = null;
// Full-map view: scale 1 is the whole island, centre starts mid-peninsula.
const mapView = { scale: 1, cx: 0, cz: -2000 };
const mapPointers = new Map();
let pinchDist = 0;

function hideAllOverlays() {
  for (const key of Object.values(OVERLAYS)) {
    if (els[key]) els[key].style.display = 'none';
  }
}
export function showOverlay(name) {
  hideAllOverlays();
  overlayName = name || null;
  if (!overlayName) return;
  const node = els[OVERLAYS[overlayName]];
  if (node) node.style.display = 'flex';
  // A fresh map always opens on the whole island, never a stale pan.
  if (overlayName === 'map') resetMapView();
}
export function setHudVisible(on) {
  if (els.hud) els.hud.style.display = on ? 'block' : 'none';
}
export function isMapOpen() { return overlayName === 'map'; }
export function isShopOpen() { return overlayName === 'shop'; }
export function isChoiceOpen() { return choiceOpen; }

// A facility's face may arrive as a heading, a compass word, or a
// vector; normalise all three so door maths has one shape to use.
function faceDir(face) {
  if (typeof face === 'number') {
    return { x: Math.sin(face), z: Math.cos(face) };
  }
  if (face && typeof face === 'object') {
    const len = Math.hypot(face.x || 0, face.z || 0) || 1;
    return { x: (face.x || 0) / len, z: (face.z || 0) / len };
  }
  const table = {
    N: { x: 0, z: -1 }, NORTH: { x: 0, z: -1 },
    S: { x: 0, z: 1 }, SOUTH: { x: 0, z: 1 },
    E: { x: 1, z: 0 }, EAST: { x: 1, z: 0 },
    W: { x: -1, z: 0 }, WEST: { x: -1, z: 0 },
    NE: { x: 0.7071, z: -0.7071 }, NW: { x: -0.7071, z: -0.7071 },
    SE: { x: 0.7071, z: 0.7071 }, SW: { x: -0.7071, z: 0.7071 },
  };
  return table[String(face || 'S').toUpperCase()] || table.S;
}
function doorPoint(facility) {
  const d = faceDir(facility.face);
  return { x: facility.x + d.x * 7.5, z: facility.z + d.z * 7.5 };
}
// G.interior may hold an id, a name, or the facility object itself.
function currentFacility() {
  const cur = G.interior;
  if (!cur) return null;
  if (typeof cur === 'object') {
    return FACILITIES.find((f) => f.id === cur.id || f === cur) || cur;
  }
  return FACILITIES.find((f) => f.id === cur || f.name === cur) || null;
}
function facingAngle() {
  if (G.driving && typeof G.driving.angle === 'number') {
    return G.driving.angle;
  }
  return player.angle;
}
export function cycleMinimapZoom() {
  const idx = ZOOM_LEVELS.indexOf(G.minimapZoom);
  G.minimapZoom = ZOOM_LEVELS[(idx + 1) % ZOOM_LEVELS.length];
  return G.minimapZoom;
}

export function initHud() {
  for (const id of DOM_IDS) els[id] = document.getElementById(id);
  if (els.btnZoom) {
    els.btnZoom.addEventListener('click', () => cycleMinimapZoom());
  }
  if (els.btnMapIn) els.btnMapIn.addEventListener('click', () => zoomIn());
  if (els.btnMapOut) {
    els.btnMapOut.addEventListener('click', () => zoomOut());
  }
  if (els.btnMapReset) {
    els.btnMapReset.addEventListener('click', () => resetMapView());
  }
  if (els.btnMapClose) {
    els.btnMapClose.addEventListener('click', () => closeMap());
  }
  if (els.btnShopClose) {
    els.btnShopClose.addEventListener('click', () => closeShop());
  }
  if (els.btnQuestClose) {
    els.btnQuestClose.addEventListener('click', () => showOverlay(null));
  }
  if (els.choiceA) {
    els.choiceA.addEventListener('click', () => resolveChoice(0));
  }
  if (els.choiceB) {
    els.choiceB.addEventListener('click', () => resolveChoice(1));
  }
  wireMapPointer();
  hideAllOverlays();
}

// --- transient text: banner, dialog, prompt, objective ---
export function showBanner(text, secs) {
  if (!els.bannerEl) return;
  els.bannerEl.textContent = text;
  els.bannerEl.style.display = 'block';
  bannerTimer = typeof secs === 'number' ? secs : 2.5;
}
export function say(name, text, secs) {
  if (!els.dialogEl) return;
  if (els.dialogName) els.dialogName.textContent = name || '';
  if (els.dialogText) els.dialogText.textContent = text || '';
  els.dialogEl.style.display = 'block';
  dialogTimer = typeof secs === 'number' ? secs : 3.5;
}
export function setPrompt(text) {
  if (!els.promptEl) return;
  els.promptEl.textContent = text || '';
  els.promptEl.style.display = text ? 'block' : 'none';
}
export function setObjective(text) {
  if (els.objectiveEl) els.objectiveEl.textContent = text || '';
}
export function showChoice(text, options, onPick) {
  if (!els.dialogEl) return;
  if (els.dialogName) els.dialogName.textContent = '';
  if (els.dialogText) els.dialogText.textContent = text || '';
  els.dialogEl.style.display = 'block';
  // A choice waits for the player; the say() auto-hide must not eat it.
  dialogTimer = 0;
  if (els.choiceRow) els.choiceRow.style.display = 'flex';
  if (els.choiceA) els.choiceA.textContent = options[0] || '';
  if (els.choiceB) els.choiceB.textContent = options[1] || '';
  choiceCallback = typeof onPick === 'function' ? onPick : null;
  choiceOpen = true;
}
export function resolveChoice(index) {
  if (!choiceOpen) return;
  choiceOpen = false;
  if (els.choiceRow) els.choiceRow.style.display = 'none';
  if (els.dialogEl) els.dialogEl.style.display = 'none';
  const cb = choiceCallback;
  choiceCallback = null;
  if (cb) cb(index);
}

// --- per-frame refresh ---
export function updateHud(dt) {
  if (els.moneyEl) els.moneyEl.textContent = '$' + G.money;
  if (els.healthFill) {
    const pct = Math.max(0, Math.min(100, G.health));
    els.healthFill.style.width = pct + '%';
  }
  if (els.starsEl) {
    const wanted = Math.max(0, Math.min(5, G.wanted));
    els.starsEl.textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    // High heat should feel urgent, so four-plus stars pulse.
    const blink = wanted >= 4 && Math.floor(G.time * 2) % 2 === 0;
    els.starsEl.classList.toggle('blink', blink);
  }
  if (els.prisonEl) {
    if (G.inPrison > 0) {
      els.prisonEl.style.display = 'block';
      if (els.prisonText) {
        // Bail wording only once the gate officer can actually take it.
        els.prisonText.textContent = G.flags && G.flags.bailReady
          ? 'See the gate officer to pay bail'
          : 'Serving time — ' + Math.ceil(G.inPrison) + 's';
      }
    } else {
      els.prisonEl.style.display = 'none';
    }
  }
  if (els.radioEl) {
    els.radioEl.textContent = RADIO_NAMES[G.radioStation] || RADIO_NAMES[0];
  }
  if (els.btnZoom) els.btnZoom.textContent = 'ZOOM · ' + G.minimapZoom;
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0 && els.bannerEl) {
      els.bannerEl.style.display = 'none';
    }
  }
  if (dialogTimer > 0) {
    dialogTimer -= dt;
    if (dialogTimer <= 0 && els.dialogEl && !choiceOpen) {
      els.dialogEl.style.display = 'none';
    }
  }
  drawMinimap();
}

// --- shared map painting ---
function traceLand(ctx, project) {
  const outline = MAP_DATA.outline || [];
  if (outline.length < 3) return;
  ctx.beginPath();
  outline.forEach(([x, z], i) => {
    const p = project(x, z);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}
function paintBase(ctx, w, h, project) {
  // Water: a two-stop gradient so the sea has depth, not one flat fill.
  const sea = ctx.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0, '#11608c');
  sea.addColorStop(1, '#082f4d');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, w, h);
  // Sand pass first, slightly fat, so the coast reads as a beach rim.
  traceLand(ctx, project);
  ctx.fillStyle = '#d9c27a';
  ctx.fill();
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(0.97, 0.985);
  ctx.translate(-w / 2, -h / 2);
  traceLand(ctx, project);
  ctx.fillStyle = '#3f9e4d';
  ctx.fill();
  ctx.restore();
  // District tints, clipped to the land so they never spill into the sea:
  // the city reads warm and urban, the glades band darker green, and each
  // town sits on a pale settled patch.
  ctx.save();
  traceLand(ctx, project);
  ctx.clip();
  const cityA = project(-190, -190);
  const cityB = project(190, 190);
  ctx.fillStyle = 'rgba(216, 198, 152, 0.40)';
  ctx.fillRect(cityA.x, cityA.y, cityB.x - cityA.x, cityB.y - cityA.y);
  const glA = project(-260, -4400);
  const glB = project(260, -760);
  ctx.fillStyle = 'rgba(16, 62, 28, 0.30)';
  ctx.fillRect(glA.x, glA.y, glB.x - glA.x, glB.y - glA.y);
  ctx.fillStyle = 'rgba(232, 214, 164, 0.34)';
  const townR = Math.abs(project(95, 0).x - project(0, 0).x);
  for (const town of MAP_DATA.towns || TOWNS) {
    const p = project(town.x || 0, town.z);
    ctx.beginPath();
    ctx.arc(p.x, p.y, townR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Roads in two passes — a dark asphalt casing under a pale core — so the
  // network reads as streets rather than scratches on the grass.
  const roads = MAP_DATA.roads || [];
  ctx.lineCap = 'round';
  for (const pass of [[3.4, 'rgba(26, 26, 32, 0.9)'], [1.5, 'rgba(246, 241, 216, 0.95)']]) {
    ctx.strokeStyle = pass[1];
    ctx.lineWidth = pass[0];
    ctx.beginPath();
    for (const [x1, z1, x2, z2] of roads) {
      const a = project(x1, z1);
      const b = project(x2, z2);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
  // Trunk routes on top with a gold core: the highway/causeway spine and
  // Palm Boulevard, so the island's main axis shows at a glance.
  const hw = MAP_DATA.highway || { x: 0, to: -4400 };
  ctx.strokeStyle = 'rgba(255, 190, 60, 0.95)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  let a = project(hw.x, 430);
  let b = project(hw.x, hw.to);
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  a = project(-190, 0);
  b = project(190, 0);
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
// Tip from the facing vector directly, so the arrow cannot end up a
// quarter-turn out from a canvas-rotation sign mistake. World x maps
// right and z maps down, so the vector (sin a, cos a) is already in
// canvas space for a facing angle in the atan2(x, z) convention.
function paintArrow(ctx, cx, cy, angle, size, colour) {
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  const px = dz;
  const pz = -dx;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(cx + dx * size, cy + dz * size);
  ctx.lineTo(cx - dx * size * 0.7 + px * size * 0.55,
    cy - dz * size * 0.7 + pz * size * 0.55);
  ctx.lineTo(cx - dx * size * 0.7 - px * size * 0.55,
    cy - dz * size * 0.7 - pz * size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function drawMinimap() {
  const canvas = els.minimap;
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width || 180;
  const h = canvas.height || 180;
  const facility = currentFacility();
  let centreX = player.pos.x;
  let centreZ = player.pos.z;
  if (facility) {
    // Indoors the player dot is meaningless; anchor on the street door.
    const door = doorPoint(facility);
    centreX = door.x;
    centreZ = door.z;
  }
  const half = ZOOM_HALF[G.minimapZoom] || ZOOM_HALF.MID;
  const scale = (w / 2) / half;
  const project = (x, z) => ({
    x: w / 2 + (x - centreX) * scale,
    y: h / 2 + (z - centreZ) * scale,
  });
  paintBase(ctx, w, h, project);
  ctx.fillStyle = '#ffd23f';
  for (const f of FACILITIES) {
    const p = project(f.x, f.z);
    if (p.x < -4 || p.x > w + 4 || p.y < -4 || p.y > h + 4) continue;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  if (G.minimapZoom === 'FAR') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (const town of MAP_DATA.towns || TOWNS) {
      const p = project(town.x || 0, town.z);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
      ctx.fillText(town.name, p.x, p.y);
    }
    const pc = project(0, -16);
    if (pc.x > 0 && pc.x < w && pc.y > 0 && pc.y < h) {
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('PALM COVE', pc.x, pc.y);
    }
  }
  if (!facility) {
    paintArrow(ctx, w / 2, h / 2, facingAngle(), 8, '#ffd23f');
  } else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, h / 2 - 16, w, 32);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('INDOORS', w / 2, h / 2 - 2);
    ctx.font = '9px sans-serif';
    ctx.fillText(facility.name || '', w / 2, h / 2 + 11);
  }
}

// --- full map ---
function mapBaseScale(canvas) {
  const fitX = (canvas.width || 360) / (ISLAND.maxX - ISLAND.minX);
  const fitZ = (canvas.height || 640) / (ISLAND.maxZ - ISLAND.minZ);
  return Math.min(fitX, fitZ);
}
function mapProject(canvas) {
  const w = canvas.width || 360;
  const h = canvas.height || 640;
  const scale = mapBaseScale(canvas) * mapView.scale;
  return (x, z) => ({
    x: w / 2 + (x - mapView.cx) * scale,
    y: h / 2 + (z - mapView.cz) * scale,
  });
}
export function zoomIn() {
  mapView.scale = Math.min(13, mapView.scale * 1.6);
  if (isMapOpen()) drawMap();
}
export function zoomOut() {
  mapView.scale = Math.max(1, mapView.scale / 1.6);
  if (isMapOpen()) drawMap();
}
export function resetMapView() {
  mapView.scale = 1;
  mapView.cx = (ISLAND.minX + ISLAND.maxX) / 2;
  mapView.cz = (ISLAND.minZ + ISLAND.maxZ) / 2;
  if (isMapOpen()) drawMap();
}
function wireMapPointer() {
  const canvas = els.mapCanvas;
  if (!canvas) return;
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    mapPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (mapPointers.size === 2) {
      const [a, b] = [...mapPointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!mapPointers.has(ev.pointerId)) return;
    const prev = mapPointers.get(ev.pointerId);
    mapPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (mapPointers.size === 2) {
      // Two fingers steer zoom only; panning mid-pinch jumps the view.
      const [a, b] = [...mapPointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && dist > 0) {
        mapView.scale = Math.max(1,
          Math.min(13, mapView.scale * (dist / pinchDist)));
      }
      pinchDist = dist;
      drawMap();
      return;
    }
    const scale = mapBaseScale(canvas) * mapView.scale;
    mapView.cx -= (ev.clientX - prev.x) / scale;
    mapView.cz -= (ev.clientY - prev.y) / scale;
    drawMap();
  });
  const release = (ev) => {
    mapPointers.delete(ev.pointerId);
    if (mapPointers.size < 2) pinchDist = 0;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}
export function drawMap() {
  const canvas = els.mapCanvas;
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width || 360;
  const h = canvas.height || 640;
  const project = mapProject(canvas);
  paintBase(ctx, w, h, project);
  ctx.textAlign = 'center';
  for (const f of MAP_DATA.facilities || FACILITIES) {
    const p = project(f.x, f.z);
    if (p.x < -20 || p.x > w + 20 || p.y < -10 || p.y > h + 10) continue;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '8px sans-serif';
    ctx.fillText(f.name, p.x, p.y - 5);
  }
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#ffffff';
  for (const town of MAP_DATA.towns || TOWNS) {
    const p = project(town.x || 0, town.z);
    if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
    ctx.fillText(town.name, p.x, p.y);
  }
  const pc = project(0, -18);
  if (pc.x > 0 && pc.x < w && pc.y > 0 && pc.y < h) {
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('PALM COVE', pc.x, pc.y);
  }
  const prison = MAP_DATA.prison;
  if (prison) {
    const p = project(prison.x || 0, prison.z);
    ctx.fillStyle = '#ff5a5a';
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    ctx.font = '9px sans-serif';
    ctx.fillText(prison.name || 'Prison', p.x, p.y - 6);
  }
  const keyTown = MAP_DATA.keyTown;
  if (keyTown) {
    const p = project(keyTown.x || 0, keyTown.z);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    ctx.fillStyle = '#ffffff';
    ctx.font = '9px sans-serif';
    ctx.fillText(keyTown.name || 'Key Solano', p.x, p.y - 6);
  }
  const pp = project(player.pos.x, player.pos.z);
  paintArrow(ctx, pp.x, pp.y, facingAngle(), 9, '#ffd23f');
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}
export function renderPlaces() {
  if (!els.placesList) return;
  els.placesList.innerHTML = '';
  for (const place of PLACES) {
    const row = document.createElement('div');
    row.className = 'place-row';
    row.textContent = place.name + ' — ' + place.area;
    els.placesList.appendChild(row);
  }
}
export function openMap() {
  // Mode is the world loop's gate, so opening the map must pause it.
  G.mode = 'map';
  showOverlay('map');
  resetMapView();
  renderPlaces();
  drawMap();
}
export function closeMap() {
  showOverlay(null);
  // Only hand the loop back if the map was the thing holding it.
  if (G.mode === 'map') G.mode = 'playing';
}

// --- shop ---
function renderShop() {
  if (!shopState) return;
  if (els.shopTitle) els.shopTitle.textContent = shopState.title;
  if (els.shopMoney) els.shopMoney.textContent = 'Cash: $' + G.money;
  if (!els.shopItems) return;
  els.shopItems.innerHTML = '';
  shopState.items.forEach((item, index) => {
    const btn = document.createElement('button');
    btn.textContent = item.name + ' — $' + item.price;
    // Unaffordable rows stay visible but visibly dead, not hidden.
    if (G.money < item.price) {
      btn.disabled = true;
      btn.classList.add('disabled');
      btn.style.opacity = '0.45';
    }
    btn.addEventListener('click', () => {
      if (shopState.onBuy) shopState.onBuy(index);
      renderShop();
    });
    els.shopItems.appendChild(btn);
  });
}
export function openShop(title, items, onBuy) {
  shopState = { title, items, onBuy };
  // Same gate as the map: shopping pauses the world loop.
  G.mode = 'shop';
  showOverlay('shop');
  renderShop();
}
export function closeShop() {
  shopState = null;
  showOverlay(null);
  if (G.mode === 'shop') G.mode = 'playing';
}

// --- quests, stats, ending, scope ---
export function renderQuests(quests) {
  const fill = (node, list) => {
    if (!node) return;
    node.innerHTML = '';
    if (!list || list.length === 0) {
      const row = document.createElement('div');
      row.className = 'quest-row';
      row.textContent = 'None';
      node.appendChild(row);
      return;
    }
    for (const quest of list) {
      const row = document.createElement('div');
      row.className = 'quest-row';
      const label = document.createElement('span');
      label.textContent = quest.title;
      const tag = document.createElement('span');
      tag.className = 'quest-state';
      tag.textContent = quest.state;
      row.appendChild(label);
      row.appendChild(tag);
      node.appendChild(row);
    }
  };
  fill(els.questMain, quests ? quests.main : []);
  fill(els.questSide, quests ? quests.side : []);
}
function statRow(label, value) {
  const row = document.createElement('div');
  row.className = 'stat-row';
  const name = document.createElement('span');
  name.textContent = label;
  const val = document.createElement('span');
  val.textContent = String(value);
  row.appendChild(name);
  row.appendChild(val);
  return row;
}
export function showStats() {
  if (els.statsBody) {
    els.statsBody.innerHTML = '';
    const s = G.stats;
    const rows = [
      ['Earned', '$' + s.earned], ['Busted', s.busted],
      ['Wasted', s.wasted], ['Spared', s.spared],
      ['Took out', s.tookOut], ['Cars stolen', s.carsStolen],
      ['Jobs done', s.jobsDone],
      ['Distance', s.distanceKm.toFixed(1) + ' km'],
      ['Choices made', s.choices.length],
      ['Endings found', G.endingsFound.length + ' of 6'],
    ];
    for (const [label, value] of rows) {
      els.statsBody.appendChild(statRow(label, value));
    }
  }
  showOverlay('stats');
}
export function showEnding(title, text, meta) {
  if (els.endingTitle) els.endingTitle.textContent = title || '';
  if (els.endingText) els.endingText.textContent = text || '';
  if (els.endingMeta) els.endingMeta.textContent = meta || '';
  showOverlay('ending');
}
export function setScope(on) {
  if (els.scopeOverlay) {
    els.scopeOverlay.style.display = on ? 'block' : 'none';
  }
}
