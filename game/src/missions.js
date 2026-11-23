// Story missions, dialogue, objective markers, the street race and taxi
// jobs — and the branching-endings engine.
//
// The lead works off a debt to fixer Lucia Marrero across four missions.
// HOW the work is done is tracked (debtors spared vs taken out, money
// earned, times busted) and decides which of six endings the finale lands
// on. Nothing is handed over: the pistol Lucia mentions is a world pickup
// by her garage, and the sniper is found, never given.
//
// Distances note for the peninsula rework: the story, race and taxi all
// live in the southern city and the Keys, exactly as before — the long
// northern spine is free-roam country, so no mission distance, fare or
// race par needed retuning when the world grew.
import { G } from './state.js';
import { GARAGE, MARINA } from './config.js';
import { makePerson, makeProtagonist } from './city.js';
import { parkedCars } from './traffic.js';
import { peds } from './pedestrians.js';
import { commitCrime } from './police.js';
import { sfx } from './audio.js';
import { saveGame } from './save.js';

let marker = null, say = () => {}, lucia = null, endingCb = () => {}, partner = null, partnerScene = null;
export const CHARACTERS = { vera: { name: 'Vera Solano', short: 'Vera' }, dax: { name: 'Dario "Dax" Vega', short: 'Dax' } };
export function PN() { return CHARACTERS[G.character || 'vera'].short; }
export function partnerWho() { return G.character === 'dax' ? 'vera' : 'dax'; }
export function setPartner() {
  if (!partnerScene) return;
  if (partner) partnerScene.remove(partner);
  partner = makeProtagonist(partnerWho());
  partner.position.set(GARAGE.x - 4, 0.3, GARAGE.z + 12);
  partner.rotation.y = -0.5;
  partnerScene.add(partner);
}

export const target = { pos: null, label: '' };
const DOCKS_PKG = { x: -140, z: 140 }, DELIVER = { x: 150, z: 150 };
const DEBTORS = [
  { x: -110, z: -110, name: 'Old Town debtor' },
  { x: 110, z: -110, name: 'Coral Heights debtor' },
  { x: 130, z: 30, name: 'Palm debtor' },
];
const RACE_START = { x: 4, z: 150 };
const RACE_CPS = [{ x: 0, z: 75 }, { x: 0, z: 190 }, { x: 2, z: 268 }, { x: 2, z: 338 }, { x: 0, z: 190 }, { x: 4, z: 150 }];
const RACE_PAR = 115;
let race = null, taxi = null, debtorIdx = 0, luciaAboard = false;

export function initMissions(scene, markerGroup, sayFn) {
  marker = markerGroup;
  say = sayFn;
  lucia = makePerson(0xe84393, 0x2d3436, 0xf1c27d, { hairStyle: 'bun', hairColor: 0x4a3220, face: 'stern' });
  lucia.position.set(GARAGE.x + 3, 0.3, GARAGE.z + 10);
  lucia.visible = false;
  scene.add(lucia);
  partnerScene = scene;
  setPartner();
  startCurrentMission(true);
}
export function setEndingHandler(fn) { endingCb = fn; }
function setTarget(x, z, label) {
  target.pos = { x, z };
  target.label = label;
  if (marker) { marker.visible = true; marker.position.set(x, 0, z); }
}
function clearTarget() { target.pos = null; if (marker) marker.visible = false; }
function reward(amount, text) {
  G.money += amount;
  G.track.earned += amount;
  G.stats.missions++;
  sfx.cash(); sfx.success();
  say('Lucia Marrero', text + '  (+$' + amount + ')', 5);
  saveGame();
}

