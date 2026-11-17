// LANTERNFALL — world state and the fixed-step simulation.
// Pure logic: no DOM, no audio, no canvas, no wall clock, no unseeded RNG.
// Every step advances exactly STEP seconds; step() returns a bitmask of the
// events that happened (EVENT_KILL, EVENT_LEAK, ...), which main.js turns
// into sound, shake and screen changes. All randomness flows through the
// seeded random object handed to createWorld.

import {
  STEP,
  PATH_POINTS,
  PLOTS,
  LANTERN,
  START_SHARDS,
  START_LIVES,
  MAX_WAVES,
} from './config.js';
import { createTower, upgradeCost, sellValue, towerCost, updateTowers, applyDamage } from './towers.js';
import { createEnemy, moveEnemy } from './enemies.js';
import { waveSpec } from './waves.js';

export const EVENT_KILL = 1;
export const EVENT_LEAK = 2;
export const EVENT_WAVE_CLEAR = 4;
export const EVENT_VICTORY = 8;
export const EVENT_DEFEAT = 16;
export const EVENT_SHOOT = 32;
export const EVENT_BUILD = 64;
export const EVENT_UPGRADE = 128;
export const EVENT_SELL = 256;
export const EVENT_HORN = 512;

function freshState() {
  return {
    shards: START_SHARDS,
    lives: START_LIVES,
    score: 0,
    wave: 0,
    waveState: 'build',
    towers: [],
    enemies: [],
    projectiles: [],
    particles: [],
    floaters: [],
    spawnQueue: [],
    spawnTimer: 0,
    waveTime: 0,
    kills: 0,
    shardsEarned: 0,
    wavesCleared: 0,
    selectedPlot: -1,
    selectedTower: null,
    selectedType: 'ember',
    autoSend: false,
    time: 0,
  };
}

