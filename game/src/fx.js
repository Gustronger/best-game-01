// LANTERNFALL — renderer-local kill-burst effects (fx.js).
//
// A second, purely visual particle layer that lives next to the world's own
// particles. The world already spawns its own effects — a red burst at the
// lantern on a leak (world.js), a gold burst plus a "+n" floater on every
// kill, and a cyan ring at the tower on a frost pulse (towers.js) — so this
// module adds ONLY what is missing: a short, type-flavoured burst at the
// exact spot an enemy died, coloured by how it died.
//
//   ember sparks (orange) — the default kill flash, and kills nearest an
//     Ember Spire in range;
//   frost shards (cyan) — kills of an enemy that was chilled when last seen
//     (slowUntil still ahead of the world clock), or nearest a Frost Ward;
//   storm sparks (violet) — kills nearest a Storm Coil in range.
//
// How it works: the renderer calls updateFx(state) once per paint. It keeps
// a snapshot of the enemies it saw last paint (id -> last position, chilled
// flag, kind, radius) and compares it with the enemies alive now. An enemy
// that vanished while state.kills rose is a kill — a leak also removes an
// enemy but never raises kills, and leaks always end at the final waypoint,
// so when more enemies vanished than kills were scored the kills are
// attributed to the vanished ones furthest from the path's end. Burst
// directions, speeds, lifetimes and colours come from a small integer hash
// of (quantised position, wave, kills, particle index) written below —
// never unseeded randomness, never the wall clock.
//
// Determinism contract: particles step ONLY by the delta of state.time
// (lastTime is stored between paints). Two paints of the same state have a
// zero delta, so nothing moves, nothing new spawns, and drawFx is a pure
// function of the stored particles — the two ?shot= paints are
// pixel-identical. A reset (time or kills running backwards) clears the
// layer and re-snapshots instead of bursting for the whole field.
//
// This module never touches the world: it only reads state.enemies,
// state.towers, state.kills, state.wave and state.time. render.js wires it
// in (updateFx + drawFx inside the play-field paint); until then it is
// inert and fully testable from plain Node.

import { PATH_POINTS } from './config.js';
import { towerRange } from './towers.js';

export const FX_KIND_EMBER = 'ember';
export const FX_KIND_FROST = 'frost';
export const FX_KIND_STORM = 'storm';

/** Hard cap on live fx particles; oldest are dropped first. */
const MAX_PARTICLES = 240;
/** Longest time delta one update may apply (tab-switch safety net). */
const MAX_DT = 0.25;
/** Base burst sizes per flavour; big enemies add a few extra sparks. */
const BURST_COUNT = { ember: 10, frost: 8, storm: 12 };
const BURST_COLORS = {
  ember: ['#ff8c2e', '#ffb347'],
  frost: ['#7fe3ff', '#4fd8ff'],
  storm: ['#b678ff', '#d9b3ff'],
};
// Speed (px/s) and lifetime (s) ranges per flavour.
const BURST_SPEED = { ember: [60, 170], frost: [40, 110], storm: [80, 200] };
const BURST_LIFE = { ember: [0.35, 0.6], frost: [0.45, 0.7], storm: [0.25, 0.45] };
const BURST_SIZE = { ember: [2, 3.5], frost: [3, 5], storm: [2, 3] };

/** The leak point: the final path waypoint, where a leaked enemy vanishes. */
const PATH_END = PATH_POINTS[PATH_POINTS.length - 1] || { x: 980, y: 490 };

/**
 * Deterministic 32-bit integer hash -> [0, 1). Four small integer inputs
 * (quantised position, wave/kills mix, particle slot) are folded together
 * with a splitmix-style finaliser. Same inputs always give the same output;
 * neighbouring inputs give unrelated outputs, which is what makes the
 * burst directions look random without any randomness.
 */
export function deterministicHash(a, b, c, d) {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1)
    ^ Math.imul(c | 0, 0x85ebca6b) ^ Math.imul(d | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function lerp(a, b, f) {
  return a + (b - a) * f;
}

export function createFx() {
  return {
    particles: [],
    // id -> { x, y, chilled, kind, radius } of enemies seen last paint.
    snapshot: new Map(),
    lastTime: 0,
    prevKills: 0,
  };
}

export function resetFx(fx) {
  fx.particles.length = 0;
  fx.snapshot.clear();
  fx.lastTime = 0;
  fx.prevKills = 0;
}

export function fxParticleCount(fx) {
  return fx.particles.length;
}

function takeSnapshot(fx, state, time) {
  fx.snapshot.clear();
  const enemies = (state && state.enemies) || [];
  for (let i = 0; i < enemies.length; i += 1) {
    const e = enemies[i];
    fx.snapshot.set(e.id, {
      x: e.x,
      y: e.y,
      chilled: !!(e.slowUntil && e.slowUntil > time),
      kind: e.kind,
      radius: e.radius || 12,
    });
  }
}

function distToEndSquared(rec) {
  const dx = rec.x - PATH_END.x;
  const dy = rec.y - PATH_END.y;
  return dx * dx + dy * dy;
}

/**
 * Which flavour a kill gets: chilled enemies die as frost shards; otherwise
 * the nearest tower whose range covers the kill spot lends its flavour
 * (the tower most likely to have dealt the blow); with no tower in range
 * the bolt-travel default is ember.
 */
function flavourAt(state, rec) {
  if (rec.chilled) return FX_KIND_FROST;
  const towers = state.towers || [];
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < towers.length; i += 1) {
    const tower = towers[i];
    const range = towerRange(tower);
    const dx = rec.x - tower.x;
    const dy = rec.y - tower.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= range * range && d2 < bestDist) {
      bestDist = d2;
      best = tower;
    }
  }
  if (best) return best.type;
  return FX_KIND_EMBER;
}

