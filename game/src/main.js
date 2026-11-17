// LANTERNFALL — boot, screens and the fixed-step loop.
//
// The entry point wires the pieces together and owns nothing else: the world
// holds the rules, the renderer holds the pixels, the audio holds the synth,
// the input holds the listeners. This file parses ?seed= / ?shot=, runs the
// requestAnimationFrame loop in fixed 1/60 s steps, routes clicks and keys to
// the world, turns world event flags into sounds, and keeps the best score
// and the accessibility status line up to date.
//
// ?shot=start|play|upgrade|victory stages one screenshot scene instead of
// running the loop: it paints twice and sets window.__shotReady.

import { BEST_KEY, MAX_WAVES, PLOTS } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld,
  EVENT_BUILD,
  EVENT_DEFEAT,
  EVENT_HORN,
  EVENT_KILL,
  EVENT_LEAK,
  EVENT_SELL,
  EVENT_SHOOT,
  EVENT_UPGRADE,
  EVENT_VICTORY,
  EVENT_WAVE_CLEAR,
} from './world.js';
import {
  createRenderer,
  getButtons,
  pointInRect,
  towerCardRect,
  SCREEN_OVER,
  SCREEN_PAUSED,
  SCREEN_PLAY,
  SCREEN_TITLE,
  SCREEN_VICTORY,
} from './render.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { stageShot } from './shots.js';

/** One simulation step, in seconds. */
const STEP = 1 / 60;
/** Longest frame the loop catches up on; a longer stall is dropped, not replayed. */
const MAX_FRAME = 0.25;
/** How long auto-send waits in the build phase before sending the next wave. */
const AUTO_SEND_DELAY = 1.5;
/** Click radius around a plot centre, in field pixels. */
const PLOT_RADIUS = 26;
/** Tower types in the same order as the three cards in the bottom bar. */
const TOWER_TYPES = ['ember', 'frost', 'storm'];

const params = new URLSearchParams(window.location.search);
const seedText = params.get('seed');
const parsedSeed = seedText === null || seedText === '' ? NaN : Number.parseInt(seedText, 10);
// The one place Math.random may appear: picking a seed when none was given.
// Everything inside the game itself runs on the seeded RNG.
const seed = Number.isInteger(parsedSeed)
  ? parsedSeed >>> 0
  : Math.floor(Math.random() * 4294967296);
const shotName = params.get('shot');

const canvas = document.getElementById('game');
const statusLine = document.getElementById('status');
const random = createRandom(seed);
const world = createWorld(random);
// The world object carries its state on .state; fall back to the object itself.
const state = world.state || world;
const renderer = createRenderer(canvas);
const audio = createAudio();

const ui = {
  selectedType: 'ember',
  selectedTower: null,
  selectedPlot: -1,
  hover: null,
  muted: false,
  autoSend: false,
};

let screen = SCREEN_TITLE;
let best = readBest();
let autoSendTimer = 0;
let lastStatusText = '';
ui.muted = audio.isMuted();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be unavailable (private windows): the best then lasts this visit only.
  }
}

function clearSelection() {
  ui.selectedTower = null;
  ui.selectedPlot = -1;
}

function startRun() {
  audio.ensure();
  world.startGame();
  clearSelection();
  ui.selectedType = 'ember';
  autoSendTimer = 0;
  screen = SCREEN_PLAY;
  updateStatus(true);
}

function finishRun(won) {
  screen = won ? SCREEN_VICTORY : SCREEN_OVER;
  if (state.score > best) {
    best = state.score;
    saveBest(best);
  }
  updateStatus(true);
}

function towerAtPlot(plotIndex) {
  const towers = state.towers || [];
  const plot = PLOTS[plotIndex];
  for (const tower of towers) {
    if (tower.plotIndex === plotIndex || tower.plot === plotIndex) return tower;
    if (plot && typeof tower.x === 'number' && typeof tower.y === 'number') {
      const dx = tower.x - plot.x;
      const dy = tower.y - plot.y;
      if (dx * dx + dy * dy <= PLOT_RADIUS * PLOT_RADIUS) return tower;
    }
  }
  return null;
}

