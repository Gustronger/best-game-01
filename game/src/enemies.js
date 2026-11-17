// LANTERNFALL — enemies: definitions, spawning and path walking.
// An enemy is a plain object that walks the waypoint path from its first
// point to the lantern. Slows never stack: a fresh chill overwrites the old
// one, so the strongest recent frost always wins.

import { ENEMY_STATS, HP_SCALE_PER_WAVE, PATH_POINTS } from './config.js';

export const ENEMY_KINDS = ['wisp', 'shade', 'brute', 'swarmling', 'wraith'];

export function createEnemy(kind, wave, random) {
  const base = ENEMY_STATS[kind];
  const hp = Math.round(base.hp * (1 + HP_SCALE_PER_WAVE * (wave - 1)));
  const start = PATH_POINTS[0];
  return {
    id: random.int(1000000000),
    kind,
    x: start.x,
    y: start.y,
    hp,
    maxHp: hp,
    speed: base.speed,
    baseSpeed: base.speed,
    slowUntil: 0,
    slowFactor: 1,
    reward: base.reward,
    lives: base.lives,
    radius: base.radius,
    waypointIndex: 1,
    dist: 0,
  };
}

// Chill an enemy until `until` (world-clock seconds). A fresh chill replaces
// any older one, so slows never stack — the most recent frost always wins.
export function applySlow(enemy, factor, until) {
  enemy.slowFactor = factor;
  enemy.slowUntil = until;
}

// Advance one enemy along the path for dt seconds.
// `now` is the world clock (seconds); slows expire against it.
// Returns true when the enemy reaches the final waypoint (it leaked).
export function moveEnemy(enemy, dt, pathPoints, now) {
  const slowed = now < enemy.slowUntil;
  const speed = enemy.baseSpeed * (slowed ? enemy.slowFactor : 1);
  let remaining = speed * dt;

  while (remaining > 0) {
    if (enemy.waypointIndex >= pathPoints.length) return true;
    const target = pathPoints[enemy.waypointIndex];
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const leg = Math.hypot(dx, dy);
    if (leg <= remaining) {
      enemy.x = target.x;
      enemy.y = target.y;
      enemy.dist += leg;
      remaining -= leg;
      enemy.waypointIndex += 1;
      if (enemy.waypointIndex >= pathPoints.length) return true;
    } else {
      enemy.x += (dx / leg) * remaining;
      enemy.y += (dy / leg) * remaining;
      enemy.dist += remaining;
      remaining = 0;
    }
  }
  return false;
}
