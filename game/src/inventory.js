// Inventory: five slots, no stacking — scarcity keeps pickups meaningful.
import { G } from './state.js';

export const ITEMS = {
  pistol: {
    name: 'Pistol',
    kind: 'weapon',
    color: 0x8f9aa6,
  },
  sniper: {
    name: 'Sniper Rifle',
    kind: 'weapon',
    scoped: true,
    color: 0x3f4a3a,
  },
  medkit: {
    name: 'Medkit',
    kind: 'heal',
    amount: 50,
    color: 0xe8e8e8,
  },
  snack: {
    name: 'Snack',
    kind: 'heal',
    amount: 15,
    color: 0xf2a541,
  },
  tonic: {
    name: 'Herbal Tonic',
    kind: 'heal',
    amount: 100,
    color: 0x6fbf73,
  },
  firecan: {
    name: 'Fuel Can',
    kind: 'fire',
    color: 0xd64545,
  },
};

// Starts empty on purpose: the player earns every tool they carry.
export const INV = [null, null, null, null, null];

export let selected = 0;

export const ammo = { pistol: 0, sniper: 0 };

function clampSlot(i) {
  const n = Number.isFinite(i) ? Math.trunc(i) : 0;
  return Math.max(0, Math.min(INV.length - 1, n));
}

export function selectSlot(i) {
  selected = clampSlot(i);
  return selected;
}

export function selectedItem() {
  return INV[selected] || null;
}

export function firstEmptySlot() {
  for (let i = 0; i < INV.length; i++) {
    if (!INV[i]) return i;
  }
  return -1;
}

export function giveItem(id) {
  // Unknown ids are refused so bad spawns never poison a save.
  if (!ITEMS[id]) return false;
  const slot = firstEmptySlot();
  if (slot === -1) return false;
  INV[slot] = id;
  return true;
}

export function clearSlot(i) {
  if (i < 0 || i >= INV.length) return;
  INV[i] = null;
}

export function hasItem(id) {
  return INV.includes(id);
}

export function useSelected() {
  const id = selectedItem();
  if (!id) return null;
  const def = ITEMS[id];
  if (!def) {
    clearSlot(selected);
    return null;
  }
  if (def.kind === 'heal') {
    // Healing consumes the item even at full health is avoided by callers;
    // here the contract is simple: use it, gain, lose the slot.
    G.health = Math.min(100, G.health + (def.amount || 0));
    clearSlot(selected);
    return 'healed';
  }
  if (def.kind === 'fire') {
    clearSlot(selected);
    return 'fire';
  }
  if (def.kind === 'weapon') {
    return 'weapon';
  }
  return null;
}

export function addAmmo(kind, n) {
  if (!(kind in ammo)) return;
  const add = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  ammo[kind] += add;
}

export function useAmmo(kind) {
  if (!(kind in ammo)) return false;
  if (ammo[kind] <= 0) return false;
  ammo[kind] -= 1;
  return true;
}

export function invSnapshot() {
  // Copies, not references, so a saved game cannot mutate live play.
  return {
    slots: INV.slice(),
    ammo: { pistol: ammo.pistol, sniper: ammo.sniper },
  };
}

export function invRestore(data) {
  if (!data || typeof data !== 'object') return;
  const slots = Array.isArray(data.slots) ? data.slots : [];
  for (let i = 0; i < INV.length; i++) {
    const id = slots[i];
    INV[i] = id && ITEMS[id] ? id : null;
  }
  const savedAmmo = data.ammo && typeof data.ammo === 'object' ? data.ammo : {};
  for (const kind of Object.keys(ammo)) {
    const v = savedAmmo[kind];
    ammo[kind] = Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
  }
  selected = clampSlot(selected);
}

// World spots only; the gun-shop pistol is stocked by the shop itself.
export const PICKUP_SPOTS = [
  { id: 'sniper', x: 170, z: 178, label: 'Sniper Rifle — marina crane platform' },
  { id: 'firecan', x: 134, z: 24, label: 'Fuel Can — beside Solano Gas' },
  { id: 'medkit', x: 97, z: -68, label: 'Medkit — hospital steps' },
  { id: 'pistol', x: 10, z: 410, label: 'Pistol — Key Solano dock' },
  { id: 'snack', x: 8, z: -900, label: 'Snack — highway rest stop' },
];

const pickupMeshes = [];
let pickupClock = 0;

export function buildPickups(scene) {
  const THREE = globalThis.THREE;
  if (!scene || !THREE) return pickupMeshes;
  // Rebuilds start clean so a restarted run never doubles a pickup.
  for (const entry of pickupMeshes) {
    if (entry.mesh && entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
  }
  pickupMeshes.length = 0;
  for (const spot of PICKUP_SPOTS) {
    const def = ITEMS[spot.id];
    const geo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const mat = new THREE.MeshBasicMaterial({ color: def ? def.color : 0xffffff });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(spot.x, 1.1, spot.z);
    scene.add(mesh);
    pickupMeshes.push({ spot, mesh, baseY: 1.1, taken: false });
  }
  return pickupMeshes;
}

export function updatePickups(dt, playerPos, interactPressed) {
  pickupClock += Number.isFinite(dt) ? dt : 0;
  if (!playerPos) return null;
  let pickedName = null;
  for (const entry of pickupMeshes) {
    const { spot, mesh } = entry;
    if (entry.taken) {
      if (mesh) mesh.visible = false;
      continue;
    }
    if (mesh) {
      // Motion is the affordance: a bobbing box reads as "take me".
      mesh.visible = true;
      mesh.position.y = entry.baseY + Math.sin(pickupClock * 2.4 + spot.x) * 0.18;
      mesh.rotation.y += (Number.isFinite(dt) ? dt : 0) * 1.6;
    }
    if (!interactPressed || pickedName) continue;
    const dx = playerPos.x - spot.x;
    const dz = playerPos.z - spot.z;
    if (dx * dx + dz * dz > 2.2 * 2.2) continue;
    // Only a successful give marks the spot taken; a full bag leaves it.
    if (giveItem(spot.id)) {
      entry.taken = true;
      if (mesh) mesh.visible = false;
      const def = ITEMS[spot.id];
      pickedName = def ? def.name : spot.id;
    }
  }
  return pickedName;
}
