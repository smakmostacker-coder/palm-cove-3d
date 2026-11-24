# Palm Cove

A low-poly 3D open-world crime game on a sunlit Florida peninsula — steal cars, run jobs, outrun the law.

[![gta6-01 bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/smakmostacker-coder/palm-cove-3d/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/smakmostacker-coder/palm-cove-3d/reward.svg)](https://make.fun/bounty/gta6-01)

Bounty page: https://make.fun/bounty/gta6-01

## What is this

Palm Cove is a low-poly 3D open-world crime game that runs
entirely in a web browser, offline, from plain static files.
You play a driver-for-hire stranded in a coastal city, taking
work from a fixer while the local police learn your face.

## Features

- A Florida-shaped peninsula world to explore end to end
- One southern city, three highway towns and Key Solano island
- Walk, drive and swim anywhere the map lets you reach
- Steal parked vehicles and carjack traffic out on the road
- Police vehicles can be stolen too, if you are quick enough
- A witness-based wanted system: unseen crimes raise no heat
- Foot officers pursue on the ground and coordinate chases
- A police helicopter joins the hunt at high wanted levels
- Four story missions with dialogue, objectives and choices
- Story choices that settle into one of six different endings
- Repeatable side job: checkpoint street races against the clock
- Repeatable side job: taxi fares picked up across the city
- Repeatable side job: courier runs with fragile, timed cargo
- Repeatable side job: vigilante contracts on named targets
- Repeatable side job: repo and tow work on marked vehicles
- 17 enterable facilities, from diners to a bank and a hospital
- Shops inside those facilities sell supplies and services
- A 5-slot inventory that starts empty at the start of a run
- Weapons and useful items are found out in the world itself
- Procedural WebAudio radio with three stations, made in code
- A live minimap for the streets plus a full-screen map view
- Autosave keeps your progress, money, story state and ending

## The world

The peninsula is one continuous map: leave the southern city
by either highway and the towns arrive in order, each with
its own facilities, traffic and jobs. Bridges carry you out
to Key Solano, and the water between is swimmable throughout,
so a chase that reaches the shore does not have to end there.

## Story

A fixer named only in person offers you four jobs, and each
one can be finished more than one way. Who you help, who you
cross and how much heat you carry into the finale decide
which of the six endings you get: some leave Palm Cove rich,
some leave it in cuffs, and one leaves it as a ghost story.

## Police and witnesses

Crime only counts when somebody sees it. A witness who reaches
a phone, or an officer who sees the act directly, raises your
wanted level; break line of sight and stay unseen and the
search cools down again. Higher levels bring more officers,
faster cars and, at the top, the helicopter's searchlight.

## Controls

### Keyboard and mouse

- **WASD** — move on foot, or steer and drive in a vehicle
- **Mouse drag** — swing the camera around the character
- **F** — enter or exit the nearest vehicle
- **E** — interact: doors, counters, mission markers, pickups
- **X** — attack with whatever the inventory has equipped
- **K** — cycle the radio station, or switch it off
- **M** — open or close the full map

### Touch

- A virtual joystick moves the character or steers the car
- On-screen buttons cover entering vehicles and interacting
- An attack button appears whenever a weapon is equipped
- Dragging anywhere on the view swings the camera
- Map and radio buttons sit beside the minimap on the HUD

## Run it locally

The game is static files under `game/`; there is nothing to
install and nothing to build before it can be played.

Any static file server pointed at that folder works:

```sh
python3 -m http.server 8080 --directory game
```

Then open <http://localhost:8080> in a desktop browser.

Or use the server bundled with this repository instead:

```sh
node serve.ts
```

which serves the same folder at the same local address.

## Tech

- Three.js renders the world, vendored under `game/vendor/`
- Plain ES modules throughout the game's own source code
- No build step: the files in `game/` are the files that run
- No network requests: every asset loads from inside `game/`
- All sound, radio included, is synthesized with WebAudio

## Built for make.fun

Palm Cove was built for the gta6-01 "Make GTA 6" bounty on
make.fun: <https://make.fun/c/gta6-01>. Everything in it —
the city, the names, the story, the art and the sound — is
original work made for this entry; it uses no Rockstar
Games assets, names, characters, music or map material.

## License

MIT — see the `LICENSE` file in this repository.
