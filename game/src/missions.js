// missions.js - story, side jobs, quest log and endings for Palm Cove.
import { G } from './state.js';
import { MARINA, GARAGE, POLICE_STATION, HOME_DOOR, FACILITIES } from './config.js';
import { makePersonMesh, posePerson } from './city.js';
import { say, setObjective, showBanner, showChoice } from './hud.js';
import { commitCrime } from './police.js';
import { vehicles } from './driving.js';
import { player } from './player.js';
import { sfx } from './audio.js';

export const ENDINGS = {
  betrayed: { name: 'BETRAYED', text: 'The courier kept what was not theirs, and Palm Cove keeps its receipts. Lucia smiled at the marina, the way a blade smiles in sunlight, and the night closed over the dock with no witnesses willing to remember a face.' },
  busted: { name: 'BUSTED FOR GOOD', text: 'Sirens became the soundtrack of the courier\'s life, and one night the song finally caught up. Palm Cove PD got their photograph, their fingerprints and their silence. The marina lights kept shining for everybody else.' },
  kingpin: { name: 'KINGPIN OF PALM COVE', text: 'Money talks in Palm Cove, and the courier learned to speak it fluently, in cash, with blood on the edges of the bills. Lucia takes meetings now in a room the courier pays for. The cove belongs to whoever holds it hardest.' },
  ghost: { name: 'GHOST', text: 'No bodies, no headlines, no name the police can spell. The courier moved through Palm Cove like weather through a screen door, settled every debt with words, and left the city owing them a story nobody can prove.' },
  broke: { name: 'BROKE AND BURNED', text: 'The skim was small, the hole it dug was not. By final night the courier had empty pockets, a borrowed reputation and creditors on three streets. Palm Cove is a beautiful place to go broke, which is the coldest comfort it offers anyone.' },
  getaway: { name: 'CLEAN GETAWAY', text: 'The courier did the work, took the money and pointed the night toward the water. Palm Cove shrank in the mirror, neon smearing into one long colour. Some debts stayed behind. Enough of a life came along for the ride.' },
};

// Helpers -----------------------------------------------------------------
function dist(ax, az, bx, bz) { const dx = ax - bx; const dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
function playerDist(x, z) { return dist(player.pos.x, player.pos.z, x, z); }
// Every payment is also lifetime earnings, so endings never disagree with the HUD.
function pay(n) { G.money += n; G.stats.earned += n; }
function stage() { return G.flags.story || 'idle'; }
function setStage(next) { G.flags.story = next; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// Road lines of the city grid; random job points snap to these so fares land on streets.
const ROAD_COORDS = [-240, -160, -80, 0, 80, 160, 240];
function randomRoadPoint(nearX, nearZ, minD, maxD) {
  for (let tries = 0; tries < 24; tries++) {
    const onVertical = Math.random() < 0.5;
    const line = pick(ROAD_COORDS);
    const along = -300 + Math.random() * 600;
    const x = onVertical ? line : along;
    const z = onVertical ? along : line;
    const d = dist(x, z, nearX, nearZ);
    if (d >= minD && d <= maxD) return { x, z };
  }
  return { x: pick(ROAD_COORDS), z: 0 };
}
function facilityDoors() {
  // Normalise defensively so a facility data tweak cannot break courier routing.
  const out = [];
  if (Array.isArray(FACILITIES)) {
    for (const f of FACILITIES) {
      const x = f.door ? f.door.x : f.x;
      const z = f.door ? f.door.z : f.z;
      if (typeof x === 'number' && typeof z === 'number') out.push({ x, z, name: f.name || 'a storefront' });
    }
  }
  return out;
}

// Objective marker ----------------------------------------------------------
let sceneRef = null;
let markerGroup = null;
let markerBeam = null;
let markerRing = null;
let markerTarget = null;
let markerClock = 0;
function buildMarker() {
  markerGroup = new THREE.Group();
  // A tall soft beam reads from across the city without a minimap arrow.
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffcf4d, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  markerBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 42, 18, 1, true), beamMat);
  markerBeam.position.y = 21;
  markerGroup.add(markerBeam);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffcf4d, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  markerRing = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.9, 40), ringMat);
  markerRing.rotation.x = -Math.PI / 2;
  markerRing.position.y = 0.12;
  markerGroup.add(markerRing);
  markerGroup.visible = false;
  sceneRef.add(markerGroup);
}
function setMarker(x, z) {
  markerTarget = { x, z };
  if (markerGroup) { markerGroup.position.set(x, 0, z); markerGroup.visible = true; }
}
function hideMarker() { markerTarget = null; if (markerGroup) markerGroup.visible = false; }
export function markerPos() { return markerTarget ? { x: markerTarget.x, z: markerTarget.z } : null; }

