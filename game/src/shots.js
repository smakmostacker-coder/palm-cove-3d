// Deterministic screenshot staging: ?shot=title|drive|chase|mission&seed=1
// Positions the player, cars, police and mission state so each capture is repeatable.
import { G } from './state.js';
import { player } from './player.js';
import { parkedCars } from './traffic.js';
import { cops, setHeliAngle, heliCfg } from './police.js';
import { enterCar } from './driving.js';
import { startCurrentMission } from './missions.js';

export function parseShot() {
  const q = new URLSearchParams(location.search);
  return { shot: q.get('shot'), seed: parseInt(q.get('seed') || '1', 10) || 1 };
}
export function stageShot(name, startPlaying) {
  if (!name) return;
  if (name === 'title') { G.mode = 'title'; return; }
  startPlaying(false);
  if (name === 'drive') {
    const car = parkedCars[0];
    enterCar(car); G.wanted = 0;
    car.angle = Math.PI; car.speed = 14; car.pos.set(4, 0, 30);
    G.objective = 'Free roam — cruising the Palm District.';
  } else if (name === 'chase') {
    const car = parkedCars[0];
    enterCar(car); car.angle = Math.PI; car.speed = 20; car.pos.set(4, 0, 44);
    G.wanted = 4; G.health = 72; G.camPitch = 0.12; setHeliAngle(-1.95);
    heliCfg.height = 13; heliCfg.radius = 34; // wider, lower circle so the helicopter reads in the chase frame
    // Two units staged ahead as an oncoming roadblock (visible in the chase cam), two behind.
    cops.forEach((c, i) => { c.active = true; c.mesh.visible = true; c.pos.set(1 + (i % 2) * 6, 0, i < 2 ? 44 - 24 - i * 9 : 44 + 16 + i * 6); c.mesh.position.copy(c.pos); });
    G.objective = 'Sunset Run: escape to the marina with Lucia!';
  } else if (name === 'mission') {
    G.missionIndex = 0; G.missionStage = 0; startCurrentMission(true);
    player.pos.set(-146, 0.3, 124); G.camYaw = 2.67;
    G.objective = 'First Run: pick up the package at The Docks.';
  }
}
