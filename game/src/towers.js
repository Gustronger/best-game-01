// LANTERNFALL — towers: definitions, pricing, targeting and firing.
// Damage grows with level (x1 / x1.6 / x2.6) and range grows 10% at level 3.
// Ember shoots bolts, Frost pulses a chilling aura, Storm chains lightning.
// Kills are settled here through applyDamage so every damage source — bolt,
// pulse or chain — pays out shards, score and kill effects exactly once.

import { TOWER_STATS, UPGRADE_COST_FACTOR, SELL_REFUND } from './config.js';
import { applySlow } from './enemies.js';

export const TOWER_TYPES = ['ember', 'frost', 'storm'];

// Event-flag values mirror world.js so towers can report kills and shots
// without importing the world module (which would be a circular import).
const EVENT_KILL = 1;
const EVENT_SHOOT = 32;

let nextTowerId = 1;

export function towerCost(type) {
  const stats = TOWER_STATS[type];
  return stats ? stats.cost : undefined;
}

export function upgradeCost(tower) {
  const targetLevel = tower.level + 1;
  return Math.round(TOWER_STATS[tower.type].cost * UPGRADE_COST_FACTOR * targetLevel);
}

export function sellValue(tower) {
  return Math.round(tower.invested * SELL_REFUND);
}

export function createTower(type, x, y, plotIndex) {
  const tower = {
    id: nextTowerId,
    type,
    level: 1,
    x,
    y,
    plotIndex,
    cooldown: 0,
    invested: TOWER_STATS[type].cost,
    kills: 0,
    angle: -Math.PI / 2,
  };
  nextTowerId += 1;
  return tower;
}

function damageMultiplier(tower) {
  if (tower.level >= 3) return 2.6;
  if (tower.level === 2) return 1.6;
  return 1;
}

export function towerRange(tower) {
  const base = TOWER_STATS[tower.type].range;
  return tower.level >= 3 ? base * 1.1 : base;
}

export function towerDamage(tower) {
  return TOWER_STATS[tower.type].damage * damageMultiplier(tower);
}

function inRange(tower, enemy, range) {
  const dx = enemy.x - tower.x;
  const dy = enemy.y - tower.y;
  return dx * dx + dy * dy <= range * range;
}

// Furthest along the path (largest dist) among the enemies in range.
function furthestTarget(tower, enemies, range) {
  let best = null;
  for (const enemy of enemies) {
    if (!inRange(tower, enemy, range)) continue;
    if (!best || enemy.dist > best.dist) best = enemy;
  }
  return best;
}

function spawnBurst(state, x, y, color, count, random) {
  for (let i = 0; i < count; i++) {
    const angle = random.range(0, Math.PI * 2);
    const speed = random.range(30, 110);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: random.range(0.25, 0.55),
      maxLife: 0.55,
      color,
      size: random.range(2, 4),
    });
  }
}

// Deal damage to one enemy. On a kill, pay out, credit the tower, and queue
// the burst + floating shard text. Returns EVENT_KILL when it kills, else 0.
// Exported so world.js can settle bolt hits through the same path.
export function applyDamage(state, enemy, damage, tower, random) {
  enemy.hp -= damage;
  if (enemy.hp > 0) return 0;
  const index = state.enemies.indexOf(enemy);
  if (index !== -1) state.enemies.splice(index, 1);
  state.shards += enemy.reward;
  state.shardsEarned += enemy.reward;
  state.score += enemy.reward * 10;
  state.kills += 1;
  if (tower) tower.kills += 1;
  spawnBurst(state, enemy.x, enemy.y, '#ffd27a', 8, random);
  state.floaters.push({
    x: enemy.x,
    y: enemy.y - 10,
    text: `+${enemy.reward}`,
    life: 0.9,
    color: '#ffd27a',
  });
  return EVENT_KILL;
}

function fireEmber(state, tower, random) {
  const range = towerRange(tower);
  const target = furthestTarget(tower, state.enemies, range);
  if (!target) return 0;
  tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
  state.projectiles.push({
    kind: 'bolt',
    x: tower.x,
    y: tower.y,
    target,
    tower,
    speed: TOWER_STATS.ember.projectileSpeed,
    damage: towerDamage(tower),
  });
  tower.cooldown = 1 / TOWER_STATS.ember.fireRate;
  return EVENT_SHOOT;
}

function fireFrost(state, tower, random) {
  const stats = TOWER_STATS.frost;
  const range = towerRange(tower);
  let hitAny = false;
  // Iterate a copy: applyDamage can remove enemies from state.enemies.
  for (const enemy of [...state.enemies]) {
    if (!inRange(tower, enemy, range)) continue;
    hitAny = true;
    applySlow(enemy, stats.slowFactor, state.time + stats.slowDuration);
    applyDamage(state, enemy, towerDamage(tower), tower, random);
  }
  if (hitAny) {
    // A ring of small cyan sparks marks the pulse; the renderer draws the
    // range circle separately, so no oversized particle is needed here.
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      state.particles.push({
        x: tower.x + Math.cos(angle) * range * 0.85,
        y: tower.y + Math.sin(angle) * range * 0.85,
        vx: Math.cos(angle) * 12,
        vy: Math.sin(angle) * 12,
        life: 0.3,
        maxLife: 0.3,
        color: '#7fe3ff',
        size: 3,
      });
    }
  }
  tower.cooldown = 1 / stats.fireRate;
  return hitAny ? EVENT_SHOOT : 0;
}

function fireStorm(state, tower, random) {
  const stats = TOWER_STATS.storm;
  const range = towerRange(tower);
  let target = furthestTarget(tower, state.enemies, range);
  if (!target) return 0;
  tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
  let events = EVENT_SHOOT;
  let fromX = tower.x;
  let fromY = tower.y;
  const hit = new Set();
  for (let link = 0; link < stats.chains && target; link++) {
    state.projectiles.push({
      kind: 'chain',
      fromX,
      fromY,
      toX: target.x,
      toY: target.y,
      life: 0.12,
      maxLife: 0.12,
    });
    hit.add(target);
    const struck = target;
    events |= applyDamage(state, struck, towerDamage(tower), tower, random);
    // Next link: nearest enemy not yet struck, within chainRange of this one.
    let next = null;
    let bestDist = stats.chainRange;
    for (const enemy of state.enemies) {
      if (hit.has(enemy)) continue;
      const d = Math.hypot(enemy.x - struck.x, enemy.y - struck.y);
      if (d <= bestDist) {
        bestDist = d;
        next = enemy;
      }
    }
    fromX = struck.x;
    fromY = struck.y;
    target = next;
  }
  tower.cooldown = 1 / stats.fireRate;
  return events;
}

export function updateTowers(state, dt, random) {
  let events = 0;
  for (const tower of state.towers) {
    tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;
    if (tower.type === 'ember') events |= fireEmber(state, tower, random);
    else if (tower.type === 'frost') events |= fireFrost(state, tower, random);
    else if (tower.type === 'storm') events |= fireStorm(state, tower, random);
  }
  return events;
}