// NPCs ----------------------------------------------------------------------
let lucia = null;
let debtors = [];
let debtorIndex = 0;
let debtorBusy = false;
const DEBTOR_SPOTS = [
  { x: -120, z: 60, area: 'Old Town' },
  { x: 120, z: -40, area: 'Marina Mile' },
  { x: -60, z: -300, area: 'the Glades edge' },
];
const DEBTOR_LOOKS = [
  { shirt: 0x2e5f4f, pants: 0x2a2a30, hairStyle: 'short', hairColor: 0x111111, face: 'nervous' },
  { shirt: 0xb8b0a0, pants: 0x3a2e22, hairStyle: 'cap', hairColor: 0x3a2410, face: 'smug' },
  { shirt: 0x24405e, pants: 0x191919, hairStyle: 'long', hairColor: 0x552200, face: 'tired' },
];
const DEBTOR_LINES = [
  'I had it. I swear I had it yesterday.',
  'Lucia sent muscle now? Times are hard for everyone.',
  'Tell her the money exists. It is just... theoretical.',
];
function buildLucia() {
  lucia = makePersonMesh({ shirt: 0x7a1f3d, pants: 0x1c1c22, hairStyle: 'bun', hairColor: 0x201409, face: 'stern' });
  lucia.position.set(172, 0, 176);
  lucia.rotation.y = Math.PI * 0.75;
  sceneRef.add(lucia);
}
function buildDebtors() {
  debtors = DEBTOR_SPOTS.map((spot, i) => {
    const mesh = makePersonMesh(DEBTOR_LOOKS[i]);
    mesh.position.set(spot.x, 0, spot.z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    sceneRef.add(mesh);
    return { mesh, x: spot.x, z: spot.z, area: spot.area, down: false, settled: false };
  });
  debtorIndex = 0;
}

// Story state ---------------------------------------------------------------
let step = 0;
let pendingStage = null;
let markedCar = null;
let markedCarTriggered = false;
let endingReturned = false;
let finaleBusy = false;
export function startWakeFlow() {
  // main calls this once the wake-up releases the player; the intro is a walk, not a menu.
  setStage('intro');
  step = 0;
  endingReturned = false;
  finaleBusy = false;
  setObjective('Leave the house');
  setMarker(HOME_DOOR.x, HOME_DOOR.z);
  showBanner('PALM COVE', 3);
}
function introUpdate() {
  if (step === 0) {
    setMarker(HOME_DOOR.x, HOME_DOOR.z);
    if (!G.interior && playerDist(HOME_DOOR.x, HOME_DOOR.z) < 7) {
      step = 1;
      say('Partner', 'Took you long enough. Car\'s ready when you are.', 4);
      say('Partner', 'Lucia first. Marina. She hates waiting more than losing money.', 5);
      setObjective('Meet your partner outside');
    }
  } else if (step === 1) {
    if (playerDist(HOME_DOOR.x, HOME_DOOR.z) < 3) {
      step = 2;
      setObjective('Drive to Lucia at the Marina');
      setMarker(172, 176);
      say('Partner', 'I\'ll ride along in spirit. Mostly I\'ll just ride.', 4);
    }
  } else if (step === 2) {
    setMarker(172, 176);
    if (playerDist(172, 176) < 6) {
      step = 0;
      setStage('m1');
      say('Lucia', 'You are the new courier. Good. Faces I know cost extra.', 5);
      say('Lucia', 'Docks. Package. Coral Heights. Money is simple until people touch it.', 6);
      showBanner('FIRST RUN', 3);
      setObjective('Pick up the package at the docks');
      setMarker(182, 186);
      sfx.pickup();
    }
  }
}
function m1Update() {
  if (pendingStage === 'm2') { pendingStage = null; setStage('m2'); beginCollections(); return; }
  if (step === 0) {
    setMarker(182, 186);
    if (playerDist(182, 186) < 3) {
      step = 1;
      sfx.pickup();
      say('Lucia (phone)', 'You have it. Coral Heights, the drop by the palms. Do not open it.', 5);
      setObjective('Deliver the package to Coral Heights');
      setMarker(40, 120);
    }
  } else if (step === 1) {
    setMarker(40, 120);
    if (playerDist(40, 120) < 4) {
      step = 2;
      hideMarker();
      showChoice('The buyer waits, cash in hand. The package feels heavier than paper.', ['Hand over the package', 'Keep the package'], (idx) => {
        if (idx === 0) {
          pay(350);
          G.flags.cleanHands = true;
          say('Lucia (phone)', '$350. Clean work. Keep being boring, courier.', 5);
        } else {
          pay(200);
          G.flags.keptPackage = true;
          G.stats.choices.push('kept');
          say('Lucia (phone)', 'The buyer says the bag felt light. Pray he is lying.', 5);
        }
        sfx.buy();
        pendingStage = 'm2';
      });
    }
  }
}
function beginCollections() {
  buildDebtors();
  step = 0;
  showBanner('COLLECTIONS', 3);
  say('Lucia', 'Three names owe me. Visit them in order. Bring money or bring news.', 6);
  setObjective('Collect from the debtor in Old Town');
  setMarker(DEBTOR_SPOTS[0].x, DEBTOR_SPOTS[0].z);
}
function m2Update(dt) {
  if (debtorBusy) return;
  const d = debtors[debtorIndex];
  if (!d) { setStage('m3'); beginMarkedCar(); return; }
  setMarker(d.x, d.z);
  if (d.mesh) posePerson(d.mesh, dt * 2, d.down ? 'down' : 'idle');
  if (!d.settled && playerDist(d.x, d.z) < 2.6) {
    debtorBusy = true;
    hideMarker();
    say('Debtor', DEBTOR_LINES[debtorIndex], 4);
    say('Lucia (phone)', 'Persuade or finish it. Both pay. Only one sleeps well.', 4);
    showChoice('The debtor in ' + d.area + ' owes Lucia. Settle it.', ['Persuade them', 'Take them out'], (idx) => {
      d.settled = true;
      if (idx === 0) {
        G.stats.spared += 1;
        G.stats.choices.push('spared');
        pay(80);
        say('Debtor', 'Okay! Okay. Tell Lucia it is paid. All of it.', 4);
        sfx.buy();
      } else {
        d.down = true;
        if (d.mesh) posePerson(d.mesh, 0, 'down');
        G.stats.tookOut += 1;
        G.stats.choices.push('tookout');
        commitCrime(3, 'Debtor taken out', { victim: true, pos: { x: d.x, z: d.z } });
        say('Lucia (phone)', 'Cold. Effective. The next one pays faster, they always do.', 5);
      }
      debtorIndex += 1;
      debtorBusy = false;
      if (debtorIndex >= debtors.length) { setStage('m3'); beginMarkedCar(); }
      else {
        setObjective('Collect from the debtor at ' + DEBTOR_SPOTS[debtorIndex].area);
        setMarker(DEBTOR_SPOTS[debtorIndex].x, DEBTOR_SPOTS[debtorIndex].z);
      }
    });
  }
}
function beginMarkedCar() {
  step = 0;
  markedCar = null;
  markedCarTriggered = false;
  let best = null;
  let bestD = Infinity;
  for (const v of vehicles) {
    if (!v || v.wrecked || v.driver) continue;
    const d = dist(v.pos.x, v.pos.z, GARAGE.x, GARAGE.z);
    if (d < bestD) { bestD = d; best = v; }
  }
  markedCar = best;
  showBanner('THE MARKED CAR', 3);
  say('Lucia', 'A car near the garage is wearing the wrong plates and the right secrets.', 6);
  say('Lucia', 'Take it to the lockup. If the police notice, that is the job noticing you back.', 6);
  if (markedCar) { setObjective('Steal the marked car near the garage'); setMarker(markedCar.pos.x, markedCar.pos.z); }
  else { setObjective('Find a car near the garage'); setMarker(GARAGE.x, GARAGE.z); }
}
function m3Update() {
  if (pendingStage === 'm4') {
    pendingStage = null;
    setStage('m4');
    step = 0;
    showBanner('FINAL NIGHT', 3);
    say('Lucia', 'Marina. Tonight. Whatever you have become, bring it with you.', 6);
    setObjective('Meet Lucia at the marina for the final night');
    setMarker(176, 190);
    return;
  }
  if (!markedCar) { beginMarkedCar(); return; }
  if (step === 0) {
    setMarker(markedCar.pos.x, markedCar.pos.z);
    if (G.driving && G.driving === markedCar && !markedCarTriggered) {
      markedCarTriggered = true;
      step = 1;
      commitCrime(4, 'Police chase', { instant: true, pos: { x: player.pos.x, z: player.pos.z } });
      say('Lucia (phone)', 'That is the heat I warned you about. Lockup, south side. Lose them or outrun them.', 6);
      setObjective('Deliver the marked car to the lockup');
      setMarker(60, -120);
    }
  } else if (step === 1) {
    setMarker(60, -120);
    if (G.driving && G.driving === markedCar && playerDist(60, -120) < 6) {
      step = 2;
      hideMarker();
      pay(600);
      sfx.buy();
      say('Lucia', 'Car delivered, courier intact. Six hundred, as agreed.', 5);
      showChoice('Lucia counts the money twice. Her cut sits on top of the stack.', ['Give Lucia her full cut', 'Skim $250 off the top'], (idx) => {
        if (idx === 0) { G.flags.loyal = true; say('Lucia', 'Full cut. Rare. Remembered.', 4); }
        else { pay(250); G.flags.skimmed = true; G.stats.choices.push('skimmed'); say('Lucia', 'She smiles like she miscounted. She never miscounts.', 4); }
        pendingStage = 'm4';
      });
    }
  }
}
function evaluateEnding() {
  // First match wins; the order is the moral ranking of the whole run.
  const s = G.stats;
  if (s.busted >= 2) return 'busted';
  if (G.flags.keptPackage && s.tookOut >= 1) return 'betrayed';
  if (G.flags.skimmed && G.money < 100) return 'broke';
  if (s.earned >= 2500 && s.tookOut >= 2) return 'kingpin';
  if (s.busted === 0 && s.spared >= 3) return 'ghost';
  return 'getaway';
}
function m4Update() {
  if (finaleBusy || endingReturned) return null;
  setMarker(176, 190);
  if (playerDist(176, 190) < 5) {
    finaleBusy = true;
    hideMarker();
    const id = evaluateEnding();
    if (!G.endingsFound.includes(id)) G.endingsFound.push(id);
    setStage('done');
    setObjective('');
    showBanner(ENDINGS[id].name, 6);
    say('Lucia', 'Whatever Palm Cove made of you, it is yours now. Spend it carefully.', 6);
    endingReturned = true;
    return 'ending:' + id;
  }
  return null;
}

// Side jobs -----------------------------------------------------------------
let job = null;
let jobCooldown = 0;
let taxiTimer = 18;
const jobCounts = { race: 0, taxi: 0, courier: 0, vigilante: 0, repo: 0 };
const startRings = {};
const JOB_STARTS = [
  { type: 'race', x: 170, z: 0, label: 'Street Race' },
  { type: 'courier', x: 30, z: 24, label: 'Courier Run' },
  { type: 'vigilante', x: POLICE_STATION.x, z: -60, label: 'Vigilante' },
  { type: 'repo', x: GARAGE.x, z: 88, label: 'Repo Job' },
];
const RACE_CHECKPOINTS = [
  { x: 160, z: 160 }, { x: 0, z: 240 }, { x: -160, z: 160 },
  { x: -240, z: 0 }, { x: -160, z: -160 }, { x: 80, z: -80 },
];
function buildStartRings() {
  for (const s of JOB_STARTS) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x4dd8ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 2.0, 32), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.1, s.z);
    sceneRef.add(ring);
    startRings[s.type] = ring;
  }
}
function finishJob(success, message) {
  if (job && success) { G.stats.jobsDone += 1; jobCounts[job.type] = (jobCounts[job.type] || 0) + 1; }
  if (message) say('Dispatch', message, 4);
  if (job && job.cleanup) job.cleanup();
  job = null;
  jobCooldown = 4;
  hideMarker();
  setObjective('');
}
function startRace() {
  job = { type: 'race', title: 'Street Race', index: 0, time: 95 };
  showBanner('STREET RACE', 3);
  say('Race', 'Six checkpoints, ninety-five seconds. The city is the track.', 5);
  setObjective('Street Race: checkpoint 1 of 6');
  setMarker(RACE_CHECKPOINTS[0].x, RACE_CHECKPOINTS[0].z);
}
function raceUpdate(dt) {
  job.time -= dt;
  if (job.time <= 0) { finishJob(false, null); say('Race', 'Too slow. The boulevard keeps your entry fee.', 4); return; }
  const cp = RACE_CHECKPOINTS[job.index];
  setMarker(cp.x, cp.z);
  if (G.driving && playerDist(cp.x, cp.z) < 7) {
    job.index += 1;
    sfx.pickup();
    if (job.index >= RACE_CHECKPOINTS.length) { pay(300); sfx.buy(); finishJob(true, 'Clean run. $300, no questions, no names.'); }
    else {
      setObjective('Street Race: checkpoint ' + (job.index + 1) + ' of 6');
      setMarker(RACE_CHECKPOINTS[job.index].x, RACE_CHECKPOINTS[job.index].z);
    }
  }
}
function maybeStartTaxi(dt) {
  // Fares only hail a driving, unoccupied player; parked loitering summons nobody.
  if (!G.driving) { taxiTimer = Math.max(taxiTimer, 6); return; }
  taxiTimer -= dt;
  if (taxiTimer > 0) return;
  taxiTimer = 40;
  if (Math.random() < 0.35) return;
  const p = randomRoadPoint(player.pos.x, player.pos.z, 40, 250);
  job = { type: 'taxi', title: 'Taxi Fare', phase: 'pickup', pickup: p, dest: null, tripDist: 0 };
  say('Fare', 'Hey! I need a ride. I pay cash and I do not scream much.', 4);
  setObjective('Taxi: pick up the fare');
  setMarker(p.x, p.z);
}
function taxiUpdate() {
  if (job.phase === 'pickup') {
    setMarker(job.pickup.x, job.pickup.z);
    if (G.driving && playerDist(job.pickup.x, job.pickup.z) < 5) {
      const d = randomRoadPoint(job.pickup.x, job.pickup.z, 150, 500);
      job.dest = d;
      job.tripDist = dist(job.pickup.x, job.pickup.z, d.x, d.z);
      job.phase = 'dropoff';
      sfx.pickup();
      say('Fare', 'Across town. Fast is fine. Alive is required.', 4);
      setObjective('Taxi: drop the fare off');
      setMarker(d.x, d.z);
    }
  } else {
    setMarker(job.dest.x, job.dest.z);
    if (G.driving && playerDist(job.dest.x, job.dest.z) < 6) {
      const fare = 40 + Math.round(job.tripDist / 12);
      pay(fare);
      sfx.buy();
      finishJob(true, 'Fare paid $' + fare + '. Five stars, no review.');
    }
  }
}
function startCourier() {
  const doors = facilityDoors().filter((d) => dist(d.x, d.z, 30, 24) > 60);
  const target = doors.length ? pick(doors) : randomRoadPoint(30, 24, 120, 420);
  job = { type: 'courier', title: 'Courier Run', dest: target, time: 150 };
  showBanner('COURIER RUN', 3);
  say('Cove Mart', 'One bag, one address, clock is already rude. Go.', 4);
  setObjective('Courier: deliver the bag');
  setMarker(target.x, target.z);
}
function courierUpdate(dt) {
  job.time -= dt;
  if (job.time <= 0) { finishJob(false, null); say('Cove Mart', 'Too late. The bag is groceries now. Sad groceries.', 4); return; }
  setMarker(job.dest.x, job.dest.z);
  if (playerDist(job.dest.x, job.dest.z) < 4) { pay(180); sfx.buy(); finishJob(true, 'Delivered. $180 and a nod that almost meant something.'); }
}
let vigilTarget = null;
function startVigilante() {
  const angle = Math.random() * Math.PI * 2;
  const d = 120 + Math.random() * 80;
  const sx = clamp(POLICE_STATION.x + Math.cos(angle) * d, -300, 300);
  const sz = clamp(POLICE_STATION.z + Math.sin(angle) * d, -320, 320);
  vigilTarget = makePersonMesh({ shirt: 0x555555, pants: 0x222226, hairStyle: 'short', hairColor: 0x090909, face: 'nervous' });
  vigilTarget.position.set(sx, 0, sz);
  sceneRef.add(vigilTarget);
  job = {
    type: 'vigilante', title: 'Vigilante', x: sx, z: sz, dir: 1, turnTimer: 3,
    cleanup: () => { if (vigilTarget && vigilTarget.parent) vigilTarget.parent.remove(vigilTarget); vigilTarget = null; },
  };
  showBanner('VIGILANTE', 3);
  say('Desk Sergeant', 'Suspect fled on foot. Bring him down, not in. Tackle him.', 5);
  setObjective('Vigilante: tackle the fleeing suspect');
  setMarker(sx, sz);
}
function vigilanteUpdate(dt, ctx) {
  if (!vigilTarget) { finishJob(false, null); return; }
  // The suspect zigzags: mostly +x, drifting in z, random turns so a straight chase is unsolved.
  job.turnTimer -= dt;
  if (job.turnTimer <= 0) { job.turnTimer = 2 + Math.random() * 3; job.dir = Math.random() < 0.5 ? 1 : -1; }
  const speed = 6.2;
  job.x = clamp(job.x + speed * dt, -310, 310);
  job.z = clamp(job.z + job.dir * speed * 0.55 * dt, -330, 330);
  vigilTarget.position.set(job.x, 0, job.z);
  vigilTarget.rotation.y = Math.atan2(speed, job.dir * speed * 0.55);
  posePerson(vigilTarget, performance.now() / 90, 'run');
  setMarker(job.x, job.z);
  if (ctx.interactPressed && playerDist(job.x, job.z) < 1.8) {
    posePerson(vigilTarget, 0, 'down');
    pay(250);
    sfx.buy();
    finishJob(true, 'Suspect down. The sergeant owes you $250 and plausible deniability.');
  }
}
function startRepo() {
  const anchor = randomRoadPoint(GARAGE.x, GARAGE.z, 80, 380);
  let best = null;
  let bestD = Infinity;
  for (const v of vehicles) {
    if (!v || v.wrecked || v.driver) continue;
    const d = dist(v.pos.x, v.pos.z, anchor.x, anchor.z);
    if (d < bestD) { bestD = d; best = v; }
  }
  if (!best) { say('Garage', 'No repo target on the street right now. Try later.', 4); return; }
  job = { type: 'repo', title: 'Repo Job', car: best };
  showBanner('REPO JOB', 3);
  say('Garage', 'Owner stopped paying, started hiding. Bring that car home.', 5);
  setObjective('Repo: bring the marked car back to the garage');
  setMarker(best.pos.x, best.pos.z);
}
function repoUpdate() {
  if (!job.car) { finishJob(false, null); return; }
  if (G.driving === job.car) {
    setMarker(GARAGE.x, 88);
    if (playerDist(GARAGE.x, 88) < 7) { pay(220); sfx.buy(); finishJob(true, 'Repo complete. $220 and the lock clicks like music.'); }
  } else setMarker(job.car.pos.x, job.car.pos.z);
}
function jobUpdate(dt, ctx) {
  if (!job) return;
  if (job.type === 'race') raceUpdate(dt);
  else if (job.type === 'taxi') taxiUpdate();
  else if (job.type === 'courier') courierUpdate(dt);
  else if (job.type === 'vigilante') vigilanteUpdate(dt, ctx);
  else if (job.type === 'repo') repoUpdate();
}
function startRingUpdate(ctx) {
  const idle = !job && jobCooldown <= 0;
  for (const s of JOB_STARTS) {
    const ring = startRings[s.type];
    if (ring) ring.visible = idle;
    if (!idle || !ctx.interactPressed) continue;
    if (playerDist(s.x, s.z) < 3) {
      if (s.type === 'race') startRace();
      else if (s.type === 'courier') startCourier();
      else if (s.type === 'vigilante') startVigilante();
      else if (s.type === 'repo') startRepo();
      if (job) sfx.door();
    }
  }
}