export function startCurrentMission(intro) {
  debtorIdx = 0;
  const i = G.missionIndex;
  if (G.storyDone || i > 3) {
    G.objective = 'Free roam in Palm Cove — R starts the Causeway Run race, T (in a car) starts taxi work. Replay the finale from the pause menu.';
    clearTarget();
    return;
  }
  if (i === 0) {
    setTarget(DOCKS_PKG.x, DOCKS_PKG.z, 'package');
    G.objective = 'First Run: pick up the package at The Docks.';
    if (intro) say('Lucia Marrero', PN() + ' — first run. Grab my package at The Docks and take it to the Marina. You owe me, remember?', 6);
  }
  if (i === 1) {
    const car = parkedCars[5];
    if (car) { car.isTarget = true; setTarget(car.pos.x, car.pos.z, 'sports car'); }
    G.objective = 'Hot Wheels: steal the marked red Comet sports car.';
    say('Lucia Marrero', 'A red Comet is parked up in Coral Heights. Take it. Bring it to my garage.', 6);
  }
  if (i === 2) {
    const d = DEBTORS[0];
    setTarget(d.x, d.z, 'debtor');
    G.objective = 'Collections: lean on debtor 1 of 3 in Old Town (F = talk them round · shooting = take them out).';
    say('Lucia Marrero', 'Three people owe me. Lean on each one — talk them round with F, or don\'t. And there is a pistol lying by my garage door. Pick it up if you want options.', 7);
  }
  if (i === 3) {
    if (lucia) { lucia.visible = true; lucia.position.set(GARAGE.x + 3, 0.3, GARAGE.z + 10); }
    setTarget(GARAGE.x, GARAGE.z, 'Lucia');
    G.objective = 'Sunset Run: pick up Lucia at her garage.';
    say('Lucia Marrero', 'Last job, ' + PN() + '. Pick me up at the garage. How this ends depends on how you have played it.', 6);
  }
}

function dist(pos, t) { return Math.hypot(pos.x - t.x, pos.z - t.z); }
function advanceDebtor(playerPos) {
  debtorIdx++;
  if (debtorIdx >= DEBTORS.length) {
    G.missionIndex = 3;
    reward(0, 'Collections done. All three accounts settled — one way or another.');
    startCurrentMission(false);
  } else {
    const d = DEBTORS[debtorIdx];
    setTarget(d.x, d.z, 'debtor');
    G.objective = 'Collections: lean on debtor ' + (debtorIdx + 1) + ' of 3 (' + d.name + ').';
  }
  saveGame();
}

export function onAction(type, playerPos) {
  if (G.missionIndex === 2 && !G.storyDone && target.pos && dist(playerPos, target.pos) < 6) {
    if (type === 'shoot') { // take-out: pays less, more heat, darker ending
      G.track.tookOut++;
      G.money += 60; G.track.earned += 60;
      sfx.cash();
      commitCrime(Math.max(3, G.wanted), 'Debtor taken out');
      say('Witness', 'She just shot him! Somebody call the police!', 3);
      advanceDebtor(playerPos);
      return true;
    }
    // spare: talked round — full payment, clean record
    G.track.spared++;
    G.money += 150; G.track.earned += 150;
    sfx.cash();
    say('Debtor', 'Okay! Okay! Here — take Lucia her money, every cent!', 3);
    advanceDebtor(playerPos);
    return true;
  }
  return false;
}

export function onEnterCar(car) {
  if (G.missionIndex === 1 && car.isTarget) {
    car.isTarget = false;
    setTarget(GARAGE.x, GARAGE.z, "Lucia's garage");
    G.objective = "Hot Wheels: deliver the Comet to Lucia's garage.";
    commitCrime(2, 'Marked car stolen');
    say('Lucia Marrero', 'That is the car. The police noticed — lose them later, garage first.', 5);
  }
}

export function startRace(playerPos) {
  if (race || dist(playerPos, RACE_START) > 10 || !G.driving) return false;
  race = { cp: 0, t: 0 };
  G.sideMode = 'race';
  say('Race Starter', 'Causeway Run! Down the boulevard, over the Keys bridges and back. Beat ' + RACE_PAR + 's for $500. Go!', 4);
  setTarget(RACE_CPS[0].x, RACE_CPS[0].z, 'checkpoint');
  return true;
}

export function startTaxi() {
  if (taxi || !G.driving) return false;
  let best = null, bd = 1e9;
  for (const p of peds) {
    const d = p.mesh.position.distanceTo(G.driving.pos);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) return false;
  best.flagged = true;
  const toKeys = Math.random() < 0.18;
  taxi = {
    ped: best, stage: 'pickup',
    dest: toKeys ? { x: 4, z: 398 } : { x: -140 + Math.random() * 280, z: -140 + Math.random() * 280 },
    t: 0,
  };
  G.sideMode = 'taxi';
  setTarget(best.mesh.position.x, best.mesh.position.z, 'fare');
  say('Dispatch', 'Fare waiting nearby. Pick them up, then follow the marker.', 4);
  return true;
}

