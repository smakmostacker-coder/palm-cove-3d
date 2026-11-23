# Palm Cove

[![gta6-01 bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/smakmostacker-coder/palm-cove-3d/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/smakmostacker-coder/palm-cove-3d/reward.svg)](https://make.fun/bounty/gta6-01)

Bounty page: https://make.fun/bounty/gta6-01

A stylized **low-poly 3D open-world crime game** in the browser — bright saturated colours, blocky buildings and characters, flat materials, no photorealism. Built with a vendored copy of Three.js (r128) that loads locally; nothing is fetched over the network at runtime.

## Story

Courier **Vera Solano** owes a debt to fixer **Lucia Marrero** in the coastal city of Palm Cove. Work it off across four story missions — a first delivery run, a marked car to steal, three debtors to lean on, and a final sunset escape under a four-star chase — then keep earning in free roam.

## Features

- **A living city**: a road grid with five named districts (Marina Mile, The Docks, Coral Heights, Old Town, Palm District) shown on the HUD as you move, instanced low-poly buildings, palm trees along the streets, and a beach + ocean edge.
- **On foot and behind the wheel**: third-person walking/sprinting with a mouse-orbit camera, parked cars to steal, pooled traffic AI driving the grid, and pedestrians who stroll the sidewalks and flee danger.
- **Wanted system (0–5 stars)**: crimes raise the heat, pooled police cars chase you, breaking line of sight cools it down star by star, a bust meter fills when officers are close and you are slow, and a police helicopter with a spotlight cone circles you at 4–5 stars. Get **BUSTED** and you respawn at the police station minus a fine; hit zero health and you are **WASTED**, respawning at the hospital.
- **Four story missions** with dialogue boxes, waypoint markers and cash rewards: *First Run*, *Hot Wheels*, *Collections*, and *Sunset Run*.
- **Side activities**: a repeatable checkpoint **street race** against a par time, and **taxi fares** (pick up a passenger, earn the fare plus a speed tip).
- **HUD**: health bar, money, wanted stars, current objective, district name, weapon/speed — plus a live canvas minimap with roads, the player arrow, mission markers and police blips.
- **Combat**: fists (F) from the start; Lucia lends Vera a pistol (mouse click) during *Collections*.
- **Sound**: a small WebAudio synth — pickup blips, sirens, gunshots, crash thuds and success stings. No audio files.
- **Saves & stats**: a localStorage autosave slot with Continue, and a stats screen (cars stolen, distance driven, missions and side activities completed, completion %).
- **Performance discipline**: box geometry only, flat Lambert materials, one directional + one hemisphere light, shadows off, fog-capped view distance, pixel ratio clamped to 1.5, and fixed object pools for traffic, pedestrians and police — no per-frame allocations in the hot loop.

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move / drive (arrow keys also steer) |
| Mouse (drag or pointer lock) | Orbit camera |
| Shift | Sprint |
| E | Enter / exit a car (steal it) |
| F | Punch / intimidate |
| Mouse click | Fire the pistol (once armed) |
| R | Start the street race (in a car, at the Old Town start) |
| T | Start taxi work (in a car) |
| Esc or P | Pause / resume |
| S (on title) | Stats screen |

## How to run

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. No build step and no install: `serve.ts` serves the `game/` folder as-is.

Deterministic screenshot scenes are staged from URL parameters, e.g. `http://localhost:8080/?shot=chase&seed=1` (shots: `title`, `drive`, `chase`, `mission`).

## Source structure

```
game/
  index.html        canvas container, HUD DOM, title/pause/stats overlays
  vendor/three.min.js  vendored Three.js r128 (UMD build, MIT licence header in file)
  src/
    config.js       constants, district list, tuning
    random.js       seeded RNG (mulberry32)
    state.js        shared mutable game state
    city.js         city generation: roads, districts, instanced buildings/palms, beach + ocean, markers
    traffic.js      pooled AI traffic + parked cars to steal
    pedestrians.js  pooled sidewalk walkers who flee danger
    player.js       on-foot controller + third-person camera
    driving.js      car entry/theft, arcade driving physics, chase camera, damage
    police.js       wanted stars, chase AI, line-of-sight decay, bust meter, helicopter
    combat.js       punches and the pistol
    missions.js     story missions, dialogue, street race, taxi fares
    hud.js          HUD DOM + 2D-canvas minimap
    audio.js        WebAudio synth sound effects
    save.js         localStorage save slot + stats persistence
    shots.js        deterministic ?shot= staging for screenshots
    main.js         boot, state machine (title/playing/paused/stats), game loop
main.ts             hands the entry in (copies game/ + screenshots/, writes dossier.json)
serve.ts            tiny local static server for game/
screenshots/        the four entry screenshots listed in shots.json
```

## Licence

The game code in this repository is original work for the make.fun gta6-01 bounty. Three.js is vendored under its MIT licence (see the header of `game/vendor/three.min.js`).