export function createWorld(random) {
  const state = freshState();
  let finished = false;

  function reset() {
    const next = freshState();
    for (const key of Object.keys(next)) state[key] = next[key];
    finished = false;
  }

  function startGame() {
    reset();
  }

  function sendWave() {
    if (state.waveState !== 'build' || state.wave >= MAX_WAVES) return 0;
    state.wave += 1;
    const queue = [];
    for (const group of waveSpec(state.wave)) {
      for (let i = 0; i < group.count; i++) {
        queue.push({ kind: group.kind, at: group.delay + i * group.interval });
      }
    }
    queue.sort((a, b) => a.at - b.at);
    state.spawnQueue = queue;
    state.spawnTimer = 0;
    state.waveTime = 0;
    state.waveState = 'spawning';
    return EVENT_HORN;
  }

  function buildTower(plotIndex, type) {
    if (plotIndex < 0 || plotIndex >= PLOTS.length) return 0;
    if (state.towers.some((t) => t.plotIndex === plotIndex)) return 0;
    const cost = towerCost(type);
    if (cost === undefined || state.shards < cost) return 0;
    const plot = PLOTS[plotIndex];
    const tower = createTower(type, plot.x, plot.y, plotIndex);
    state.shards -= cost;
    state.towers.push(tower);
    state.selectedTower = tower;
    state.selectedPlot = plotIndex;
    return EVENT_BUILD;
  }

  function upgradeTower(tower) {
    if (!tower || tower.level >= 3) return 0;
    const cost = upgradeCost(tower);
    if (state.shards < cost) return 0;
    state.shards -= cost;
    tower.invested += cost;
    tower.level += 1;
    return EVENT_UPGRADE;
  }

  function sellTower(tower) {
    if (!tower) return 0;
    const index = state.towers.indexOf(tower);
    if (index === -1) return 0;
    state.shards += sellValue(tower);
    state.towers.splice(index, 1);
    if (state.selectedTower === tower) state.selectedTower = null;
    return EVENT_SELL;
  }

  function step() {
    let events = 0;
    state.time += STEP;

    // Auto-send countdown: after a clear, spawnTimer runs negative for a
    // short breather, then the next wave goes out on its own.
    if (state.waveState === 'build' && state.autoSend && !finished && state.wave < MAX_WAVES && state.wavesCleared > 0) {
      state.spawnTimer += STEP;
      if (state.spawnTimer >= 0) events |= sendWave();
    }

    if (state.waveState === 'spawning' || state.waveState === 'fighting') {
      state.waveTime += STEP;
      state.spawnTimer = state.waveTime;
      while (state.spawnQueue.length > 0 && state.spawnQueue[0].at <= state.waveTime) {
        const entry = state.spawnQueue.shift();
        state.enemies.push(createEnemy(entry.kind, state.wave, random));
        if (state.waveState === 'spawning') state.waveState = 'fighting';
      }
      if (state.spawnQueue.length === 0 && state.waveState === 'spawning') {
        state.waveState = 'fighting';
      }
    }

    // Move enemies; leaks cost lives and flash red at the lantern.
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const enemy = state.enemies[i];
      if (moveEnemy(enemy, STEP, PATH_POINTS, state.time)) {
        state.enemies.splice(i, 1);
        state.lives -= enemy.lives;
        if (state.lives < 0) state.lives = 0;
        events |= EVENT_LEAK;
        for (let p = 0; p < 10; p++) {
          const angle = random.range(0, Math.PI * 2);
          const speed = random.range(40, 130);
          state.particles.push({
            x: LANTERN.x,
            y: LANTERN.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: random.range(0.3, 0.6),
            maxLife: 0.6,
            color: '#ff5a5a',
            size: random.range(2, 4),
          });
        }
      }
    }

    if (!finished) events |= updateTowers(state, STEP, random);

    // Move bolts toward their target's current position; a bolt whose
    // target is gone or already dead fizzles harmlessly.
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const projectile = state.projectiles[i];
      if (projectile.kind === 'chain') {
        projectile.life -= STEP;
        if (projectile.life <= 0) state.projectiles.splice(i, 1);
        continue;
      }
      const target = projectile.target;
      if (!target || target.hp <= 0 || !state.enemies.includes(target)) {
        state.projectiles.splice(i, 1);
        continue;
      }
      const dx = target.x - projectile.x;
      const dy = target.y - projectile.y;
      const dist = Math.hypot(dx, dy);
      const travel = projectile.speed * STEP;
      if (dist <= target.radius + 6 || dist <= travel) {
        state.projectiles.splice(i, 1);
        events |= applyDamage(state, target, projectile.damage, projectile.tower || null, random);
      } else {
        projectile.x += (dx / dist) * travel;
        projectile.y += (dy / dist) * travel;
      }
    }

    // Age particles and floating shard text.
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const particle = state.particles[i];
      particle.life -= STEP;
      if (particle.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      particle.x += particle.vx * STEP;
      particle.y += particle.vy * STEP;
    }
    for (let i = state.floaters.length - 1; i >= 0; i--) {
      const floater = state.floaters[i];
      floater.life -= STEP;
      floater.y -= 24 * STEP;
      if (floater.life <= 0) state.floaters.splice(i, 1);
    }

    // Wave clear: nothing left to spawn and nothing alive.
    if (
      (state.waveState === 'spawning' || state.waveState === 'fighting') &&
      state.spawnQueue.length === 0 &&
      state.enemies.length === 0
    ) {
      state.wavesCleared += 1;
      state.waveState = 'build';
      events |= EVENT_WAVE_CLEAR;
      if (state.autoSend) state.spawnTimer = -2.5;
      if (state.wave >= MAX_WAVES && !finished) {
        finished = true;
        events |= EVENT_VICTORY;
      }
    }

    if (state.lives <= 0 && !finished) {
      finished = true;
      events |= EVENT_DEFEAT;
    }

    return events;
  }

  return { state, reset, startGame, step, buildTower, upgradeTower, sellTower, sendWave };
}
