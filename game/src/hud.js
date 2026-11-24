// HUD: the GTA-register DOM layer (green money, gold stars, italic district
// name), the five-slot hotbar, and the canvas maps.
//
// Two maps, two jobs. The MINIMAP is a local window centred on the player —
// at peninsula scale a whole-world minimap would be unreadable — showing
// nearby roads, the mission marker, police blips and a HOME marker. The
// pause-menu FULL MAP draws the entire Florida silhouette: city at the
// southern tip, marsh, the long spine, the panhandle, the Keys arc.
import { G } from './state.js';
import { ROADS, WORLD, KEYS, MARSH, districtAt } from './config.js';
import { NORTH_END, PANHANDLE_Z, SOUTH_STREETS, TOWN_STREETS, DIAG_SEG, PROM_POINTS, landHalfWidthAt, buildingRecords, MARSH_CHANNELS, MARSH_ROAD, FLYOVER_SEG, LAKE_OKEECHOBEE } from './city.js'; // PANHANDLE_Z: coastPoly's breakpoint list
import { ITEM_DEFS } from './inventory.js';
import { HOME, FACILITIES, ENTERABLES, PLACES, PRISON, currentInterior } from './facilities.js';
import { settings, saveSettings } from './settings.js';

const el = {};
export function initHud() {
  for (const id of ['healthFill', 'money', 'stars', 'objective', 'district', 'weapon', 'prompt', 'dialogue', 'dialogueWho', 'dialogueText', 'bustWrap', 'bustFill', 'banner', 'speed', 'hotbar', 'armourWrap', 'armourFill']) {
    el[id] = document.getElementById(id);
  }
  el.map = document.getElementById('minimap');
  el.mapCtx = el.map.getContext('2d');
  el.zoomBtn = document.getElementById('zoomBtn');
  if (el.zoomBtn) {
    syncZoomBtn();
    // A plain click (touch taps synthesize one): cycles the level without
    // touching the minimap canvas's own tap-to-full-map handler.
    el.zoomBtn.addEventListener('click', () => cycleMapZoom());
  }
  buildHotbar();
}