export function sidePrompt(playerPos) {
  if (!race && G.driving && dist(playerPos, RACE_START) < 10) return 'Press R to start the Causeway Run race';
  return '';
}

// ---- The six endings -------------------------------------------------------
export const ENDINGS = {
  clean: { name: 'CLEAN GETAWAY', text: 'Every debtor paid and walked away breathing. Lucia burns the ledger on the marina dock, and Vera drives south over the causeways with a clear name and a full tank. Palm Cove lets her go — this time.' },
  kingpin: { name: 'KINGPIN OF THE COVE', text: 'The debt is a rounding error now. Vera buys the garage, the dock warehouse and half the Neon Palms sign. Lucia pours the drinks. Palm Cove has a new name on every ledger — hers.' },
  betrayed: { name: 'BETRAYED BY THE FIXER', text: 'One debtor in the ground was enough. Lucia decides Vera is a liability, sells the story to the police and vanishes over the causeway. Vera keeps the money, the wanted posters, and nobody to call.' },
  busted: { name: 'BUSTED FOR GOOD', text: 'Too many cells, too many fines. On the marina dock the cuffs finally stay on. The judge reads Vera\'s record back like a novel, and Palm Cove goes on shining without her.' },
  ghost: { name: 'GHOST', text: 'Debt cleared, pockets nearly empty, name worth nothing either way. Vera sells the car for bus fare, walks the beach at dawn and leaves Palm Cove the way she arrived — unnoticed.' },
  ashes: { name: 'QUEEN OF THE ASHES', text: 'Vera stopped collecting debts and started collecting fear. The cove still glows at dusk — but half the neon is hers, the docks answer to her, and even Lucia knocks before she enters.' },
};
export function computeEnding() {
  const t = G.track;
  if (t.busted >= 2) return 'busted';
  if (t.tookOut >= 2) return 'ashes';
  if (G.money >= 2400 || t.earned >= 2600) return 'kingpin';
  if (t.tookOut === 1) return 'betrayed';
  if (t.spared >= 3) return 'clean';
  return 'ghost';
}
export function finishFinale() {
  const id = computeEnding();
  G.lastEnding = id;
  if (!G.endingsUnlocked.includes(id)) G.endingsUnlocked.push(id);
  luciaAboard = false;
  G.storyDone = true;
  G.missionIndex = 4;
  G.wanted = 0;
  reward(1000, 'Sunset Run complete. Debt cleared, ' + PN() + '.');
  G.objective = 'Story complete — ending reached: ' + ENDINGS[id].name + '. Free roam, or replay the finale from the pause menu.';
  clearTarget();
  saveGame();
  endingCb(id, ENDINGS[id]);
  return id;
}
export function replayFinale() {
  G.storyDone = false;
  G.missionIndex = 3;
  G.missionStage = 0;
  luciaAboard = false;
  if (lucia) { lucia.visible = true; lucia.position.set(GARAGE.x + 3, 0.3, GARAGE.z + 10); }
  startCurrentMission(false);
  saveGame();
}