function plotIndexAt(x, y) {
  for (let index = 0; index < PLOTS.length; index += 1) {
    const plot = PLOTS[index];
    const dx = x - plot.x;
    const dy = y - plot.y;
    if (dx * dx + dy * dy <= PLOT_RADIUS * PLOT_RADIUS) return index;
  }
  return -1;
}

function selectTower(tower, plotIndex) {
  ui.selectedTower = tower;
  ui.selectedPlot = plotIndex;
}

function handleButton(id) {
  switch (id) {
    case 'start':
      startRun();
      return true;
    case 'send-wave':
      if (screen === SCREEN_PLAY) {
        if (world.sendWave()) audio.horn();
        autoSendTimer = 0;
      }
      return true;
    case 'pause':
      if (screen === SCREEN_PLAY) screen = SCREEN_PAUSED;
      return true;
    case 'resume':
      if (screen === SCREEN_PAUSED) screen = SCREEN_PLAY;
      return true;
    case 'restart':
    case 'again':
    case 'play-again':
    case 'try-again':
      startRun();
      return true;
    case 'upgrade':
      if (ui.selectedTower) {
        const plotIndex = ui.selectedPlot;
        if (world.upgradeTower(ui.selectedTower)) {
          audio.click();
          // The world may replace the tower object on upgrade; re-select
          // the tower standing on the same plot so the panel stays live.
          if (plotIndex >= 0) {
            const refreshed = towerAtPlot(plotIndex);
            if (refreshed) selectTower(refreshed, plotIndex);
          }
        }
      }
      return true;
    case 'sell':
      if (ui.selectedTower) {
        if (world.sellTower(ui.selectedTower)) audio.click();
        clearSelection();
      }
      return true;
    case 'autosend':
    case 'auto-send':
      ui.autoSend = !ui.autoSend;
      // Keep the world's own auto-send countdown in step with the toggle.
      state.autoSend = ui.autoSend;
      audio.click();
      return true;
    case 'mute':
      ui.muted = audio.toggleMute();
      return true;
    default:
      return false;
  }
}

function onClick(x, y) {
  audio.ensure();
  // Buttons first: they sit above the field.
  const buttons = getButtons(screen, state, ui) || [];
  for (const button of buttons) {
    if (button.enabled === false) continue;
    if (pointInRect(x, y, button)) {
      handleButton(button.id);
      updateStatus(true);
      return;
    }
  }
  if (screen !== SCREEN_PLAY && screen !== SCREEN_PAUSED) return;
  // Tower cards in the bottom bar pick the type to build.
  for (let index = 0; index < TOWER_TYPES.length; index += 1) {
    const rect = towerCardRect(index);
    if (rect && pointInRect(x, y, rect)) {
      ui.selectedType = TOWER_TYPES[index];
      clearSelection();
      audio.click();
      return;
    }
  }
  // Plots and the towers standing on them share the same centres.
  const plotIndex = plotIndexAt(x, y);
  if (plotIndex === -1) return;
  const tower = towerAtPlot(plotIndex);
  if (tower) {
    selectTower(tower, plotIndex);
    audio.click();
    return;
  }
  if (screen !== SCREEN_PLAY) return;
  if (world.buildTower(plotIndex, ui.selectedType)) {
    audio.click();
    selectTower(towerAtPlot(plotIndex), plotIndex);
  }
}

function onHover(x, y) {
  ui.hover = { x, y };
}

