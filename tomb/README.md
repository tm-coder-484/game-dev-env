# Tomb of the Token

A Claude-themed slide maze in the style of *Tomb of the Mask*. Clawd slides until he hits a
wall, so every swipe is a commitment. Collect tokens, coins and three stars, and get past spikes,
spike traps, bugs, gates, turrets, puffers, snakes and chasing saws, bounce pads and seal blocks.
Reach the door before the **context window** fills the tomb from below. Every tomb is
**procedurally generated** and checked by a solver before you see it.

![Gameplay](../docs/images/tomb-gameplay.gif)

| Title | Stage map | World 2 (Blueprint) | World 3 (Sage) |
|---|---|---|---|
| ![Title](../docs/images/tomb-title.jpg) | ![Stages](../docs/images/tomb-stages.jpg) | ![Blueprint](../docs/images/tomb-blueprint.jpg) | ![Sage](../docs/images/tomb-sage.jpg) |
| **Generating a stage** | **Stage cleared** | | |
| ![Loading](../docs/images/tomb-loading.jpg) | ![Result](../docs/images/tomb-result.jpg) | | |

![Desktop, World 4 (Ivory, light mode)](../docs/images/tomb-desktop-ivory.jpg)

These screenshots and the GIF come from headless Chromium in the cloud sandbox (the GIF is the
autopilot playing stage 17).

## Play it

The build is a single 120 KB HTML file with everything inlined (code, pixel art, sound). It runs
offline, needs no server, and works on phones.

