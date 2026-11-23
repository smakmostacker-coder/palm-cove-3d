// Deterministic screenshot staging: ?shot=title|drive|chase|map&seed=1
// Positions the player, cars, police and mission state so each capture is
// repeatable. v2 frames the dusk city, street density, a neon chase, and the
// Florida-silhouette full map.
import { G } from './state.js';
import { player } from './player.js';
import { parkedCars } from './traffic.js';
import { cops, setHeliAngle, heliCfg } from './police.js';
import { enterCar } from './driving.js';
import { startCurrentMission } from './missions.js';
import { addItem, selectSlot } from './inventory.js';
import { drawFullMap } from './hud.js';

export function parseShot() {
  const q = new URLSearchParams(location.search);
  return { shot: q.get('shot'), seed: parseInt(q.get('seed') || '1', 10) || 1 };
}
export function stageShot(name, startPlaying) {
  if (!name) return;
  if (name === 'title') {
    G.mode = 'title';
    // The character-choice screen IS the title shot: both leads on the beach,
    // deco strip + lighthouse behind them (Parts K + M in one frame).
    window.__titleCam = { pos: [246, 10, 168], look: [168, 9, 108] };
    document.getElementById('menu').style.display = 'none';
    document.getElementById('choiceMenu').style.display = 'flex';
    return;
  }
  if (name === 'drive') G.character = 'dax'; // male-lead gameplay shot
  startPlaying(false);
  if (name === 'drive') {
    const car = parkedCars.find((c) => c.kind === 'moto') || parkedCars[0];
    enterCar(car); G.wanted = 0;
    car.angle = Math.PI; car.speed = 6; car.pos.set(4, 0, 31); // Dax on the moto rolling up to the Palm District junction — lights, trees, lamps, hotbar
    // A stocked hotbar so the drive shot shows the 5-slot bar in use (Part H).
    addItem('pistol'); addItem('snack'); addItem('snack'); addItem('cola'); selectSlot(0);
    G.objective = 'Free roam — Dax cruising the Palm District at dusk.';
  } else if (name === 'chase') {
    const car = parkedCars[0];
    enterCar(car); car.angle = Math.PI; car.speed = 20; car.pos.set(4, 0, 44);
    G.wanted = 4; G.health = 72; G.camPitch = 0.12; setHeliAngle(-1.95);
    heliCfg.height = 13; heliCfg.radius = 34;
    cops.forEach((c, i) => { c.active = true; c.mesh.visible = true; c.pos.set(1 + (i % 2) * 6, 0, i < 2 ? 44 - 24 - i * 9 : 44 + 16 + i * 6); c.mesh.position.copy(c.pos); });
    G.objective = 'Sunset Run: escape to the marina with Lucia!';
  } else if (name === 'map') {
    // Pause-menu full map: the Florida silhouette shot.
    player.pos.set(4, 0.3, 120); G.camYaw = 0.4;
    G.objective = 'Free roam — checking the map of the peninsula.';
    const mm = document.getElementById('mapMenu');
    if (mm) { mm.style.display = 'flex'; G.mode = 'paused'; setTimeout(drawFullMap, 350); }
  }
}
