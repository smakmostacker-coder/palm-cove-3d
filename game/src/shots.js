// Deterministic screenshot staging: ?shot=title|drive|chase|map&seed=1
// Positions the player, cars, police and mission state so each capture is
// repeatable. The title shot is the REAL title menu — the PALM COVE menu
// over the default title-orbit view of the city, exactly what a player
// sees at first load (both leads still stand on the beach in the world
// behind it). Staging never pokes overlay displays directly: it sets
// window.__shotOverlay and main.js applies it through showOverlay().
import { G } from './state.js';
import { player } from './player.js';
import { parkedCars } from './traffic.js';
import { cops, setHeliAngle, heliCfg } from './police.js';
import { enterCar } from './driving.js';
import { addItem, selectSlot } from './inventory.js';
import { cancelWake } from './facilities.js';

export function parseShot() {
  const q = new URLSearchParams(location.search);
  return { shot: q.get('shot'), seed: parseInt(q.get('seed') || '1', 10) || 1 };
}

export function stageShot(name, startPlaying) {
  if (!name) return;
  if (name === 'title') {
    G.mode = 'title';
    window.__shotOverlay = 'menu';
    return;
  }
  if (name === 'drive') G.character = 'dax'; // male-lead gameplay shot
  startPlaying(false);
  cancelWake(player); // staging skips the wake-up opening
  player.pos.set(8, 0.3, 58);
  if (name === 'drive') {
    const car = parkedCars.find((c) => c.kind === 'moto') || parkedCars[0];
    enterCar(car);
    G.wanted = 0;
    car.angle = Math.PI; car.speed = 6; car.pos.set(4, 0, 31);
    // A stocked hotbar so the drive shot shows the 5-slot bar in use.
    addItem('pistol'); addItem('snack'); addItem('snack'); addItem('cola');
    selectSlot(0);
    G.objective = 'Free roam — Dax cruising the Palm District at dusk.';
  } else if (name === 'chase') {
    const car = parkedCars[0];
    enterCar(car);
    car.angle = Math.PI; car.speed = 20; car.pos.set(4, 0, 44);
    G.wanted = 4; G.health = 72; G.camPitch = 0.12;
    setHeliAngle(-1.95);
    heliCfg.height = 13; heliCfg.radius = 34;
    cops.forEach((c, i) => {
      c.active = true; c.mesh.visible = true;
      c.pos.set(1 + (i % 2) * 6, 0, i < 2 ? 44 - 24 - i * 9 : 44 + 16 + i * 6);
      c.mesh.position.copy(c.pos);
    });
    G.objective = 'Sunset Run: escape to the marina with Lucia!';
  } else if (name === 'map') {
    player.pos.set(4, 0.3, 120);
    G.camYaw = 0.4;
    G.objective = 'Free roam — checking the map of the peninsula.';
    G.mode = 'paused';
    window.__shotOverlay = 'map'; // main.js shows it and draws the map
  }
}
