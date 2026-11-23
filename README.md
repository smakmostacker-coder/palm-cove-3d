# Palm Cove

[![gta6-01 bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/smakmostacker-coder/palm-cove-3d/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/smakmostacker-coder/palm-cove-3d/reward.svg)](https://make.fun/bounty/gta6-01)

Bounty page: https://make.fun/bounty/gta6-01

A stylized **low-poly 3D open-world crime game** in the browser, set on a **Florida peninsula at dusk** — sunset-gradient sky, warm low sun, neon waking up over pastel facades. Built with a vendored copy of Three.js (r128) that loads locally; nothing is fetched over the network at runtime, and every texture is generated on a canvas at boot (no external images).

## Story

Courier **Vera Solano** — or her partner **Dario "Dax" Vega**, your choice at New Game — owes a debt to fixer **Lucia Marrero** in the coastal city of Palm Cove. Work it off across four story missions, and *how* you work decides the ending: debtors spared or taken out, money earned, busts on your record and side work all feed **six branching endings** — from *Clean Getaway* to *Kingpin of the Cove* to *Queen of the Ashes*. The finale is replayable from the pause menu, and unlocked endings are recorded in your save and stats.

## The world

- **A Florida-shaped map**: the city sits near the southern tip of a flat peninsula with ocean and beaches on **both** coasts, a **Keys island chain** arcing south over drivable causeways (past the Marlin Drawbridge to Key Solano and its Southernmost Point buoy), and the **Everglades marsh** — flat green-brown wetlands with water channels and scrub palms — inland to the north. The minimap and the pause-menu full map draw the whole silhouette.
- **A deliberate city layout**: a downtown core with the tallest glass towers, the **Ocean Drive deco strip** and marina on the east beach, the container **port** at The Docks, low residential sprawl in Coral Heights, brick Old Town, and the palm boulevards of the Palm District — each district reads differently and is named live on the HUD, as are landmarks (Marlin Point Lighthouse, Glades Airboat Dock, the Cape Marlin gantry across the bay).
- **Road structures**: the **Palm Flyover** carries a boulevard over a crossing road, the **Old Town Underpass** dips beneath another, both fully drivable with working traffic lights (red/yellow/green cycles that traffic AI obeys), tree-lined sidewalks, and street lamps with lit heads and light pools at dusk.
- **Facades with faces**: canvas-generated window grids (lit and unlit), ground-floor storefronts, neon signs and billboards for original Palm Cove brands (Cove Cola, Hotel Marlin, Neon Palms, Marlin Motors…).

## Gameplay

- **Two playable leads**: Vera Solano (blonde ponytail, pink tank top, ripped jeans) or Dax Vega (floral shirt, gold chain, pink trousers), picked side by side in 3D on the character-choice screen; the other stays in the story as an NPC partner at Lucia's garage. The choice persists in the save.
- **Five vehicle classes, all stealable**: cars, **motorcycles** (fast, nimble, rider visible), **trucks** (slow, heavy, hit harder), **police cars**, and **fire trucks** — with per-class handling and a stats breakdown by class. Traffic AI mixes all of them and stops at red lights.
- **Wanted system (0–5 stars)**: police chases, line-of-sight decay, a bust meter, and a spotlight helicopter at 4–5 stars. **BUSTED** now means time inside **Palm Cove Correctional** — serve a short stay in the yard or pay bail (B). **WASTED** wakes you at the hospital for a small treatment fee.
- **Combat & the 5-slot hotbar**: you start with **nothing but fists**. The pistol, the **sniper rifle** (scoped zoom with right-mouse/V, long range, limited rounds), snacks, armour vests, medkits and ammo are all **found as world pickups** or bought — weapons are never handed to you. Slots 1–5 select, X uses consumables; a full hotbar honestly refuses new pickups.
- **Working facilities**: **Cove Mart** minimarket (food), **Apotik Sehat** pharmacy (medkits), **Marlin Arms** gun shop (**ammo only** — never weapons), plus a gas station and bank/ATM frontage, all signed and woven into the cash economy.
- **Fire & damkar**: heavily damaged cars catch fire, burn, and explode (spreading damage and heat); stand too close and you burn too. Long-burning fires dispatch a **fire truck** that drives to the scene and sprays the flames out; burnt wrecks stay as charred props.
- **Four story missions** (*First Run*, *Hot Wheels*, *Collections*, *Sunset Run*) with spare-or-take-out choices, the **Causeway Run** checkpoint race over the Keys bridges, and **taxi fares** — plus free roam.
- **Menu & settings**: NEW GAME / LOAD GAME (with save info) / SETTINGS on the title screen, and settings in the pause menu too — volume + mute, **30/60 FPS cap**, **Standard/HD graphics tiers**, brightness, and an optional **on-screen joystick** with action buttons. Settings persist in localStorage.
- **Sound**: a WebAudio synth (sirens, gunshots, the sniper's crack, explosions, fire-truck two-tone) driven by the settings volume. No audio files.

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move / drive (arrow keys also steer) |
| Mouse (drag or pointer lock) | Orbit camera |
| Shift | Sprint |
| E | Enter / exit a vehicle · enter a shop |
| F | Punch / lean on a debtor (spare) |
| Mouse click | Fire equipped weapon · shoot near a debtor (take out) |
| Right-mouse hold or V | Sniper scope |
| 1–5 | Select hotbar slot |
| X | Use selected consumable |
| R | Start the Causeway Run race (in a car, at the Marina Mile start) |
| T | Start taxi work (in a car) |
| B | Pay bail while in prison |
| Esc or P | Pause / resume (map, stats, settings, replay finale) |
| S (on title) | Stats screen |

## How to run

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. No build step and no install: `serve.ts` serves the `game/` folder as-is.

Deterministic screenshot scenes are staged from URL parameters, e.g. `http://localhost:8080/?shot=chase&seed=1` (shots: `title` = character choice, `drive`, `chase`, `map`).

## Source structure

```
game/
  index.html        canvas container, HUD DOM, menus (title/choice/pause/map/settings/shop/ending/stats)
  vendor/three.min.js  vendored Three.js r128 (UMD build, MIT licence header in file)
  src/
    config.js       peninsula layout, districts, landmarks tuning, vehicle handling, balance
    random.js       seeded RNG (mulberry32)
    state.js        shared mutable game state (incl. story tracking for endings)
    city.js         world generation: dusk sky, facades, districts, structures, Keys, marsh, landmarks, vehicle factory
    traffic.js      pooled mixed-class AI traffic + parked vehicles to steal
    pedestrians.js  pooled sidewalk + beach walkers who flee danger
    player.js       on-foot controller, third-person camera, protagonist models
    driving.js      vehicle entry/theft, per-class arcade driving, damage
    police.js       wanted stars, chase AI, line-of-sight decay, bust meter, helicopter
    combat.js       punches, pistol, scoped sniper rifle
    fire.js         vehicle fires, explosions, charred wrecks, damkar fire-truck response
    inventory.js    5-slot hotbar: weapons + consumables, selection, use
    facilities.js   minimarket, pharmacy, gun shop (ammo only), gas, bank, prison
    missions.js     story missions, dialogue choices, six endings, race, taxi
    hud.js          GTA-register HUD, hotbar, Florida-silhouette minimap + full map
    audio.js        WebAudio synth sound effects (settings-driven master gain)
    settings.js     persisted settings: volume, FPS cap, graphics tier, brightness, joystick
    save.js         localStorage save slot (progress, inventory, endings, character)
    shots.js        deterministic ?shot= staging for screenshots
    main.js         boot, state machine, game loop, settings/joystick wiring
main.ts             hands the entry in (copies game/ + screenshots/, writes dossier.json)
serve.ts            tiny local static server for game/
screenshots/        the four entry screenshots listed in shots.json
```

## Performance discipline

Canvas textures only, instanced/reused props throughout (buildings, palms, trees, lamps, lights, containers, structures), shadows off, fog on, fixed pools for traffic/pedestrians/police, and no per-frame allocations in the hot loop. The standard graphics tier keeps the build light; the HD settings tier raises pixel ratio and view distance for stronger machines.

## Licence

The game code in this repository is original work for the make.fun gta6-01 bounty. Three.js is vendored under its MIT licence (see the header of `game/vendor/three.min.js`).
