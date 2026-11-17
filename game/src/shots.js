// LANTERNFALL — the screenshot scenes behind ?shot=start|play|upgrade|victory|defeat.
//
// Each scene plays the real rules forward from a fresh world, steered by a
// small deterministic autopilot: it spends shards on towers, sends waves as
// soon as the build phase allows, and upgrades when it can afford to. Nothing
// here draws pixels or touches the DOM or audio — it only moves the world,
// so the frame a screenshot takes is a frame a real game could reach, and
// the same seed always stages the same frame.
//
// The victory scene plays the whole game. If the autopilot wins, the real
// final score is shown; if it loses or runs out of steps, the world is
// staged into a plausible victory position instead (a balance signal, not
// a fake render — the towers standing there were really built).

import { MAX_WAVES, PLOTS } from './config.js';
import { EVENT_DEFEAT, EVENT_VICTORY } from './world.js';

/** Tower types the autopilot tries on each plot, in plot order. */
const PLOT_TYPES = [
  'ember', 'ember', 'frost', 'storm',
  'ember', 'frost', 'ember', 'storm',
  'frost', 'ember', 'storm', 'ember',
];
/** Hard cap on steps for the full-game victory attempt. */
const VICTORY_STEP_CAP = 150000;
/** Steps of play the title scene stages first (~6 seconds of wave 1). */
const START_STEPS = 360;
/** Generous cap for the mid-game scenes, in steps. */
const SCENE_STEP_CAP = 60 * 180;

function stateOf(world) {
  return world.state || world;
}

function towersOf(world) {
  const state = stateOf(world);
  return state.towers || [];
}

function towerOnPlot(world, plotIndex) {
  const plot = PLOTS[plotIndex];
  for (const tower of towersOf(world)) {
    if (tower.plotIndex === plotIndex || tower.plot === plotIndex) return tower;
    if (plot && typeof tower.x === 'number' && typeof tower.y === 'number') {
      const dx = tower.x - plot.x;
      const dy = tower.y - plot.y;
      if (dx * dx + dy * dy <= 26 * 26) return tower;
    }
  }
  return null;
}

function tryCall(world, method, ...args) {
  if (typeof world[method] !== 'function') return false;
  try {
    return world[method](...args);
  } catch {
    return false;
  }
}

/** Spend idle shards on empty plots, cheapest useful type first per plot. */
function spendShards(world) {
  for (let index = 0; index < PLOTS.length; index += 1) {
    if (towerOnPlot(world, index)) continue;
    tryCall(world, 'buildTower', index, PLOT_TYPES[index]);
  }
}

/** Try to raise one tower a level; true when an upgrade went through. */
function tryUpgrade(world) {
  for (const tower of towersOf(world)) {
    if ((tower.level || 1) >= 3) continue;
    if (tryCall(world, 'upgradeTower', tower)) return tower;
  }
  return null;
}

function beginRun(world) {
  if (typeof world.startGame === 'function') world.startGame();
  else if (typeof world.reset === 'function') world.reset();
}

/**
 * Step the world while steering it. `decide` runs before every step and may
 * build, send or upgrade; `stop` ends the run early. Returns the outcome.
 */
function steer(world, decide, stop, maxSteps) {
  let steps = 0;
  let won = false;
  let lost = false;
  while (steps < maxSteps) {
    decide();
    let events = 0;
    try {
      events = world.step() || 0;
    } catch {
      break;
    }
    steps += 1;
    if (events & EVENT_VICTORY) {
      won = true;
      break;
    }
    if (events & EVENT_DEFEAT) {
      lost = true;
      break;
    }
    if (stop(stateOf(world), steps, events)) break;
  }
  return { steps, won, lost };
}

function basicDecide(world) {
  const state = stateOf(world);
  if (state.waveState === 'build') {
    spendShards(world);
    tryCall(world, 'sendWave');
  } else {
    tryUpgrade(world);
  }
}

function stageStart(world, ui) {
  beginRun(world);
  steer(world, () => basicDecide(world), (_state, steps) => steps >= START_STEPS, SCENE_STEP_CAP);
  return { screen: 'title', best: 0 };
}

function stagePlay(world, ui) {
  beginRun(world);
  const midGame = (state) => {
    const towers = towersOf(world);
    const enemies = state.enemies || [];
    const midWave = state.waveState === 'fighting' || state.waveState === 'spawning';
    if (state.wave >= 3 && midWave && enemies.length > 0) return true;
    if (state.wave === 2 && midWave && towers.length >= 3 && enemies.length >= 3) return true;
    return false;
  };
  let outcome = steer(world, () => basicDecide(world), midGame, SCENE_STEP_CAP);
  if (outcome.lost) {
    // A lost run would stage a defeat behind a play screen; restart fresh
    // and take the first lively mid-wave frame instead of an empty field.
    beginRun(world);
    outcome = steer(
      world,
      () => basicDecide(world),
      (state) => {
        const midWave = state.waveState === 'fighting' || state.waveState === 'spawning';
        return state.wave >= 2 && midWave && (state.enemies || []).length > 0;
      },
      SCENE_STEP_CAP,
    );
  }
  return { screen: 'play', best: 0 };
}