export function updateMissions(dt, playerPos) {
  if (marker && target.pos) marker.position.set(target.pos.x, 0, target.pos.z);
  if (race) {
    race.t += dt;
    G.objective = 'Causeway Run: checkpoint ' + (race.cp + 1) + '/' + RACE_CPS.length + ' — ' + race.t.toFixed(0) + 's (par ' + RACE_PAR + 's)';
    const cp = RACE_CPS[race.cp];
    if (dist(playerPos, cp) < 10) {
      sfx.pickup();
      race.cp++;
      if (race.cp >= RACE_CPS.length) {
        const won = race.t <= RACE_PAR;
        if (won) { G.money += 500; G.track.earned += 500; G.stats.side++; }
        say('Race Starter', won ? 'You beat par! $500 is yours.' : 'Too slow — no prize. Run it again from Marina Mile.', 5);
        sfx.success();
        race = null; G.sideMode = null;
        sideCompleted('race');
        startCurrentMission(false);
        saveGame();
      } else setTarget(RACE_CPS[race.cp].x, RACE_CPS[race.cp].z, 'checkpoint');
    }
    return;
  }
  if (taxi) {
    taxi.t += dt;
    if (taxi.stage === 'pickup') {
      const pp = taxi.ped.mesh.position;
      setTarget(pp.x, pp.z, 'fare');
      if (dist(playerPos, pp) < 5 && G.driving && Math.abs(G.driving.speed) < 1.5) {
        taxi.stage = 'dropoff';
        taxi.ped.mesh.visible = false;
        setTarget(taxi.dest.x, taxi.dest.z, 'destination');
        say('Passenger', 'Thanks! Take me to the marker, quick as you can.', 3);
      }
    } else if (dist(playerPos, taxi.dest) < 9) {
      const fare = 40 + Math.max(0, 60 - Math.floor(taxi.t));
      G.money += fare; G.track.earned += fare; G.stats.side++;
      say('Passenger', 'Here is $' + fare + ' — fare plus a speed tip.', 4);
      sfx.cash();
      taxi.ped.mesh.visible = true;
      taxi = null; G.sideMode = null;
      sideCompleted('taxi');
      startCurrentMission(false);
      saveGame();
    }
    if (taxi) {
      G.objective = taxi.stage === 'pickup' ? 'Taxi: pick up the flagged passenger.' : 'Taxi: drive your passenger to the marker.';
      return;
    }
  }
  if (G.storyDone) return;
  const i = G.missionIndex;
  if (i === 0) {
    if (G.missionStage === 0 && dist(playerPos, DOCKS_PKG) < 6) {
      G.missionStage = 1;
      sfx.pickup();
      setTarget(DELIVER.x, DELIVER.z, 'delivery');
      G.objective = 'First Run: deliver the package to the Marina.';
      say(CHARACTERS[G.character || 'vera'].name, 'Package is in hand. Across town we go.', 3);
    } else if (G.missionStage === 1 && dist(playerPos, DELIVER) < 6) {
      G.missionStage = 0;
      G.missionIndex = 1;
      reward(250, 'First Run complete. Clean work, ' + PN() + '.');
      startCurrentMission(false);
    }
  } else if (i === 1) {
    const car = parkedCars[5];
    if (car && car.isTarget) setTarget(car.pos.x, car.pos.z, 'sports car');
    if (G.driving && dist(playerPos, GARAGE) < 9 && car && !car.isTarget) {
      G.missionIndex = 2;
      reward(400, 'Hot Wheels complete. The Comet looks good in my garage.');
      startCurrentMission(false);
    }
  } else if (i === 3) {
    if (!luciaAboard && dist(playerPos, GARAGE) < 8 && G.driving) {
      luciaAboard = true;
      if (lucia) lucia.visible = false;
      commitCrime(4, 'Police chase');
      setTarget(MARINA.x, MARINA.z, 'marina');
      G.objective = 'Sunset Run: escape to the marina with Lucia!';
      say('Lucia Marrero', 'Drive, ' + PN() + '! Marina Mile — do not stop for anyone!', 5);
    } else if (luciaAboard && dist(playerPos, MARINA) < 10) {
      finishFinale();
    } else if (luciaAboard && G.wanted < 3) {
      commitCrime(4, 'Police chase');
    }
  }
  applyTracking(playerPos);
}
export function missionTarget() { return target.pos; }

