// Palm Cove — handover program for the make.fun gta6-01 entry.
//
// The playable game lives in game/ as plain static files. This program's
// only job is delivery: stage a copy of game/ and screenshots/ in the
// output directory, then ask the vendored library to summarise that
// staging area into dossier.json, which is what the judges receive.
//
// Local check, outside the grader's container:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// With no variable set, the output directory defaults to /output.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDossier } from './vendor/makefun-game.ts';

// Presentation facts for this entry. They describe the game shipped in
// game/; the dossier itself is derived from those files by buildDossier.
export const ENTRY_TITLE = 'Palm Cove';
export const ENTRY_GENRE = 'Low-poly 3D open-world crime game';
export const ENTRY_TAGS = ['open-world', 'driving', 'missions', 'three.js', 'offline'];

export const ENTRY_DESCRIPTION =
  'Palm Cove is a low-poly 3D open-world crime game set on a sunlit Florida ' +
  'peninsula, where you roam a southern city, three highway towns and the ' +
  'island of Key Solano on foot, by car or by swimming. Take jobs from a ' +
  'fixer, steal whatever vehicle is at hand, and try to stay ahead of a ' +
  'witness-based police system whose response grows with every crime it ' +
  'sees. Four story missions branch on your choices and settle into one ' +
  'of six different endings.';

export const ENTRY_HOW_TO_PLAY =
  'Move with WASD and drag the mouse to swing the camera. Press F to get ' +
  'into or out of a vehicle, E to interact, X to attack, K to cycle the ' +
  'radio and M to open the full map. On a phone or tablet, on-screen ' +
  'touch controls replace the keyboard and mouse.';

// Paths are anchored to this file, never to the caller's working
// directory, so the program behaves the same wherever it is launched.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const gameSource = join(repoRoot, 'game');
const shotsSource = join(repoRoot, 'screenshots');
const gameTarget = join(outputDir, 'game');
const shotsTarget = join(outputDir, 'screenshots');
const dossierTarget = join(outputDir, 'dossier.json');

// Stage the payload first: the dossier must describe exactly the files
// that were handed over, so it is built from the output copy, not from
// the repository originals.
mkdirSync(outputDir, { recursive: true });
cpSync(gameSource, gameTarget, { recursive: true });

mkdirSync(shotsTarget, { recursive: true });
if (existsSync(shotsSource)) {
  cpSync(shotsSource, shotsTarget, { recursive: true });
}

// Gate limits for this bounty, passed through unchanged so this program
// refuses anything the scorer would refuse: a bounded dossier text,
// at most four screenshots of at most 256 KiB each, and a game tree of
// at most 993 entries, 48 MiB in total, with no path over 1000 bytes.
const GATE_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const dossierBytes = buildDossier(outputDir, GATE_LIMITS);
writeFileSync(dossierTarget, dossierBytes);