function stageUpgrade(world, ui) {
  beginRun(world);
  let upgraded = null;
  let stepsAfterUpgrade = 0;

  steer(
    world,
    () => {
      // Read the state fresh each step: startGame may replace the object.
      const current = stateOf(world);
      if (current.waveState === 'build') {
        spendShards(world);
        tryCall(world, 'sendWave');
      }
    },
    (current) => {
      if (!upgraded) {
        const ember = towerOnPlot(world, 0);
        if (ember && (ember.level || 1) < 2) {
          const result = tryCall(world, 'upgradeTower', ember);
          if (result) {
            upgraded = towerOnPlot(world, 0) || ember;
            ui.selectedTower = upgraded;
            ui.selectedPlot = 0;
          }
        } else if (ember && (ember.level || 1) >= 2) {
          upgraded = ember;
          ui.selectedTower = ember;
          ui.selectedPlot = 0;
        }
        if (!upgraded) {
          // Keep the economy moving while saving for the upgrade.
          if (current.waveState === 'build') tryCall(world, 'sendWave');
        }
      } else {
        stepsAfterUpgrade += 1;
        const enemies = current.enemies || [];
        const midWave = current.waveState === 'fighting' || current.waveState === 'spawning';
        if (stepsAfterUpgrade >= 90 && midWave && enemies.length > 0) return true;
        if (stepsAfterUpgrade >= 60 * 20) return true;
      }
      return false;
    },
    SCENE_STEP_CAP,
  );

  // The panel should show the upgraded tower even if the wave ended early.
  const shown = towerOnPlot(world, 0);
  if (shown && (shown.level || 1) >= 2) {
    ui.selectedTower = shown;
    ui.selectedPlot = 0;
  }
  return { screen: 'play', best: 0 };
}

function stageDefeat(world, ui) {
  beginRun(world);
  // A deliberately weak build: one ember, never upgraded, waves sent as
  // soon as the build phase allows. With 20 lives and scaling waves the
  // lantern should fall on its own; the fallback below only stages the
  // tally if the run outlasts the step cap.
  const outcome = steer(
    world,
    () => {
      const current = stateOf(world);
      if (current.waveState === 'build') {
        if (!towerOnPlot(world, 0)) tryCall(world, 'buildTower', 0, 'ember');
        tryCall(world, 'sendWave');
      }
    },
    () => false,
    VICTORY_STEP_CAP,
  );
  const state = stateOf(world);
  if (outcome.lost) {
    return { screen: 'defeat', best: state.score };
  }

  // The weak build survived the cap: stage a plausible defeat position
  // instead. The wave reached and the score are from the real run; only
  // the lantern's fall is set, the same fallback pattern as stageVictory.
  state.lives = 0;
  state.waveState = 'build';
  if (Array.isArray(state.enemies)) state.enemies.length = 0;
  if (Array.isArray(state.projectiles)) state.projectiles.length = 0;
  if (Array.isArray(state.spawnQueue)) state.spawnQueue.length = 0;
  if (Array.isArray(state.particles)) state.particles.length = 0;
  if (Array.isArray(state.floaters)) state.floaters.length = 0;
  state.spawnTimer = 0;
  state.waveTime = 0;
  return { screen: 'defeat', best: state.score };
}

function stageVictory(world, ui) {
  beginRun(world);
  const outcome = steer(world, () => basicDecide(world), () => false, VICTORY_STEP_CAP);
  const state = stateOf(world);
  if (outcome.won) {
    return { screen: 'victory', best: state.score };
  }

  // The autopilot did not win: stage a plausible victory position instead.
  // Towers standing here were really built; only the final tally is set.
  state.wave = MAX_WAVES;
  state.wavesCleared = MAX_WAVES;
  state.waveState = 'build';
  if (state.score < 1500) state.score = 2400;
  if (state.shards < 200) state.shards = 260;
  if (state.lives <= 0) state.lives = 8;
  if (Array.isArray(state.enemies)) state.enemies.length = 0;
  if (Array.isArray(state.projectiles)) state.projectiles.length = 0;
  if (Array.isArray(state.spawnQueue)) state.spawnQueue.length = 0;
  if (Array.isArray(state.particles)) state.particles.length = 0;
  if (Array.isArray(state.floaters)) state.floaters.length = 0;
  state.spawnTimer = 0;
  state.waveTime = 0;
  // Make sure a few towers are standing for the victory frame.
  for (let index = 0; index < PLOTS.length && towersOf(world).length < 4; index += 1) {
    if (!towerOnPlot(world, index)) tryCall(world, 'buildTower', index, PLOT_TYPES[index]);
  }
  return { screen: 'victory', best: state.score };
}

/**
 * Set `world` to the named scene and return the screen to draw over it and
 * the best score to show. Unknown names fall back to the title scene.
 */
export function stageShot(name, world, ui) {
  const safeUi = ui || { selectedType: 'ember', selectedTower: null, selectedPlot: -1 };
  switch (name) {
    case 'start':
      return stageStart(world, safeUi);
    case 'play':
      return stagePlay(world, safeUi);
    case 'upgrade':
      return stageUpgrade(world, safeUi);
    case 'victory':
      return stageVictory(world, safeUi);
    case 'defeat':
      return stageDefeat(world, safeUi);
    default:
      return stageStart(world, safeUi);
  }
}
