// Story missions, dialogue, objective markers, plus the street race and taxi side jobs.
// Vera Solano runs errands for fixer Lucia Marrero to work off a debt in Palm Cove.
import { G } from './state.js';
import { GARAGE, MARINA } from './config.js';
import { makePerson } from './city.js';
import { parkedCars } from './traffic.js';
import { peds } from './pedestrians.js';
import { commitCrime } from './police.js';
import { sfx } from './audio.js';
import { saveGame } from './save.js';

let marker = null, say = () => {}, lucia = null;
export const target = { pos: null, label: '' };
const DOCKS_PKG = { x: -140, z: 140 }, DELIVER = { x: 120, z: -120 };
const DEBTORS = [{ x: -110, z: -110, name: 'Old Town debtor' }, { x: 30, z: 110, name: 'Marina debtor' }, { x: 130, z: 30, name: 'Palm debtor' }];
const RACE_START = { x: -140, z: -140 };
const RACE_CPS = [{ x: 0, z: -140 }, { x: 140, z: -140 }, { x: 140, z: 0 }, { x: 140, z: 140 }, { x: 0, z: 140 }, { x: -140, z: -140 }];
const RACE_PAR = 110;
let race = null, taxi = null, debtorIdx = 0, luciaAboard = false;

export function initMissions(scene, markerGroup, sayFn) {
  marker = markerGroup; say = sayFn;
  lucia = makePerson(0xe84393, 0x2d3436, 0xf1c27d);
  lucia.position.set(GARAGE.x + 3, 0.3, GARAGE.z + 10); lucia.visible = false; scene.add(lucia);
  startCurrentMission(true);
}
function setTarget(x, z, label) { target.pos = { x, z }; target.label = label; if (marker) { marker.visible = true; marker.position.set(x, 0, z); } }
function clearTarget() { target.pos = null; if (marker) marker.visible = false; }
function reward(amount, text) {
  G.money += amount; G.stats.missions++; sfx.cash(); sfx.success();
  say('Lucia Marrero', text + '  (+$' + amount + ')', 5); saveGame();
}
export function startCurrentMission(intro) {
  debtorIdx = 0;
  const i = G.missionIndex;
  if (G.storyDone || i > 3) { G.objective = 'Free roam in Palm Cove — R starts a street race, T (in a car) starts taxi work.'; clearTarget(); return; }
  if (i === 0) { setTarget(DOCKS_PKG.x, DOCKS_PKG.z, 'package'); G.objective = 'First Run: pick up the package at The Docks.'; if (intro) say('Lucia Marrero', 'Vera — first run. Grab my package at The Docks and take it to Coral Heights. You owe me, remember?', 6); }
  if (i === 1) {
    const car = parkedCars[5]; if (car) { car.isTarget = true; setTarget(car.pos.x, car.pos.z, 'sports car'); }
    G.objective = 'Hot Wheels: steal the marked red Comet sports car.'; say('Lucia Marrero', 'A red Comet is parked up in Coral Heights. Take it. Bring it to my garage.', 6);
  }
  if (i === 2) { const d = DEBTORS[0]; setTarget(d.x, d.z, 'debtor'); G.objective = 'Collections: intimidate debtor 1 of 3 in Old Town (get close, press F).'; say('Lucia Marrero', 'Three people owe me. Visit each one and lean on them — a punch nearby or the pistol I am lending you.', 6); G.weapon = 'Pistol'; }
  if (i === 3) { if (lucia) { lucia.visible = true; lucia.position.set(GARAGE.x + 3, 0.3, GARAGE.z + 10); } setTarget(GARAGE.x, GARAGE.z, 'Lucia'); G.objective = 'Sunset Run: pick up Lucia at her garage.'; say('Lucia Marrero', 'Last job, Vera. Pick me up at the garage. The police will not make it easy.', 6); }
}
function dist(pos, t) { return Math.hypot(pos.x - t.x, pos.z - t.z); }
export function onAction(type, playerPos) {
  if (G.missionIndex === 2 && !G.storyDone && target.pos && dist(playerPos, target.pos) < 5) {
    G.money += 150; sfx.cash(); debtorIdx++;
    say('Debtor', 'Okay! Okay! Here — take Lucia her money!', 3);
    if (debtorIdx >= DEBTORS.length) { G.missionIndex = 3; reward(0, 'Collections done. All three paid up.'); startCurrentMission(false); say('Lucia Marrero', 'Collections done. All three paid. One last run and your debt is clear.', 5); }
    else { const d = DEBTORS[debtorIdx]; setTarget(d.x, d.z, 'debtor'); G.objective = 'Collections: intimidate debtor ' + (debtorIdx + 1) + ' of 3 (' + d.name + ', get close, press F).'; }
    saveGame(); return true;
  }
  return false;
}
export function onEnterCar(car) {
  if (G.missionIndex === 1 && car.isTarget) {
    car.isTarget = false; setTarget(GARAGE.x, GARAGE.z, "Lucia's garage");
    G.objective = "Hot Wheels: deliver the Comet to Lucia's garage.";
    commitCrime(2, 'Marked car stolen'); say('Lucia Marrero', 'That is the car. The police noticed — lose them later, garage first.', 5);
  }
}
export function startRace(playerPos) {
  if (race || dist(playerPos, RACE_START) > 9 || !G.driving) return false;
  race = { cp: 0, t: 0 }; G.sideMode = 'race';
  say('Race Starter', 'Checkpoint circuit! Beat ' + RACE_PAR + ' seconds for $500. Go!', 4);
  setTarget(RACE_CPS[0].x, RACE_CPS[0].z, 'checkpoint'); return true;
}
export function startTaxi() {
  if (taxi || !G.driving) return false;
  let best = null, bd = 1e9;
  for (const p of peds) { const d = p.mesh.position.distanceTo(G.driving.pos); if (d < bd) { bd = d; best = p; } }
  if (!best) return false;
  best.flagged = true; taxi = { ped: best, stage: 'pickup', dest: { x: -140 + Math.random() * 280, z: -140 + Math.random() * 280 }, t: 0 };
  G.sideMode = 'taxi'; setTarget(best.mesh.position.x, best.mesh.position.z, 'fare');
  say('Dispatch', 'Fare waiting nearby. Pick them up, then follow the marker.', 4); return true;
}
export function sidePrompt(playerPos) {
  if (!race && G.driving && dist(playerPos, RACE_START) < 9) return 'Press R to start the street race';
  if (G.driving && !taxi) return '';
  return '';
}
export function updateMissions(dt, playerPos) {
  if (marker && target.pos) { marker.position.set(target.pos.x, 0, target.pos.z); }
  if (race) {
    race.t += dt; G.objective = 'Street race: checkpoint ' + (race.cp + 1) + '/' + RACE_CPS.length + ' — ' + race.t.toFixed(0) + 's (par ' + RACE_PAR + 's)';
    const cp = RACE_CPS[race.cp];
    if (dist(playerPos, cp) < 8) {
      sfx.pickup(); race.cp++;
      if (race.cp >= RACE_CPS.length) {
        const won = race.t <= RACE_PAR; if (won) { G.money += 500; G.stats.side++; }
        say('Race Starter', won ? 'You beat par! $500 is yours.' : 'Too slow — no prize. Run it again from Old Town.', 5);
        sfx.success(); race = null; G.sideMode = null; startCurrentMission(false); saveGame();
      } else setTarget(RACE_CPS[race.cp].x, RACE_CPS[race.cp].z, 'checkpoint');
    }
    return;
  }
  if (taxi) {
    taxi.t += dt;
    if (taxi.stage === 'pickup') {
      const pp = taxi.ped.mesh.position; setTarget(pp.x, pp.z, 'fare');
      if (dist(playerPos, pp) < 5 && G.driving && Math.abs(G.driving.speed) < 1.5) {
        taxi.stage = 'dropoff'; taxi.ped.mesh.visible = false; setTarget(taxi.dest.x, taxi.dest.z, 'destination');
        say('Passenger', 'Thanks! Take me to the marker, quick as you can.', 3);
      }
    } else if (dist(playerPos, taxi.dest) < 8) {
      const fare = 40 + Math.max(0, 60 - Math.floor(taxi.t)); G.money += fare; G.stats.side++;
      say('Passenger', 'Here is $' + fare + ' — fare plus a speed tip.', 4); sfx.cash();
      taxi.ped.mesh.visible = true; taxi = null; G.sideMode = null; startCurrentMission(false); saveGame();
    }
    if (taxi) { G.objective = taxi.stage === 'pickup' ? 'Taxi: pick up the flagged passenger.' : 'Taxi: drive your passenger to the marker.'; return; }
  }
  if (G.storyDone) return;
  const i = G.missionIndex;
  if (i === 0) {
    if (G.missionStage === 0 && dist(playerPos, DOCKS_PKG) < 6) { G.missionStage = 1; sfx.pickup(); setTarget(DELIVER.x, DELIVER.z, 'delivery'); G.objective = 'First Run: deliver the package to Coral Heights.'; say('Vera Solano', 'Package is in hand. Across town we go.', 3); }
    else if (G.missionStage === 1 && dist(playerPos, DELIVER) < 6) { G.missionStage = 0; G.missionIndex = 1; reward(250, 'First Run complete. Clean work, Vera.'); startCurrentMission(false); }
  } else if (i === 1) {
    const car = parkedCars[5];
    if (car && car.isTarget) setTarget(car.pos.x, car.pos.z, 'sports car');
    if (G.driving && dist(playerPos, GARAGE) < 9 && !parkedCars[5].isTarget) { G.missionIndex = 2; reward(400, 'Hot Wheels complete. The Comet looks good in my garage.'); startCurrentMission(false); }
  } else if (i === 3) {
    if (!luciaAboard && dist(playerPos, GARAGE) < 8 && G.driving) {
      luciaAboard = true; if (lucia) lucia.visible = false;
      commitCrime(4, 'Police chase'); setTarget(MARINA.x, MARINA.z, 'marina');
      G.objective = 'Sunset Run: escape to the marina with Lucia!'; say('Lucia Marrero', 'Drive, Vera! Marina Mile — do not stop for anyone!', 5);
    } else if (luciaAboard && dist(playerPos, MARINA) < 10) {
      luciaAboard = false; G.storyDone = true; G.missionIndex = 4; G.wanted = 0;
      reward(1000, 'Sunset Run complete. Debt cleared, Vera — Palm Cove is yours now.');
      G.objective = 'Story complete! Free roam — R starts a street race, T (in a car) starts taxi work.'; clearTarget();
    } else if (luciaAboard) { if (G.wanted < 3) commitCrime(4, 'Police chase'); }
  }
}
export function missionTarget() { return target.pos; }