function onKey(action) {
  audio.ensure();
  switch (action) {
    case 'select-ember':
      ui.selectedType = 'ember';
      clearSelection();
      break;
    case 'select-frost':
      ui.selectedType = 'frost';
      clearSelection();
      break;
    case 'select-storm':
      ui.selectedType = 'storm';
      clearSelection();
      break;
    case 'pause':
      if (screen === SCREEN_PLAY) screen = SCREEN_PAUSED;
      else if (screen === SCREEN_PAUSED) screen = SCREEN_PLAY;
      break;
    case 'deselect':
      clearSelection();
      break;
    case 'send-wave':
      if (screen === SCREEN_PLAY) {
        if (world.sendWave()) audio.horn();
        autoSendTimer = 0;
      } else if (screen === SCREEN_TITLE || screen === SCREEN_VICTORY || screen === SCREEN_OVER) {
        // Enter also starts / restarts: input.js sends 'send-wave' for Enter.
        startRun();
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
      }
      break;
    case 'mute':
      ui.muted = audio.toggleMute();
      break;
    case 'restart':
      if (screen === SCREEN_VICTORY || screen === SCREEN_OVER || screen === SCREEN_PAUSED) {
        startRun();
      }
      break;
    case 'confirm':
      if (screen === SCREEN_TITLE) startRun();
      else if (screen === SCREEN_VICTORY || screen === SCREEN_OVER) startRun();
      else if (screen === SCREEN_PLAY) {
        world.sendWave();
        autoSendTimer = 0;
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
      }
      break;
    default:
      break;
  }
  updateStatus(true);
}

createInput(canvas, { onClick, onHover, onKey });

function playEvents(events) {
  if (!events) return;
  if (events & EVENT_SHOOT) audio.shoot();
  if (events & EVENT_KILL) audio.kill();
  if (events & EVENT_HORN) audio.horn();
  if (events & EVENT_LEAK) audio.leak();
  if (events & EVENT_WAVE_CLEAR) audio.coin();
  if (events & EVENT_BUILD) audio.click();
  if (events & EVENT_UPGRADE) audio.click();
  if (events & EVENT_SELL) audio.click();
  if (events & EVENT_VICTORY) {
    audio.victory();
    finishRun(true);
  } else if (events & EVENT_DEFEAT) {
    audio.defeat();
    finishRun(false);
  }
}

function updateStatus(force) {
  if (!statusLine) return;
  const text = `Wave ${state.wave} of ${MAX_WAVES}. ${state.shards} shards. `
    + `${state.lives} lantern lives. Score ${state.score}. Best ${best}.`;
  if (force || text !== lastStatusText) {
    lastStatusText = text;
    statusLine.textContent = text;
  }
}

function runLoop() {
  let last = 0;
  let accumulator = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    let frameSeconds = (now - last) / 1000;
    last = now;
    if (frameSeconds > MAX_FRAME) frameSeconds = MAX_FRAME;
    if (frameSeconds < 0) frameSeconds = 0;

    if (screen === SCREEN_PLAY) {
      accumulator += frameSeconds;
      let stepsThisFrame = 0;
      while (accumulator >= STEP && stepsThisFrame < 20 && screen === SCREEN_PLAY) {
        accumulator -= STEP;
        stepsThisFrame += 1;
        playEvents(world.step() || 0);
      }
      if (stepsThisFrame >= 20) accumulator = 0;
      // Safety net if a flag was missed: the run is over either way.
      if (screen === SCREEN_PLAY && state.lives <= 0) finishRun(false);
      else if (screen === SCREEN_PLAY && state.wavesCleared >= MAX_WAVES) finishRun(true);

      // Auto-send: in the build phase, wait out the delay, then send.
      if (screen === SCREEN_PLAY && state.waveState === 'build' && ui.autoSend) {
        autoSendTimer += frameSeconds;
        if (autoSendTimer >= AUTO_SEND_DELAY) {
          if (world.sendWave()) audio.horn();
          autoSendTimer = 0;
        }
      } else {
        autoSendTimer = 0;
      }
    } else {
      accumulator = 0;
    }

    renderer.draw(state, ui, screen, best);
    updateStatus(false);
  }

  // A hidden tab pauses a running game instead of letting waves pass unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      updateStatus(true);
    }
  });

  requestAnimationFrame(frame);
}

if (shotName) {
  // Screenshot mode: stage the scene, paint it twice, signal readiness.
  // The game loop never starts here.
  const staged = stageShot(shotName, world, ui);
  screen = staged.screen || SCREEN_TITLE;
  const shotBest = Math.max(best, staged.best || 0);
  updateStatus(true);
  let painted = 0;
  function paintShot() {
    renderer.draw(state, ui, screen, shotBest);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paintShot);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paintShot);
} else {
  runLoop();
}
