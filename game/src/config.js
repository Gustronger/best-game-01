// LANTERNFALL — shared tuning constants.
// One place for every number the rules, the renderer and the HUD agree on,
// so a balance change here flows through the whole game untouched elsewhere.

export const STEP = 1 / 60;

export const FIELD = { width: 960, height: 600 };

export const PATH_POINTS = [
  { x: -20, y: 110 },
  { x: 700, y: 110 },
  { x: 700, y: 300 },
  { x: 200, y: 300 },
  { x: 200, y: 490 },
  { x: 980, y: 490 },
];

export const PLOTS = [
  { x: 120, y: 200 },
  { x: 300, y: 200 },
  { x: 480, y: 200 },
  { x: 600, y: 200 },
  { x: 800, y: 200 },
  { x: 120, y: 400 },
  { x: 330, y: 400 },
  { x: 540, y: 400 },
  { x: 780, y: 400 },
  { x: 90, y: 540 },
  { x: 420, y: 540 },
  { x: 700, y: 540 },
];

export const LANTERN = { x: 920, y: 490 };

// Economy targets: waves 1-4 pay out ~345 shards on top of the 120 start,
// so a decent player fields 3-4 towers by the wave-5 boss; a level-up costs
// round(base * 0.75 * targetLevel) and selling refunds 70% of all invested.
export const START_SHARDS = 120;
export const START_LIVES = 20;
export const MAX_WAVES = 15;

// Best score lives in localStorage under this key.
export const BEST_KEY = 'lanternfall-best';

// Balance target (verified by the dev harness in ../dev, seed 12345):
// the wave-5 wraith must fall to a frost/storm-first build, not just to
// ember-heavy ones. At the old numbers a lone frost could not kill wave-1
// wisps (its 1 s pulse grid let them cross a 64 px zone between pulses),
// and a 2-frost + 1-storm comp dealt only ~40% of the boss's HP. So frost
// pulses twice as often and twice as hard, storm hits harder and fires a
// little faster (22 -> 28 damage, 0.8 -> 1.0/s: it clears the boss's
// escorts instead of wasting shots on them), and wraith HP is halved.
// Measured after the change: frost-first kills the wave-5 boss
// halfway along the path, storm-first and ember-heavy clear it comfortably,
// the full-game autopilot wins with 20/20 lives, and the wave-10/15 bosses
// still need a real army (killed around mid-path, never at the gate).
// Ember, costs, lives and wave structure are untouched.
export const TOWER_STATS = {
  ember: { cost: 50, damage: 12, range: 120, fireRate: 2.2, projectileSpeed: 420 },
  frost: { cost: 75, damage: 8, range: 105, fireRate: 2.0, slowFactor: 0.6, slowDuration: 1.2 },
  storm: { cost: 120, damage: 28, range: 140, fireRate: 1.0, chains: 3, chainRange: 100 },
};

export const UPGRADE_COST_FACTOR = 0.75;
export const SELL_REFUND = 0.7;

export const ENEMY_STATS = {
  wisp: { hp: 22, speed: 95, reward: 6, lives: 1, radius: 9 },
  shade: { hp: 55, speed: 55, reward: 9, lives: 1, radius: 12 },
  brute: { hp: 220, speed: 32, reward: 20, lives: 2, radius: 16 },
  swarmling: { hp: 12, speed: 70, reward: 3, lives: 1, radius: 7 },
  wraith: { hp: 700, speed: 26, reward: 150, lives: 5, radius: 24 },
};

export const HP_SCALE_PER_WAVE = 0.12;