// ---- Quest log: main chain vs side quests, free tracking -------------------
// Tracking is one id at a time ('main', 'race', 'taxi', 'longdrive') and
// switching is free and instant — tracking a side quest moves the HUD
// objective and the world marker to it; the story simply waits. Completing
// a tracked side quest returns tracking to the main chain. Progress lives
// in its own localStorage slot alongside the game save, so it persists
// across sessions without touching the save format.
const QUEST_KEY = 'palm-cove-quests-v1';
export const questStore = { tracked: 'main', counts: { race: 0, taxi: 0 }, sideDone: { longdrive: false } };
try {
  const s = JSON.parse(localStorage.getItem(QUEST_KEY) || 'null');
  if (s) { questStore.tracked = s.tracked || 'main'; Object.assign(questStore.counts, s.counts || {}); Object.assign(questStore.sideDone, s.sideDone || {}); }
} catch (e) { /* fresh store */ }
function persistQuests() { try { localStorage.setItem(QUEST_KEY, JSON.stringify(questStore)); } catch (e) { /* best effort */ } }
export function getTrackedQuest() { return questStore.tracked; }
export function setTrackedQuest(id) {
  questStore.tracked = id;
  persistQuests();
  if (id === 'main') startCurrentMission(false); // restore the story marker
}
function sideCompleted(id) {
  if (id === 'race' || id === 'taxi') questStore.counts[id]++;
  if (id === 'longdrive') questStore.sideDone.longdrive = true;
  if (questStore.tracked === id) questStore.tracked = 'main'; // sensible return
  persistQuests();
  if (questStore.tracked === 'main') startCurrentMission(false);
}
const TAXI_RANK = { x: 150, z: 140 };
const FAR_SHORE = { x: 0, z: -4200 };
export function questLogData() {
  const names = ['First Run', 'Hot Wheels', 'Collections', 'Sunset Run'];
  const descs = [
    'Pick up Lucia\'s package at The Docks and deliver it to the Marina.',
    'Steal the marked red Comet and bring it to Lucia\'s garage.',
    'Lean on three debtors — talk them round with F, or don\'t.',
    'Pick Lucia up at the garage and escape to the marina. The ending is earned by how you played.',
  ];
  const main = names.map((n, i) => ({
    id: 'main', title: n, desc: descs[i],
    state: G.storyDone ? 'done' : i < G.missionIndex ? 'done' : i === G.missionIndex ? 'current' : 'locked',
  }));
  if (G.storyDone) main.push({ id: 'main', title: 'Story complete', desc: 'Ending reached: ' + (ENDINGS[G.lastEnding] ? ENDINGS[G.lastEnding].name : '—') + '. Replay the finale from the pause menu.', state: 'current' });
  const side = [
    { id: 'race', title: 'Causeway Run — street race', desc: 'Checkpoint race down the boulevard and over the Keys bridges.', reward: '$500 for beating 115s', hint: 'Race start: Marina Mile boulevard — be in a car at the marker, press R', state: 'open', count: questStore.counts.race },
    { id: 'taxi', title: 'Taxi fares', desc: 'Pick up flagged passengers and run them to their marker.', reward: '$40 + speed tip per fare', hint: 'Any car, anywhere: press T to take a fare', state: 'open', count: questStore.counts.taxi },
    { id: 'longdrive', title: 'The Long Drive North', desc: 'Take the peninsula highway all the way to Tallahassee Palms at the far shore.', reward: '$300, once', hint: 'Follow the highway north from the Glades — it is a drive of minutes, not seconds', state: questStore.sideDone.longdrive ? 'done' : 'open', count: questStore.sideDone.longdrive ? 1 : 0 },
  ];
  return { main, side, tracked: questStore.tracked };
}
// Called every frame at the end of updateMissions: a tracked side quest
// owns the marker and the objective line until it completes or is changed.
function applyTracking(playerPos) {
  const t = questStore.tracked;
  if (t === 'main' || race || taxi) return;
  if (t === 'race') { setTarget(RACE_START.x, RACE_START.z, 'race start'); G.objective = 'Side quest — Causeway Run: get a car to the race start in Marina Mile and press R.'; }
  else if (t === 'taxi') { setTarget(TAXI_RANK.x, TAXI_RANK.z, 'taxi rank'); G.objective = 'Side quest — Taxi: take any car, press T for a fare. (Pickups happen wherever you are.)'; }
  else if (t === 'longdrive' && !questStore.sideDone.longdrive) {
    setTarget(FAR_SHORE.x, FAR_SHORE.z, 'far shore');
    G.objective = 'Side quest — The Long Drive North: reach Tallahassee Palms at the far shore.';
    if (playerPos.z < -4150) {
      G.money += 300; G.track.earned += 300; G.stats.side++;
      say('Palm Cove', 'The far shore. You drove the whole peninsula — $300 of fuel money well spent.', 5);
      sfx.cash();
      sideCompleted('longdrive');
    }
  }
}