// ---- Minimap zoom -----------------------------------------------------------
// Three window sizes for the local minimap, cycled by the ZOOM button beside
// it and persisted as settings.mapZoom (index into this table). Mid is the
// original Palm Cove window. drawFloridaMap is fully data-driven and clips
// to whatever view it is handed, so every level renders the same world.
export const MAP_ZOOM_LEVELS = [
  { name: 'NEAR', halfW: 30, halfH: 38 },
  { name: 'MID', halfW: 55, halfH: 70 },
  { name: 'FAR', halfW: 110, halfH: 140 },
];
export function mapZoomIndex() {
  const i = settings.mapZoom | 0;
  return i >= 0 && i < MAP_ZOOM_LEVELS.length ? i : 1;
}
let lastZoomLabel = '';
export function syncZoomBtn() {
  if (!el.zoomBtn) return;
  const label = 'ZOOM · ' + MAP_ZOOM_LEVELS[mapZoomIndex()].name;
  if (label !== lastZoomLabel) { lastZoomLabel = label; el.zoomBtn.textContent = label; }
}
export function cycleMapZoom() {
  settings.mapZoom = (mapZoomIndex() + 1) % MAP_ZOOM_LEVELS.length;
  saveSettings();
  syncZoomBtn();
  return settings.mapZoom;
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
  // Touch devices get the on-screen controls (joystick + E/F/X buttons)
  // automatically: settings.js promises this auto-enable, but the touch.js
  // it names was never written, so phone players had NO interact button at
  // all and could not enter any building. Enforce it here, every frame,
  // where main.js's enforceChrome reads settings.joystick.
  if (!settings.joystick && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) settings.joystick = true;
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

// ---- Static map geometry, precomputed once at module load ---------------
// The landmass is NOT hand-drawn rectangles any more: each tone band's
// coastline polygon is sampled from city.js's landHalfWidthAt(z) — the same
// half-width function clampWorld uses — so the map's coast is the world's
// coast: panhandle (half 690) north of PANHANDLE_Z, the narrow spine (188),
// and the city/marsh shelf (232) at the south. Bands split where the land
// use changes: peninsula green, marsh green-brown (config MARSH), city
// green. The minimap redraws every frame, so this sampling happens here,
// never inside drawFloridaMap.
function coastPoly(z0, z1) {
  // Sample every 25 units plus the half-width function's exact breakpoints
  // (the city-shelf edge and PANHANDLE_Z), so the width steps land where
  // the world puts them instead of up to a sample away.
  const zs = new Set([z0, z1]);
  for (let z = z1; z >= z0; z -= 25) zs.add(z);
  for (const b of [-210, PANHANDLE_Z]) if (b > z0 && b < z1) zs.add(b);
  const desc = [...zs].sort((a, b2) => b2 - a), asc = [...desc].reverse();
  const pts = [];
  for (const z of desc) pts.push({ x: landHalfWidthAt(z), z });
  for (const z of asc) pts.push({ x: -landHalfWidthAt(z), z });
  return pts;
}
const LAND_BANDS = [
  { poly: coastPoly(NORTH_END, MARSH.z0), fill: '#55803f' },   // spine + panhandle (buildPeninsula's land tone)
  { poly: coastPoly(MARSH.z0, MARSH.z1), fill: '#5c6b35' },    // Everglades marsh
  { poly: coastPoly(MARSH.z1, WORLD + 20), fill: '#4c8a4f' },  // city plateau
];

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
  // Land: the precomputed coastline polygons (sampled from landHalfWidthAt),
  // filled per land-use band and edged in sand, so a window near any coast
  // shows the real shoreline instead of a green square running off-canvas.
  for (const band of LAND_BANDS) {
    c.beginPath();
    band.poly.forEach((p, k) => { if (k === 0) c.moveTo(px(p.x), pz(p.z)); else c.lineTo(px(p.x), pz(p.z)); });
    c.closePath();
    c.fillStyle = band.fill; c.fill();
    c.strokeStyle = '#f2d492'; c.lineWidth = Math.max(1, 2.5 * sx); c.stroke();
  }
  // City beaches: the actual sand planes buildCity lays at ±(WORLD+16),
  // 30 wide, running the plateau's full depth.
  c.fillStyle = '#f2d492';
  c.fillRect(px(-(WORLD + 31)), pz(-220), 30 * sx, 440 * sz);
  c.fillRect(px(WORLD + 1), pz(-220), 30 * sx, 440 * sz);
  // Lake Okeechobee: the water ellipse buildPeninsula bites into the spine.
  c.fillStyle = '#2e6e8c';
  c.beginPath(); c.ellipse(px(LAKE_OKEECHOBEE.x), pz(LAKE_OKEECHOBEE.z), LAKE_OKEECHOBEE.rx * sx, LAKE_OKEECHOBEE.rz * sz, 0, 0, 7); c.fill();
  c.strokeStyle = '#f2d492'; c.lineWidth = Math.max(1, 2 * sx); c.stroke();
  // Marsh water channels: the exact placements buildCity rendered
  // (MARSH_CHANNELS — same seeded RNG stream, recorded at build time).
  // Each channel is a 230-long plane rotated `rot` about its centre; draw
  // it as a thick segment along that rotated axis.
  c.strokeStyle = '#2e4d3f';
  c.lineCap = 'butt';
  for (const ch of MARSH_CHANNELS) {
    const dx = Math.sin(ch.rot) * (ch.len / 2), dz = Math.cos(ch.rot) * (ch.len / 2);
    c.lineWidth = Math.max(1.5, ch.w * sx);
    c.beginPath(); c.moveTo(px(ch.x - dx), pz(ch.z - dz)); c.lineTo(px(ch.x + dx), pz(ch.z + dz)); c.stroke();
  }
  c.strokeStyle = '#39404d';
  c.lineWidth = Math.max(2, 12 * sx);
  c.beginPath(); c.moveTo(px(0), pz(200)); c.lineTo(px(0), pz(436)); c.stroke(); // causeway
  c.beginPath(); c.moveTo(px(0), pz(-180)); c.lineTo(px(0), pz(NORTH_END)); c.stroke(); // highway (incl. the marsh road span)
  // The Glades' only other placed geometry: the prison yard itself (sand
  // plane, PRISON hw/hd from facilities.js) — the world builds no road out
  // to it, so the yard and the x=0 marsh road are what the map can show.
  c.fillStyle = '#9a8f7a';
  c.fillRect(px(PRISON.x - PRISON.hw), pz(PRISON.z - PRISON.hd), PRISON.hw * 2 * sx, PRISON.hd * 2 * sz);
  // The marsh road plane itself (MARSH_ROAD from city.js), at its true
  // ROAD_W width — the segment of the x=0 line serving the Glades/dock.
  c.strokeStyle = '#39404d';
  c.lineWidth = Math.max(2, MARSH_ROAD.w * sx);
  c.beginPath(); c.moveTo(px(MARSH_ROAD.x), pz(MARSH_ROAD.z - MARSH_ROAD.len / 2)); c.lineTo(px(MARSH_ROAD.x), pz(MARSH_ROAD.z + MARSH_ROAD.len / 2)); c.stroke();
  c.lineWidth = Math.max(1, 7 * sx);
  c.beginPath();
  for (const r of ROADS) {
    c.moveTo(px(r), pz(-200)); c.lineTo(px(r), pz(200));
    c.moveTo(px(-200), pz(r)); c.lineTo(px(200), pz(r));
  }
  c.stroke();
  // The flyover: the elevated x=75 deck, brighter and thicker than the
  // street grid so the grade separation reads on the map.
  c.strokeStyle = '#9aa7bd';
  c.lineWidth = Math.max(2, 10 * sx);
  c.beginPath(); c.moveTo(px(FLYOVER_SEG.x), pz(FLYOVER_SEG.z0)); c.lineTo(px(FLYOVER_SEG.x), pz(FLYOVER_SEG.z1)); c.stroke();
  // The reworked south: mid streets, the diagonal avenue and the coastal
  // promenade — drawn thinner than the ROADS so blocks read as blocks.
  c.strokeStyle = '#39404d';
  c.lineWidth = Math.max(1, 3.5 * sx);
  c.beginPath();
  for (const s of SOUTH_STREETS) {
    if (s.axis === 'ns') { c.moveTo(px(s.at), pz(s.from)); c.lineTo(px(s.at), pz(s.to)); }
    else { c.moveTo(px(s.from), pz(s.at)); c.lineTo(px(s.to), pz(s.at)); }
  }
  for (const s of TOWN_STREETS) {
    if (s.axis === 'ns') { c.moveTo(px(s.at), pz(s.from)); c.lineTo(px(s.at), pz(s.to)); }
    else { c.moveTo(px(s.from), pz(s.at)); c.lineTo(px(s.to), pz(s.at)); }
  }
  c.moveTo(px(DIAG_SEG.x1), pz(DIAG_SEG.z1)); c.lineTo(px(DIAG_SEG.x2), pz(DIAG_SEG.z2));
  c.stroke();
  c.strokeStyle = '#f2d492';
  c.beginPath();
  PROM_POINTS.forEach((p, k) => { if (k === 0) c.moveTo(px(p.x), pz(p.z)); else c.lineTo(px(p.x), pz(p.z)); });
  c.stroke();
  // Building footprints at local scale: city.js's buildingRecords — every
  // placed building's own {x, z, hw, hd} — in a muted tint, so city blocks
  // read as blocks instead of bare green. Local windows only (the full map
  // would be a solid smear), culled to the window.
  if (v.halfW <= 80) {
    c.fillStyle = 'rgba(24,38,30,0.55)';
    for (const b of buildingRecords) {
      if (Math.abs(b.x - v.cx) > v.halfW + b.hw || Math.abs(b.z - v.cz) > v.halfH + b.hd) continue;
      c.fillRect(px(b.x - b.hw), pz(b.z - b.hd), b.hw * 2 * sx, b.hd * 2 * sz);
    }
  }
  // Door markers: every enterable building and shop facility gets a cyan
  // door square at its entrance point, lettered on the local minimap, so
  // the gun shop / pharmacy / club can actually be found.
  const doorSpots = [];
  for (const e of ENTERABLES) if (e.door) doorSpots.push({ x: e.door.x, z: e.door.z, name: e.name });
  for (const f of FACILITIES) if (f.door && !doorSpots.some((d) => Math.hypot(d.x - f.door.x, d.z - f.door.z) < 2)) doorSpots.push({ x: f.door.x, z: f.door.z, name: f.name });
  for (const d of doorSpots) {
    const mx = px(d.x), mz = pz(d.z);
    if (mx < -8 || mz < -8 || mx > W2 + 8 || mz > S + 8) continue;
    c.fillStyle = '#7ef0d4';
    c.fillRect(mx - 3.5, mz - 3.5, 7, 7);
    c.strokeStyle = '#14161c'; c.lineWidth = 1; c.strokeRect(mx - 3.5, mz - 3.5, 7, 7);
    if (v.halfW <= 80) {
      c.fillStyle = '#14161c';
      c.font = '900 6px system-ui';
      c.fillText(d.name.charAt(0), mx - 1.8, mz + 2.2);
    }
  }
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
  // PRISON marker: a slate lettered square at the gate, on both maps —
  // the prison is in neither ENTERABLES nor FACILITIES, so the door-marker
  // pass above never marked it and the Glades read as empty.
  {
    c.fillStyle = '#57606f';
    c.fillRect(px(PRISON.gate.x) - 4, pz(PRISON.gate.z) - 4, 8, 8);
    c.strokeStyle = '#14161c'; c.lineWidth = 1; c.strokeRect(px(PRISON.gate.x) - 4, pz(PRISON.gate.z) - 4, 8, 8);
    c.fillStyle = '#ffffff';
    c.font = '900 7px system-ui';
    c.fillText('P', px(PRISON.gate.x) - 2.2, pz(PRISON.gate.z) + 2.5);
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
  // A local window centred on the player, sized by the persisted zoom
  // level (NEAR 60×76, MID 110×140, FAR 220×280 world units).
  syncZoomBtn(); // keep the button label honest if settings changed elsewhere
  const lvl = MAP_ZOOM_LEVELS[mapZoomIndex()];
  // INDOORS: interior rooms live at off-map coordinates (~x 2450) that the
  // world map reads as open sea, so centring on the player drew a solid
  // blue square. Instead centre on the building's OUTDOOR door, mark the
  // door with the player arrow, and banner the panel INDOORS + the place
  // name and its district — the player sees where the building stands.
  const interior = typeof G !== 'undefined' && G.interior ? currentInterior() : null;
  if (interior && interior.door) {
    const view = { cx: interior.door.x, cz: interior.door.z, halfW: lvl.halfW, halfH: lvl.halfH };
    const doorPos = { x: interior.door.x, z: interior.door.z };
    drawFloridaMap(el.mapCtx, el.map.height, el.map.width, doorPos, targetPos, copPositions, view);
    drawIndoorBanner(interior);
    return;
  }
  const view = { cx: playerPos.x, cz: playerPos.z, halfW: lvl.halfW, halfH: lvl.halfH };
  drawFloridaMap(el.mapCtx, el.map.height, el.map.width, playerPos, targetPos, copPositions, view);
}

// The INDOORS banner drawn over the door-centred minimap: a dark header
// strip naming the state, the place, and the district its door stands in.
function drawIndoorBanner(interior) {
  const c = el.mapCtx, W2 = el.map.width, S = el.map.height;
  c.fillStyle = 'rgba(8,10,18,0.88)';
  c.fillRect(0, 0, W2, 34);
  c.fillStyle = '#ffd32a';
  c.font = '900 13px system-ui';
  c.fillText('⌂ INDOORS', 7, 15);
  c.fillStyle = '#ffffff';
  c.font = '700 10px system-ui';
  const name = String(interior.name || 'Interior').slice(0, 24);
  const district = districtAt(interior.door.x, interior.door.z);
  c.fillText(name + ' · ' + district, 7, 29);
  c.fillStyle = 'rgba(8,10,18,0.75)';
  c.fillRect(0, S - 15, W2, 15);
  c.fillStyle = '#7ef0d4';
  c.font = '700 9px system-ui';
  c.fillText('MAP SHOWS THE BUILDING OUTSIDE', 7, S - 4);
}

// ---- Full map zoom + pan ----------------------------------------------------
// The full map used to be one fixed whole-island view. It now carries a
// view state: null = the whole island (the reset state); otherwise a
// {cx, cz, halfW, halfH} window the player zooms (pinch / + − buttons)
// and pans (drag). drawFloridaMap is data-driven and clips to any view,
// so markers, roads and the PLACES directory stay consistent at every
// level. Zoom keeps the legacy whole-island aspect (720 × 2361) and is
// clamped so the closest view is street level (halfW 55 ≈ a town's
// streets legible) and the widest is the whole island itself.
const FULLMAP_HOME = { cx: 0, cz: (442 + NORTH_END) / 2, halfW: 720, halfH: (442 - NORTH_END) / 2 };
let fullMapView = null;
export function getFullMapView() { return fullMapView ? { ...fullMapView } : { ...FULLMAP_HOME }; }
export function fullMapZoomFactor() { return FULLMAP_HOME.halfW / getFullMapView().halfW; }
export function resetFullMapView() { fullMapView = null; }
export function zoomFullMap(factor, focus) {
  const v = getFullMapView();
  const halfW = Math.min(FULLMAP_HOME.halfW, Math.max(55, v.halfW / factor));
  const k = halfW / v.halfW;
  const f = focus || { x: v.cx, z: v.cz };
  const cx = f.x + (v.cx - f.x) * k, cz = f.z + (v.cz - f.z) * k;
  fullMapView = halfW >= FULLMAP_HOME.halfW ? null : { cx, cz, halfW, halfH: v.halfH * k };
  return getFullMapView();
}
export function panFullMap(dxWorld, dzWorld) {
  if (!fullMapView) return getFullMapView();
  fullMapView = { ...fullMapView, cx: fullMapView.cx + dxWorld, cz: fullMapView.cz + dzWorld };
  return getFullMapView();
}
// Canvas-pixel → world conversion for the full map canvas, matching
// drawFloridaMap's own px/pz mapping for the current view.
export function fullMapPixelToWorld(cv, pxX, pxY) {
  const v = getFullMapView();
  return {
    x: v.cx + (pxX / cv.width - 0.5) * v.halfW * 2,
    z: v.cz - v.halfH + (pxY / cv.height) * v.halfH * 2,
  };
}

export function drawFullMap() {
  const cv = document.getElementById('fullmap');
  if (!cv) return;
  const c = cv.getContext('2d');
  const view = getFullMapView();
  drawFloridaMap(c, cv.height, cv.width, window.__playerPos || { x: 0, z: 0 }, null, [], view);
  // PLACES list under the map: every named facility and enterable with its
  // street hint — the directory the player asked for. The element is
  // created here (not in index.html) and refreshed on every map open.
  const menu = document.getElementById('mapMenu');
  if (menu && PLACES.length) {
    let pl = document.getElementById('placesList');
    if (!pl) {
      pl = document.createElement('div');
      pl.id = 'placesList';
      pl.style.cssText = 'color:#fff;font:12px/1.5 system-ui,sans-serif;text-align:left;max-height:26vh;overflow:auto;margin-top:8px;padding:6px 10px;background:rgba(5,6,14,.55);border-radius:8px;max-width:92vw';
      menu.appendChild(pl);
    }
    pl.innerHTML = '<b style="color:#ffd32a">PLACES · PALM COVE</b><br>' + PLACES.map((p) => p.name + (p.hint ? ' — ' + p.hint : '')).join('<br>');
  }
  // Region labels belong to the whole-island view only — at street zoom
  // they would sit on top of the wrong streets.
  if (!fullMapView) {
    c.fillStyle = '#ffd32a';
    c.font = '900 15px system-ui';
    c.fillText('PALM COVE · FLORIDA PENINSULA', 14, 22);
    c.font = '12px system-ui';
    c.fillStyle = '#fff';
    c.fillText('TALLAHASSEE PALMS — FAR SHORE', 14, 44);
    c.fillText('THE GLADES · THE SPINE →', 14, 62);
    c.fillText('KEY SOLANO →', 14, cv.height - 12);
  } else {
    c.fillStyle = 'rgba(8,10,18,0.8)';
    c.fillRect(8, 8, 168, 20);
    c.fillStyle = '#ffd32a';
    c.font = '900 12px system-ui';
    c.fillText('ZOOM ×' + fullMapZoomFactor().toFixed(1) + ' · DRAG TO PAN', 14, 22);
  }
}
