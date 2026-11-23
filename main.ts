// Palm Cove — my gta6-01 entry: a low-poly 3D open-world crime game that runs in the
// browser. The game itself lives in this directory's game/ folder as plain static files
// (game/index.html, its ES modules under game/src/, and a vendored copy of Three.js under
// game/vendor/), so it loads fully offline with no network request at runtime. This program
// hands the entry in: it copies game/ and screenshots/ from beside this file to /output and
// writes /output/dossier.json, the summary the judge reads, with the vendored make.fun
// library. In Palm Cove you play courier Vera Solano, working off a debt to fixer Lucia
// Marrero across five named districts — stealing cars, running packages, collecting debts
// and outrunning a 0-to-5-star wanted system with police cars and a spotlight helicopter.
// The game's chrome is owned by a tiny overlay state machine in game/src/main.js
// (showOverlay/enforceChrome): exactly one full-screen overlay — or none — is visible
// at any time, and the HUD and touch controls follow G.mode, so the title menu, the
// character-choice screen and the joystick can never stack. Touch drags on the canvas
// orbit the camera through the same orbitCamera() path as the mouse. Before copying,
// this program runs a boot-contract preflight on game/index.html (see below) so the
// overlay stacking bug cannot regress silently.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Boot-contract preflight: the title menu and the character-choice overlay must start
// in exactly the state the boot state machine in game/src/main.js expects — the menu
// shown, every other overlay (choice included) display:none from the first paint.
// A past build shipped with #choiceMenu missing from the display:none CSS group, so
// the title menu and the choice screen stacked on first load; this guard keeps that
// bug from regressing silently.
{
  const html = readFileSync(join(here, 'game', 'index.html'), 'utf8');
  if (!html.includes('id="choiceMenu"')) {
    throw new Error('Palm Cove boot contract: game/index.html has no id="choiceMenu" element — the overlay state machine in game/src/main.js registers it and would have nothing to show.');
  }
  const groupLine = html.split('\n').find((line) => line.includes('#pauseMenu') && line.includes('display:none'));
  if (!groupLine || !groupLine.includes('#choiceMenu')) {
    throw new Error('Palm Cove boot contract: #choiceMenu is not in the display:none overlay CSS group (the rule containing #pauseMenu) in game/index.html — the choice overlay would be visible over the title menu at first load.');
  }
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