| | How |
|---|---|
| **Windows** | Double-click **`play-tomb.bat`** in the repo root. It builds the game on the first run (installing Node.js LTS with winget if you don't have it) and opens it in your browser. |
| **Linux / macOS** | **`./play-tomb.sh`** (needs Node.js 20+). |
| **Phone** | Turn on GitHub Pages (Settings → Pages → Source: GitHub Actions), run **Actions → deploy to pages**, and open `https://<you>.github.io/<repo>/tomb/`. On iPhone, *Share → Add to Home Screen* gives it a full-screen icon. |
| **No build** | Every push builds **`tomb-of-the-token`** in the **Actions** tab: download it, unzip, double-click the HTML file. |
| **Hacking on it** | `make tomb-dev` (hot reload on http://localhost:5174). |

Links: `#stage-12`, `#endless` and `#daily` jump straight into a stage or mode.

### Controls

| | |
|---|---|
| Slide | Swipe (an L-shaped swipe queues two slides), arrow keys, WASD, HJKL, or a gamepad d-pad/stick |
| Pause | Esc / P, the ⏸ button, or Start |
| Restart | R |
| Mute | M |
| Shield | Tap the shield button (bottom left) to protect Clawd for one hit |

## What's in the tomb

![Spike traps, seal blocks, bounce pads, a puffed-up puffer, a snake with turrets, and a saw on Clawd's trail](../docs/images/tomb-hazards.jpg)

| Thing | From stage | What it does |
|---|---|---|
| **Tokens** (dots) | 1 | Fill every corridor. Collecting them quickly plays a rising scale. |
| **Coins** (the ✻ spinner) | 1 | Spend them on skins and shields. |
| **Stars** (three per stage) | 1 | Your stage rating. They sit on detours. |
| **Exit door** | 1 | At the top of each stage. Its spark lights up once you hold all three stars. |
| **Spikes** | 2 | Only hurt if you *stop* on them. Sliding past is fine. |
| **Power-ups** | 3 | Shield (one hit), magnet (pulls in tokens and coins), pause (stops every hazard and the context window for 5 s). |
| **Bugs** | 4 | Patrol lanes that cross your corridors. Standing still is always safe. |
| **Context window** | 5 | Rises from below on some stages and in endless mode. Keep climbing. |
| **Spike traps** (striped blocks) | 6 | Fire spikes out of every side half a second after you move next to them. |
| **Gates** | 7 | Blink, then switch on. Slide through while the line is dotted. |
| **Seal blocks** (dotted squares) | 8 | Turn solid once you've passed over them, so the maze changes behind you. |
| **Bounce pads** | 10 | Turn your slide 90 degrees, from either side. |
| **Turrets** | 12 | Flash, then fire darts across the corridor about once a second. |
| **Puffers** | 14 | Solid blocks that shake, then puff up to cover the 3×3 around them. |
| **Saws** | 17 | Sleep in a wall until they see you, then copy your path, cutting the corner if you turn back. Lead them over a seal block to break them; they give up after 12 s. |
| **Snakes** | 18 | A wall flashes, then a snake bursts out and crosses the corridors to the far wall. |

These follow the original's behaviour as described on the fan wikis (spike traps fire ~0.5 s after
you move near them, fish cannons fire every ~1.1 s, fish balloon from 1×1 to 3×3, saws copy your
moves until they hit a sealed block, snakes burst through flashing walls).

**Modes:** endless **Stages** (five worlds of ten, cycling: Terminal, Blueprint, Sage, Ivory,
Kraft), an **Endless climb** that generates new rooms as you go and speeds the context window up the
higher you get, and a **Daily tomb** that is the same for everyone on a given date. Progress,
coins and skins are saved in the browser.

## How the levels are generated (`src/gen.ts`)

Clawd can't stop in open floor, so a level is really a **directed graph**: the nodes are the cells
where a slide can end, and each node has up to four edges (one per direction). The generator works on
that graph rather than on the picture.

1. **Spine.** A walker carves slides from the entrance to the exit door. It scores each candidate
   move: upward progress, zig-zag turns, and fresh rock rather than corridors pressed against
   existing ones. Each slide ends against a wall that is **locked**, so later carving can't erase
   the guaranteed solution.
2. **Growth.** Spurs (scored over every direction and length from a random stop), loops punched
   through thin walls, rooms and pillars are added one at a time. After each one the slide graph is
   rebuilt and the change is **rolled back** unless:
   - every stop you can reach can still reach the exit (no soft-locks, ever), and
   - the shortest solution hasn't collapsed (shortcuts may not make a stage trivial).

   Rooms are also rolled back if no slide can enter them. Floor that nothing can slide into goes
   back to rock at the end.
3. **Bounce pads** are part of the slide rules, so the graph follows them. A pad is kept only if
   some slide uses it, the level stays valid, and no slide bounces forever.
4. **Spikes** are placed on wall faces where some slide stops. A spike turns that move into a death
   move, so each one is only kept if the level is still solvable and soft-lock free *without* that
   move, and almost no corridor becomes unreachable.
5. **Stars** are chosen in order (bottom third, middle, top) along a route that is built as it goes.
   Each star is a detour from wherever the previous star left you, so **all three can always be
   collected in one run**. That route is saved with the level.
6. **Seal blocks** go on cells that route slides over. Sealing changes the maze as you play, so the
   check runs over every reachable **(position, sealed blocks)** state: every one of them must
   still reach the exit, no slide may stop on a seal, and the star route must still work with the
   blocks sealing behind it.
7. **Timed hazards** are fair by construction:
   - bugs, gates, dart lines and snakes never cover a cell where you can stand (in any sealed
     state), so standing still is safe from them;
   - bugs and snakes only patrol lanes that slides cross at right angles (a slide *along* their
     lane could never dodge them);
   - no single slide crosses two different timed hazards;
   - spike traps and puffers may reach a stop, but every way out of such a stop is hazard-free,
     so leaving straight away is always safe.
8. **Saws** are placed first. Each candidate is played against the star route at a careful human
   pace. It's kept only if the route stays ahead of it without ever crossing its own trail, until
   it crashes into a seal block or gives up. Nothing that would make you wait may sit along that
   escape.
9. **The context window** is timed against the star route, with reaction time and a budget for
   waiting at each kind of hazard, then given slack.
10. Several candidate layouts are generated per stage and the best is kept, scored on solution
    length, forks, stops per row and floor density. Generation is deterministic (stage *n* is the
    same everywhere) and takes about 30-200 ms.

Endless mode uses the same generator for 24-row chunks (with pads, traps, turrets, puffers and
snakes, but no seals or saws). Each chunk enters through a door in the row it shares with the
chunk below. Sliding back down through that door counts as returning to the chunk's entrance,
which is valid because the chunk below was itself verified to lead back up.

### How it's tested

- `npm test`: re-checks stages 1-200, three daily tombs and 3 × 40 endless chunks with an
  **independent** slide implementation (bounce pads and seals included). It checks that:
  - every reachable (position, sealed blocks) state can still reach the exit;
  - the saved route takes all three stars without dying, with blocks sealing behind it;
  - movers never cover a stop, and bugs and snakes are only ever crossed;
  - no slide crosses two hazards, and the ways out of puffer and spike-trap zones are clear;
  - every pickup is reachable, and generation is deterministic.
- `test/play.test.ts`: a **bot plays every stage from 1 to 200 through the real game rules** and
  must win each one with 3/3 stars. The rules include hazard timing, spike traps, puffers, darts,
  snakes, saws chasing it and the rising context window. Before each slide the bot looks ahead on
  a copy of every hazard, two slides deep next to puffers. A typical run survives about 370
  bounces, 720 seals closing, 780 spike traps firing, 2,700 dart volleys, 860 puffs, 210 snakes
  and 80+ saw chases. It also plays the daily tomb and three 4-minute endless runs. A one-off
  run over stages 1-400 passed too.
- `npm run e2e`: headless Chromium plays stage 1 of the built file with real **touch swipes**,
  **mouse drags** and **arrow keys**. It checks the result screen, that progress survives a
  reload, the pause menu and `/restart`, endless and daily, and that the page logs no errors.
- `scripts/shots.mjs`: screenshots of every screen at phone and desktop sizes.

`make tomb-test` runs the first two and `make tomb-e2e` builds and runs the browser test. CI runs
all of them on every push.

## The Claude theme

- **Palette** from Anthropic's brand guidelines: `#d97757` clay orange, `#141413` slate,
  `#faf9f5` ivory, `#b0aea5` grey, plus the blue `#6a9bcc` and green `#788c5d` accents. The five
  worlds are built from these, and *Ivory* is a light-mode tomb.
- **Clawd** is the 10×8 pixel mascot, drawn from code so he can squash and stretch. He flies feet
  first, lands on whichever wall he hits (ceiling and walls too), blinks, looks around, taps his
  feet when idle, and comes apart into his own pixels when he dies. Skins recolour him.
- **Spinner:** coins are Claude Code's `· ✢ ✳ ✶ ✻ ✽` spinner, and stage loading shows that
  spinner with its shimmer and real spinner verbs ("Combobulating…", "Flibbertigibbeting…"). The
  numbers shown while it spins are real: generation time, seed, stops, forks and hazards.
- **Terminal UI:** menus are Claude Code panels ("✻ Welcome to Tomb of the Token"), the pause menu
  is slash commands (`/resume`, `/restart`), and results use `⏺` and `⎿` trees.
- **The context window** is the rising flood: a page of text with an orange edge, a
  "context: 42% left" meter, and "Context limit reached" when it catches you.
- **Walls** carry carved code glyphs: `>_`, `{ }`, `✻`, `/`, `10`.

This is an unofficial fan game, not affiliated with Anthropic or with *Tomb of the Mask*
(Happymagenta). All art, sound and code here are original. Sound and music are synthesised with
WebAudio, and the music is a short loop generated per world.

## Files

| File | |
|---|---|
| `src/gen.ts` | Level generator, fairness checks, difficulty curve |
| `src/core.ts` | Shared constants: directions, bounce-pad deflection, slide motion |
| `src/hazards.ts` | Every hazard's behaviour as a function of the hazard clock (shared by game, generator and bot) |
| `src/sim.ts` | Game rules (no DOM): world, sliding, seals, pickups, hazards, flood, endless chunks, look-ahead |
| `src/bot.ts` | Autopilot for the title-screen demo and the play test |
| `src/render.ts` | Pixel renderer: cached wall bands, items, hazards, Clawd, particles, flood |
| `src/art.ts` | Palettes, Clawd, bitmaps, 5×7 font, skins |
| `src/audio.ts` | WebAudio sound effects and music |
| `src/input.ts` | Swipes, keys, gamepads |
| `src/main.ts`, `src/style.css`, `index.html` | Screens, HUD, menus and the main loop |
| `scripts/single-file.mjs` | Inlines the Vite build into `dist/tomb-of-the-token.html` |
| `scripts/e2e.mjs`, `scripts/shots.mjs` | Browser test and screenshots |
| `test/` | Generator invariants and the bot play test |