function spawnBurst(fx, rec, state) {
  const kind = flavourAt(state, rec);
  let count = BURST_COUNT[kind] || BURST_COUNT.ember;
  if (rec.radius >= 20) count += 6;
  else if (rec.radius >= 14) count += 3;
  const colors = BURST_COLORS[kind];
  const speedRange = BURST_SPEED[kind];
  const lifeRange = BURST_LIFE[kind];
  const sizeRange = BURST_SIZE[kind];
  const qx = Math.round(rec.x);
  const qy = Math.round(rec.y);
  const wave = state.wave || 0;
  const kills = state.kills || 0;
  for (let i = 0; i < count; i += 1) {
    const slot = i * 4;
    const angle = deterministicHash(qx, qy, wave * 1000 + kills, slot) * Math.PI * 2;
    const speed = lerp(speedRange[0], speedRange[1],
      deterministicHash(qx, qy, wave * 1000 + kills, slot + 1));
    const life = lerp(lifeRange[0], lifeRange[1],
      deterministicHash(qx, qy, wave * 1000 + kills, slot + 2));
    const seed = deterministicHash(qx, qy, wave * 1000 + kills, slot + 3);
    const size = lerp(sizeRange[0], sizeRange[1], seed);
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    fx.particles.push({
      x: rec.x,
      y: rec.y,
      vx,
      vy: kind === FX_KIND_FROST ? vy - 25 : vy,
      life,
      maxLife: life,
      size,
      color: colors[i % colors.length],
      kind,
      seed,
      angle,
    });
  }
  // Cap the layer: drop the oldest particles first, never the new burst.
  while (fx.particles.length > MAX_PARTICLES) fx.particles.shift();
}

function stepParticles(fx, dt) {
  if (dt <= 0) return;
  const drag = Math.max(0, 1 - 1.5 * dt);
  for (let i = fx.particles.length - 1; i >= 0; i -= 1) {
    const p = fx.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      fx.particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= drag;
    p.vy *= drag;
    // Frost shards keep drifting upward as they fade.
    if (p.kind === FX_KIND_FROST) p.vy -= 30 * dt;
  }
}

/**
 * Observe one paint of `state` and maintain the layer. Call once per
 * renderer.draw, before drawing particles. Pure state in, no I/O, no clock.
 */
export function updateFx(fx, state) {
  // Accept the plain state object; a world wrapper (with .state) is also
  // tolerated so a wiring slip in the renderer cannot throw mid-paint.
  const s = (state && state.enemies === undefined && state.state ? state.state : state) || {};
  const time = s.time || 0;
  const kills = s.kills || 0;
  const dt = time - fx.lastTime;

  // A new run: time and kills run backwards, so clear and re-snapshot
  // instead of treating the whole field as freshly dead.
  if (dt < 0 || kills < fx.prevKills) {
    resetFx(fx);
    fx.lastTime = time;
    fx.prevKills = kills;
    takeSnapshot(fx, s, time);
    return;
  }

  stepParticles(fx, Math.min(dt, MAX_DT));
  fx.lastTime = time;

  const alive = s.enemies || [];  const aliveIds = new Set();
  for (let i = 0; i < alive.length; i += 1) aliveIds.add(alive[i].id);
  const vanished = [];
  for (const rec of fx.snapshot.values()) {
    if (!aliveIds.has(rec.id)) vanished.push(rec);
  }
  const killsDelta = kills - fx.prevKills;
  fx.prevKills = kills;

  if (vanished.length > 0 && killsDelta > 0) {
    // More vanished than kills scored means leaks rode along: leaks end
    // at the final waypoint, so the kills are the vanished furthest from it.
    if (vanished.length > killsDelta) {
      vanished.sort((a, b) => distToEndSquared(b) - distToEndSquared(a));
    }
    const n = Math.min(killsDelta, vanished.length);
    for (let i = 0; i < n; i += 1) spawnBurst(fx, vanished[i], s);
  }

  takeSnapshot(fx, s, time);
}

/** Draw the layer. Reads particle state only; never mutates it. */
export function drawFx(ctx, fx) {
  const list = fx.particles;
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
    ctx.globalAlpha = alpha;
    if (p.kind === FX_KIND_FROST) {
      // A shard: a small diamond, rotated by its spawn seed.
      const c = Math.cos(p.seed * Math.PI);
      const sn = Math.sin(p.seed * Math.PI);
      const w = p.size;
      const h = p.size * 0.45;
      ctx.beginPath();
      ctx.moveTo(p.x + w * c, p.y + w * sn);
      ctx.lineTo(p.x - h * sn, p.y + h * c);
      ctx.lineTo(p.x - w * c, p.y - w * sn);
      ctx.lineTo(p.x + h * sn, p.y - h * c);
      ctx.closePath();
      ctx.fillStyle = p.color;
      ctx.fill();
    } else if (p.kind === FX_KIND_STORM) {
      // A spark: a short two-segment zigzag trailing behind its motion.
      const jog = (p.seed - 0.5) * 10;
      const tx = p.x - p.vx * 0.045;
      const ty = p.y - p.vy * 0.045;
      const mx = p.x - p.vx * 0.02 + jog;
      const my = p.y - p.vy * 0.02 - jog * 0.5;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(mx, my);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    } else {
      // An ember spark: a bright streak with a hot head.
      const tx = p.x - p.vx * 0.035;
      const ty = p.y - p.vy * 0.035;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff3d0';
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
