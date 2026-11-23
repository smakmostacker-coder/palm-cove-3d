# Palm Cove

[![gta6-01 bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/smakmostacker-coder/palm-cove-3d/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/smakmostacker-coder/palm-cove-3d/reward.svg)](https://make.fun/bounty/gta6-01)

Bounty page: https://make.fun/bounty/gta6-01

A stylized **low-poly 3D open-world crime game** in the browser, set on a **long Florida peninsula at dusk** — sunset-gradient sky, warm low sun, neon waking up over pastel facades. Built with a vendored copy of Three.js (r128) that loads locally; nothing is fetched over the network at runtime, and every texture is generated on a canvas at boot (no external images).

## What's new in this round

- **Palm Boulevard rebuilt**: buildings now *front* the boulevard instead of backing onto it, with **Palm Plaza**, a **diagonal avenue**, and a **coastal promenade** along the water. **CLUB NEON PALMS** headlines the strip, and the facility storefronts — mart, pharmacy, gun shop, bank, jeweller, restaurant — carry proper signs and **working doors** you walk through.
- **A built-in radio**: three synth stations, cycled with **K** or the touch **RADIO** button, pausable, with its own volume in Settings. The car is no longer silent.
- **Touch, finished**: drag anywhere to **orbit the camera** on touch as well as mouse, plus a proper **analog joystick** — and the **minimap now sits at the top** of the screen where your eyes already are.
- **Police with feet and eyes**: officers now pursue **on foot** as well as in cars, and wanted stars are **witness-based** — a crime nobody saw doesn't raise your heat; break line of sight and stay unseen and it cools.
- **Carjacking, properly**: occupied vehicles — traffic, parked-with-driver, **even police cars** — can be jacked; the driver is pulled out and reacts like a person whose car was just stolen.
- **The flyover is solid**: the Palm Flyover deck is a real surface end to end — you drive *on* it, not through it.

## Round 4

- **Only the police report a car-taking**: stealing or jacking a car raises your heat only if a police officer actually sees it (sight range 26 units). Civilians — including the driver you just pulled out of the car — never report it, so an unwitnessed theft stays clean. Taking a police car, emergency vehicles and mission chases are unchanged: those still bring the heat exactly as before.
- **Driving gets an orbit camera too**: drag to orbit while driving, through the same path as on foot, and the drag direction is corrected everywhere — drag left and the view turns left (touch and mouse, on foot and driving).
- **Maps drawn from the real placed world**: the minimap and the full map are no longer sketches — they are rendered from the world's actual placed data: the land silhouette, Lake Okeechobee, the marsh channels, every road, every building footprint, and the prison marker. The minimap is also **tappable**: tap it to open the full map (and closing returns you to where you were, game or pause menu).
- **Officers stop at arm's length**: chasing officers now stop at a 1.4-unit stop distance instead of piling onto you, and pedestrians keep proper separation from each other.
- **The lightbar, rebuilt**: police lightbars are now a dark base bar carrying distinct red and blue lenses, instead of the old glowing blob.
- **The black-building fix**: town buildings on the instanced mesh now carry per-instance tints, so no town block renders pitch black — 118 at-risk instances before the fix, 0 after.
- **Swimming**: walk into the sea and you swim — 4.5 units/s, 6 with sprint — with the world bound set 240 units offshore, so you can swim out, turn around, and wade back onto the sand.

## Story

Courier **Vera Solano** — or her partner **Dario "Dax" Vega**, your choice at New Game — owes a debt to fixer **Lucia Marrero** in the coastal city of Palm Cove. A New Game **wakes the chosen lead up in their own bed** at home in Coral Heights; Lucia's first message and the first mission marker only arrive once you step outside. Work the debt off across four story missions, and *how* you work decides the ending: debtors spared or taken out, money earned, busts on your record and side work all feed **six branching endings** — from *Clean Getaway* to *Kingpin of the Cove* to *Queen of the Ashes*. The finale is replayable from the pause menu, and unlocked endings are recorded in your save and stats.

## The world — a real peninsula, not a diorama

- **Scale**: the landmass runs about **4,720 units** from the Southernmost Point buoy in the Keys (z +442) to the far panhandle shore (z −4,280). The city is only the southern tip: from Palm Cove, the **peninsula highway** runs north through the Everglades marsh, past Lake Okeechobee and a chain of named roadside towns (Palmetto Flats, Cypress Junction, Kissimmee Prairie, Suwannee Crossing, Panhandle Gate) to Tallahassee Palms. At normal car speed the tip-to-far-shore drive takes **minutes**. Every edge of the world is a shoreline — you run out of land into the sea, never into an invisible wall near spawn.
- **A deliberate city**: a packed downtown core with the tallest glass towers, the **Ocean Drive deco strip** and marina on the east beach, the container **port** at The Docks, low residential sprawl in Coral Heights, brick Old Town, and the palm boulevards of the Palm District. Roughly **double the buildings** of the first build — eight plots per block — each district reading differently and named live on the HUD, as are landmarks (Marlin Point Lighthouse, Glades Airboat Dock, the Cape Marlin gantry across the bay, and every region on the drive north).
- **Road structures**: the **Palm Flyover** carries a boulevard over a crossing road, the **Old Town Underpass** dips beneath another, both fully drivable, with working traffic lights (red/yellow/green cycles that traffic AI obeys), tree-lined sidewalks, and street lamps with lit heads and light pools at dusk.
- **Solid street furniture**: trees, lamp posts, traffic-light poles, sign posts, hydrants and palms have real collision — you walk around them, pedestrians step around them, and a car that hits one stops or glances off with damage. Nothing ghosts through a tree any more.
- **Facades with faces**: canvas-generated window grids (lit and unlit), ground-floor storefronts, neon signs and billboards for original Palm Cove brands (Cove Cola, Hotel Marlin, Neon Palms, Marlin Motors…).

## The people

- **Two playable leads with faces and hair**: Vera Solano (blonde ponytail tied with a pink band, pink tank top, ripped jeans) and Dax Vega (dark spiky hair, open floral shirt over a white tee, gold chain, pink trousers) — distinguishable by silhouette alone, with painted canvas faces (eyes, brows, mouth). Pedestrians get the same faces plus a rotation of hair styles and colours, so crowds are not clones. The unpicked lead stays in the story as an NPC partner at Lucia's garage.
- **Real locomotion**: articulated legs and arms on hip/shoulder pivots. Walking is a relaxed stride with counter-swinging arms; **sprinting (Shift, or hold the touch RUN button)** is a different gait — faster cycle, longer stride, hard arm pump, forward lean (walk 7 units/s, sprint 12). Standing still breathes: chest, head drift, weight shift. No stamina meter — sprinting is free, by design.

## Camera

Third-person, and it finally moves with you: **drag the mouse to orbit freely** at any time; while you move and leave the mouse alone, the camera **eases around behind your heading** as you turn (a lerp, never a snap). Driving keeps its chase camera.

## Interiors — walk in, walk out

- **Your home** in Coral Heights (marked **HOME** on the minimap and full map): bedroom (bed, wardrobe, lamp), bathroom (shower, toilet, sink, mirror), living room (sofa, TV), kitchen (counters, fridge, table). The **bed is a save point**: sleep saves the game and skips to morning.
- **Houses/apartments** in the residential districts, simply furnished.
- **Palm Kitchen** restaurant: sit-down tables inside, and a proper meal at the counter ($18, +50 HP).
- **Marlin & Co. Jewels**: glass display cases to browse — or **smash-and-grab** one for +$220 and +3 wanted stars, on the normal wanted/economy systems.
- **Cove Bank** lobby: counters, a vault door, and a **working ATM** (deposit/withdraw $50 against a vault balance).
- The menu facilities stay as they were: **Cove Mart** minimarket, **Apotik Sehat** pharmacy, **Marlin Arms** gun shop (**ammo only** — weapons are never sold), Solano Gas, plus the hospital and **Palm Cove Correctional** prison (serve the time, or pay bail with B).

## Gameplay

- **Five vehicle classes, all stealable**: cars, **motorcycles** (fast, nimble, rider visible), **trucks** (slow, heavy, hit harder), **police cars**, and **fire trucks** — with per-class handling and a stats breakdown by class. Traffic AI mixes city and highway traffic and stops at red lights.
- **Wanted system (0–5 stars)**: police chases, line-of-sight decay, a bust meter, and a spotlight helicopter at 4–5 stars. **BUSTED** means time inside Palm Cove Correctional; **WASTED** wakes you at the hospital for a small treatment fee.
- **Combat & the 5-slot hotbar**: you start with **nothing but fists**. The pistol, the **sniper rifle** (scoped zoom with right-mouse/V, long range, limited rounds), snacks, armour vests, medkits and ammo are all **found as world pickups** or bought. Slots 1–5 select, X uses consumables; a full hotbar honestly refuses new pickups.
- **Fire & damkar**: heavily damaged cars catch fire, burn, and explode (spreading damage and heat); stand too close and you burn too. Long-burning fires dispatch a **fire truck** that drives to the scene and sprays the flames out; burnt wrecks stay as charred props.
- **Quests, tracked freely**: the **quest log** (pause menu, or the QUESTS button on the HUD) separates the **MAIN QUEST** — Lucia's chain, in order, current step highlighted, finished steps ticked — from **SIDE QUESTS** (the Causeway Run race, taxi fares, and The Long Drive North to the far shore), each with its reward and a location hint. Tap any quest to **track** it: the HUD objective and the world marker switch instantly, one at a time, and the story waits while you wander. Completing a tracked side quest returns tracking to the main quest. Quest progress persists alongside the save.
- **A first-run tutorial**, woven into the wake-up: contextual prompts for moving, the camera, sprinting, interacting, the hotbar, stealing and driving a vehicle, and fighting — labelled for keyboard or touch, advancing only when you actually do each thing, skippable at any time, and never shown again once finished or skipped. The **Controls** screen (pause menu and Settings) lists every input for both.
- **Menu & settings**: NEW GAME / LOAD GAME (with save info) / SETTINGS on the title screen, and settings in the pause menu too — volume + mute, **30/60 FPS cap**, **Standard/HD graphics tiers**, brightness, and an optional **on-screen joystick** with E/F/X and hold-to-sprint RUN buttons. Settings persist in localStorage.
- **Sound**: a WebAudio synth (sirens, gunshots, the sniper's crack, explosions, fire-truck two-tone) driven by the settings volume. No audio files.

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move / drive (arrow keys also steer) |
| Mouse drag | Orbit camera (auto-follows behind you while moving) |
| Shift (hold) | Sprint on foot (touch: hold RUN) |
| E | Enter / exit a vehicle · enter a building · shop |
| F | Punch / lean on a debtor (spare) · use (bed, counter, ATM, jewel case) |
| Mouse click | Fire equipped weapon · shoot near a debtor (take out) |
| Right-mouse hold or V | Sniper scope |
| 1–5 | Select hotbar slot |
| X | Use selected consumable |
| R | Start the Causeway Run race (in a car, at the start) |
| T | Start taxi work (in a car) |
| B | Pay bail while in prison |
| K | Radio: next station / off (touch: RADIO button) |
| Esc or P | Pause / resume (quest log, map, stats, controls, settings, replay finale) |
| S (on title) | Stats screen |

## How to run

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. No build step and no install: `serve.ts` serves the `game/` folder as-is.

Deterministic screenshot scenes are staged from URL parameters, e.g. `http://localhost:8080/?shot=chase&seed=1` (shots: `title` = the title menu, `drive`, `chase`, `map`).

## Source structure

```
game/
  index.html        canvas container, HUD DOM, menus (title/choice/pause/quest log/controls/map/settings/shop/ending/stats), tutorial prompt
  vendor/three.min.js  vendored Three.js r128 (UMD build, MIT licence header in file)
  src/
    config.js       city layout, districts, vehicle handling, balance tuning
    random.js       seeded RNG (mulberry32)
    state.js        shared mutable game state (incl. story tracking for endings)
    settings.js     persisted settings: volume, FPS cap, graphics tier, brightness, joystick
    city.js         world generation: dusk sky, facades, districts, peninsula spine + towns, structures, Keys, marsh, landmarks, prop colliders, people + vehicle factories
    traffic.js      pooled mixed-class AI traffic (city + highway) + parked vehicles to steal
    pedestrians.js  pooled sidewalk + beach walkers with walk/flee cycles, who step around props
    player.js       on-foot controller (walk/sprint gaits), articulated posing, orbit + auto-follow camera
    driving.js      vehicle entry/theft, per-class arcade driving, prop/building impact damage
    police.js       wanted stars, chase AI, line-of-sight decay, bust meter, helicopter
    combat.js       punches, pistol, scoped sniper rifle
    fire.js         vehicle fires, explosions, charred wrecks, damkar fire-truck response
    inventory.js    5-slot hotbar: weapons + consumables, selection, use
    facilities.js   menu facilities, prison, and the walk-in interiors: home + wake-up, houses, restaurant, jewelry, bank
    missions.js     story missions, dialogue choices, six endings, race, taxi, quest log data + tracking
    hud.js          GTA-register HUD, hotbar, local minimap + Florida-silhouette full map (HOME marker)
    audio.js        WebAudio synth sound effects + the 3-station radio (settings-driven gains)
    save.js         localStorage save slot (progress, inventory, endings, character)
    shots.js        deterministic ?shot= staging for screenshots
    main.js         boot, state machine, game loop, tutorial, quest log + controls wiring, settings/joystick wiring
main.ts             hands the entry in (copies game/ + screenshots/, writes dossier.json)
serve.ts            tiny local static server for game/
screenshots/        the four entry screenshots listed in shots.json
```

## Performance discipline

Canvas textures only; instanced or pooled props throughout (buildings, palms, trees, lamps, lights, containers, structures, highway furniture); the big peninsula adds land planes and instanced town blocks, not per-object overhead; traffic and pedestrians stay pooled around the city; shadows off, fog on, fixed pools for traffic/pedestrians/police, and no per-frame allocations in the hot loop. The standard graphics tier keeps the build light; the HD settings tier raises pixel ratio and view distance for stronger machines.

## Licence

The game code in this repository is original work for the make.fun gta6-01 bounty. Three.js is vendored under its MIT licence (see the header of `game/vendor/three.min.js`).