// Public API ------------------------------------------------------------------
export function initMissions(scene) {
  sceneRef = scene;
  buildMarker();
  buildLucia();
  buildStartRings();
  if (!G.flags.story) setStage('idle');
  if (stage() === 'intro') { setObjective('Leave the house'); setMarker(HOME_DOOR.x, HOME_DOOR.z); }
}
export function updateMissions(dt, ctx) {
  const safeCtx = ctx || { interactPressed: false };
  markerClock += dt;
  // The beam breathes so the eye catches it without a hard blink.
  if (markerGroup && markerGroup.visible) {
    if (markerBeam) markerBeam.material.opacity = 0.24 + Math.sin(markerClock * 2.4) * 0.07;
    if (markerRing) { const s = 1 + Math.sin(markerClock * 2.4) * 0.08; markerRing.scale.set(s, s, 1); }
  }
  if (lucia) posePerson(lucia, markerClock * 0.6, 'idle');
  if (jobCooldown > 0) jobCooldown -= dt;
  let event = null;
  const st = stage();
  if (st === 'intro') introUpdate();
  else if (st === 'm1') m1Update();
  else if (st === 'm2') m2Update(dt);
  else if (st === 'm3') m3Update();
  else if (st === 'm4') event = m4Update();
  // A running job owns the marker; the story resumes it when the job clears.
  if (job) jobUpdate(dt, safeCtx);
  else if (st === 'idle') hideMarker();
  startRingUpdate(safeCtx);
  if (!job) maybeStartTaxi(dt);
  return event;
}
export function getQuests() {
  const order = ['intro', 'm1', 'm2', 'm3', 'm4', 'done'];
  const here = Math.max(0, order.indexOf(stage()));
  function missionState(idx) {
    if (stage() === 'done') return 'done';
    if (here > idx + 1) return 'done';
    if (here === idx + 1 || (here === 0 && idx === 0)) return 'active';
    return 'locked';
  }
  const main = [
    { title: 'First Run', state: missionState(0) },
    { title: 'Collections', state: missionState(1) },
    { title: 'The Marked Car', state: missionState(2) },
    { title: 'Final Night', state: missionState(3) },
  ];
  const titles = { race: 'Street Race', taxi: 'Taxi Fare', courier: 'Courier Run', vigilante: 'Vigilante', repo: 'Repo Job' };
  const side = ['race', 'taxi', 'courier', 'vigilante', 'repo'].map((t) => {
    let state = 'available';
    if (job && job.type === t) state = 'active';
    else if (jobCounts[t] > 0) state = 'done ×' + jobCounts[t];
    return { title: titles[t], state };
  });
  return { main, side };
}
// MARINA and POLICE_STATION anchor flavour checks in debugging; referencing them
// here keeps the contract imports honest without extra runtime state.
void MARINA;
void POLICE_STATION;
