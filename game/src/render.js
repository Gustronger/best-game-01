// LANTERNFALL presentation layer — every pixel on the 960x600 canvas.
// Draws the night field, the winding stone path, plots, towers, shadow
// enemies, projectiles, particles, HUD, tower bar, selection panel and all
// screens. Canvas 2D only: no images, no external fonts, no network.
// The geometry of every clickable button lives in getButtons() below and
// main.js hit-tests against that same list, so art and input can never drift.
//
// Lighting model (all deterministic, driven by state.time only):
// the lantern is the warm key light, tower glows are coloured accents,
// and every standing thing drops a soft ground shadow so the flat field
// reads as depth. No Math.random(), no Date.now() anywhere in this file.
import { PATH_POINTS, PLOTS, LANTERN } from './config.js';
import { towerCost, upgradeCost, sellValue, towerDamage, towerRange } from './towers.js';
import { createFx, updateFx, drawFx } from './fx.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_VICTORY = 'victory';
export const SCREEN_OVER = 'defeat';

const W = 960;
const H = 600;
const HUD_H = 44;
const BAR_Y = 508;
const BAR_H = 92;

const INK = '#f4f1ff';
const DIM = '#a9a3c7';
const PANEL_BG = '#0e0d20';
const PANEL_LINE = '#2e2a52';
const AMBER = '#ffb347';
const EMBER = '#ff8c2e';
const FROST = '#4fd8ff';
const STORM = '#b678ff';

// Tower display data: name, cost, hotkey, colours. Costs match the design
// (Ember 50, Frost 75, Storm 120). Damage, range, upgrade cost and sell
// value come from towers.js (the rules), so the panel can never disagree
// with the game itself.
const TOWER_CARDS = [
  { key: 'ember', name: 'Ember Spire', cost: 50, hotkey: '1', color: EMBER, glow: AMBER, desc: 'Fast bolts' },
  { key: 'frost', name: 'Frost Ward', cost: 75, hotkey: '2', color: FROST, glow: '#9beaff', desc: 'Chills nearby' },
  { key: 'storm', name: 'Storm Coil', cost: 120, hotkey: '3', color: STORM, glow: '#d9b3ff', desc: 'Chain lightning' },
];
const EYE_COLOR = { wisp: '#9be7ff', shade: AMBER, brute: '#ff5a4e', swarmling: '#c9f27a', wraith: '#c084fc' };

export function towerCardRect(index) {
  return { x: 12 + index * 188, y: BAR_Y, w: 176, h: BAR_H - 8 };
}

export function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function towerDef(type) {
  return TOWER_CARDS.find((c) => c.key === type) || TOWER_CARDS[0];
}
function resolveTower(state, ui) {
  // The UI selection (a click, or a staged scene) wins over the world's
  // "last built" tower: otherwise clicking a tower would keep showing the
  // panel of whichever tower was built most recently.
  const sel = (ui && ui.selectedTower !== undefined && ui.selectedTower !== null)
    ? ui.selectedTower
    : (state && state.selectedTower !== undefined && state.selectedTower !== null)
      ? state.selectedTower
      : null;
  if (!sel) return null;
  if (typeof sel === 'object') return sel;
  const list = (state && state.towers) || [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === sel) return list[i];
  }
  return null;
}
function enemiesLeft(state) {
  const alive = (state.enemies && state.enemies.length) || 0;
  const queued = (state.spawnQueue && state.spawnQueue.length) || 0;
  return alive + queued;
}

// Deterministic 0..1 hash from an integer index + salt: pure integer
// arithmetic, so the same index always speckles the same stone.
function hash01(index, salt) {
  let h = ((index * 2654435761 + salt * 40503) >>> 0);
  h ^= h >>> 13;
  h = (h * 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Single source of truth for clickable button geometry. draw() renders
// exactly this list, and main.js hit-tests against it.
export function getButtons(screen, state, ui) {
  const buttons = [];
  const s = state || {};
  const u = ui || {};
  if (screen === SCREEN_TITLE) {
    buttons.push({ id: 'start', x: 380, y: 392, w: 200, h: 56, label: 'Start', enabled: true });
    return buttons;
  }
  if (screen === SCREEN_VICTORY || screen === SCREEN_OVER) {
    buttons.push({ id: 'again', x: 380, y: 424, w: 200, h: 56, label: 'Play again', enabled: true });
    return buttons;
  }
  if (screen === SCREEN_PAUSED) {
    buttons.push({ id: 'resume', x: 380, y: 296, w: 200, h: 52, label: 'Resume', enabled: true });
    buttons.push({ id: 'restart', x: 380, y: 360, w: 200, h: 52, label: 'Restart', enabled: true });
    return buttons;
  }
  // Play screen: bottom-bar controls.
  if (s.waveState === 'build') {
    buttons.push({ id: 'send-wave', x: 584, y: 512, w: 176, h: 40, label: 'Send wave (Enter)', enabled: true });
  }
  buttons.push({
    id: 'autosend', x: 772, y: 512, w: 176, h: 40,
    label: u.autoSend ? 'Auto-send: ON' : 'Auto-send: OFF', enabled: true,
  });
  buttons.push({ id: 'pause', x: 584, y: 560, w: 84, h: 32, label: 'Pause', enabled: true });
  buttons.push({ id: 'mute', x: 680, y: 560, w: 84, h: 32, label: u.muted ? 'Unmute' : 'Mute', enabled: true });
  const tower = resolveTower(s, u);
  if (tower) {
    const level = tower.level || 1;
    const cost = upgradeCost(tower);
    buttons.push({
      id: 'upgrade', x: 28, y: 448, w: 104, h: 34,
      label: level >= 3 ? 'Max level' : 'Upgrade ' + cost,
      enabled: level < 3 && (s.shards || 0) >= cost,
    });
    buttons.push({
      id: 'sell', x: 140, y: 448, w: 104, h: 34,
      label: 'Sell +' + sellValue(tower), enabled: true,
    });
  }
  return buttons;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // Renderer-local kill-burst layer (fx.js): observes one paint per draw
  // call and draws type-flavoured sparks where enemies died. It never
  // touches the world, so it cannot change the game — only the pixels.
  const fx = createFx();

  function font(size, weight) {
    return (weight || '700') + ' ' + size + 'px system-ui, sans-serif';
  }
  function text(value, x, y, size, color, align, weight) {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
  }
  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function button(btn) {
    roundRectPath(btn.x, btn.y, btn.w, btn.h, 8);
    ctx.fillStyle = btn.enabled ? '#2a2450' : '#1a1830';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = btn.enabled ? AMBER : '#3a3654';
    ctx.stroke();
    text(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2 + 6, btn.w > 150 ? 18 : 15,
      btn.enabled ? INK : DIM, 'center');
  }
  function dimScreen(alpha) {
    ctx.fillStyle = 'rgba(8, 7, 20, ' + alpha + ')';
    ctx.fillRect(0, 0, W, H);
  }
  // Soft ground shadow: the main 3D cue on a flat field. Drawn under the
  // thing that casts it, before the thing itself.
  function dropShadow(x, y, rx, ry, alpha) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, ' + (alpha === undefined ? 0.35 : alpha) + ')';
    ctx.fill();
  }

  // Dusk field: indigo overhead fading to a faintly warm horizon, two
  // deterministic sine ridges for a skyline, twinkling stars, and a
  // stronger vignette so the eye falls on the lit path.
  function drawField(state) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#12112e');
    sky.addColorStop(0.45, '#1a1738');
    sky.addColorStop(0.8, '#241d3d');
    sky.addColorStop(1, '#2c2140');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // Far ridge (higher, darker) and near ridge (lower, a touch lighter),
    // both from fixed sine sums — no random, same hills every frame.
    const ridges = [
      { base: 74, a1: 10, f1: 0.011, p1: 0.7, a2: 6, f2: 0.004, p2: 2.3, color: '#171637' },
      { base: 96, a1: 8, f1: 0.013, p1: 2.1, a2: 5, f2: 0.005, p2: 0.4, color: '#1c1a42' },
    ];
    for (let k = 0; k < ridges.length; k += 1) {
      const rg = ridges[k];
      ctx.beginPath();
      ctx.moveTo(0, HUD_H);
      for (let x = 0; x <= W; x += 16) {
        const y = rg.base
          + Math.sin(x * rg.f1 + rg.p1) * rg.a1
          + Math.sin(x * rg.f2 + rg.p2) * rg.a2;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, HUD_H);
      ctx.closePath();
      ctx.fillStyle = rg.color;
      ctx.fill();
    }
    // Deterministic starfield: positions from index arithmetic, never random.
    for (let i = 0; i < 70; i += 1) {
      const sx = (i * 137) % W;
      const sy = (i * 89) % 480;
      const tw = 0.25 + 0.2 * Math.sin((state.time || 0) * 1.5 + i);
      ctx.fillStyle = 'rgba(180, 175, 230, ' + tw.toFixed(2) + ')';
      ctx.fillRect(sx, sy, 2, 2);
    }
    // Soft ground shading bands so the field is not a flat slab.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fillRect(0, 44, W, 120);
    ctx.fillRect(0, 300, W, 90);
    // Vignette: dark corners pull the eye to the lantern-lit middle.
    const vig = ctx.createRadialGradient(W / 2, H / 2, 240, W / 2, H / 2, 640);
    vig.addColorStop(0, 'rgba(6, 5, 16, 0)');
    vig.addColorStop(0.7, 'rgba(6, 5, 16, 0.14)');
    vig.addColorStop(1, 'rgba(6, 5, 16, 0.44)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPath() {
    const pts = PATH_POINTS || [];
    if (pts.length < 2) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Path geometry as a polyline, reused for the body, the edge
    // highlights and the speckle walk below.
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    // Outer dark bed: the path sits in a shallow trench, not on the grass.
    ctx.strokeStyle = '#17122e';
    ctx.lineWidth = 58;
    ctx.stroke();
    // Stone body, shaded top-to-bottom so the upper edge catches the
    // (imaginary) sky light and the lower edge falls into shadow.
    const shade = ctx.createLinearGradient(0, 44, 0, 508);
    shade.addColorStop(0, '#463f6b');
    shade.addColorStop(0.5, '#3a3654');
    shade.addColorStop(1, '#2c2745');
    ctx.strokeStyle = shade;
    ctx.lineWidth = 44;
    ctx.stroke();
    // Stone speckle: deterministic hash dots along the whole path, so the
    // stones read as stones instead of a flat ribbon. Dots sit inside the
    // 44 px body, jittered across it by index hash, never random.
    let speck = 0;
    for (let s = 0; s < pts.length - 1; s += 1) {
      const ax = pts[s].x;
      const ay = pts[s].y;
      const bx = pts[s + 1].x;
      const by = pts[s + 1].y;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const steps = Math.floor(len / 15);
      for (let k = 0; k <= steps; k += 1) {
        const f = k / Math.max(1, steps);
        const i = speck;
        speck += 1;
        const lat = (hash01(i, 1) - 0.5) * 36;
        const rad = 1 + hash01(i, 2) * 1.6;
        const a = 0.04 + hash01(i, 3) * 0.09;
        const light = hash01(i, 4) > 0.5;
        ctx.beginPath();
        ctx.arc(ax + dx * f + nx * lat, ay + dy * f + ny * lat, rad, 0, Math.PI * 2);
        ctx.fillStyle = light
          ? 'rgba(255, 255, 255, ' + a.toFixed(2) + ')'
          : 'rgba(0, 0, 0, ' + a.toFixed(2) + ')';
        ctx.fill();
      }
    }
    // Top edge highlight and bottom inner shadow, offset along the
    // up-facing normal of each segment (light falls from above).
    for (let side = 0; side < 2; side += 1) {
      const off = side === 0 ? -19 : 19;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 1) {
        const p = pts[i];
        const q = pts[Math.min(i + 1, pts.length - 1)];
        const r = pts[Math.max(i - 1, 0)];
        const dx = q.x - r.x;
        const dy = q.y - r.y;
        const len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len;
        let ny = dx / len;
        if (ny > 0) { nx = -nx; ny = -ny; }
        const ox = p.x + nx * off;
        const oy = p.y + ny * off;
        if (i === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
      }
      ctx.strokeStyle = side === 0
        ? 'rgba(255, 255, 255, 0.13)'
        : 'rgba(0, 0, 0, 0.32)';
      ctx.lineWidth = side === 0 ? 3 : 4;
      ctx.stroke();
    }
    // Worn centre line down the stones.
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.setLineDash([14, 18]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Flat silhouette of one tower type, in its own colour, for the build
  // ghost preview (drawPlots wraps it in globalAlpha 0.5). Same shapes as
  // drawTower, minus glow, platform and level pips — a preview, not a tower.
  function drawGhostTower(x, y, type) {
    const def = towerDef(type);
    ctx.fillStyle = def.color;
    ctx.strokeStyle = def.color;
    if (type === 'frost') {
      ctx.beginPath();
      ctx.moveTo(x, y - 19);
      ctx.lineTo(x + 15, y);
      ctx.lineTo(x, y + 19);
      ctx.lineTo(x - 15, y);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'storm') {
      ctx.lineWidth = 4;
      for (let k = 0; k < 3; k += 1) {
        ctx.beginPath();
        ctx.arc(x, y + 10 - k * 9, 11 - k * 2, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y - 16, 8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(x, y - 18);
      ctx.lineTo(x - 11, y + 10);
      ctx.lineTo(x + 11, y + 10);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y - 6, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff3d0';
      ctx.fill();
    }
  }

  function drawPlots(state, ui) {
    const plots = PLOTS || [];
    const towers = (state.towers || []);
    for (let i = 0; i < plots.length; i += 1) {
      const plot = plots[i];
      let occupied = false;
      for (let j = 0; j < towers.length; j += 1) {
        if (towers[j].plotIndex === i) { occupied = true; break; }
      }
      if (occupied) continue;
      const hover = ui && ui.hover
        && Math.hypot(ui.hover.x - plot.x, ui.hover.y - plot.y) < 30;
      const selected = ui && ui.selectedPlot === i;
      ctx.beginPath();
      ctx.arc(plot.x, plot.y, 26, 0, Math.PI * 2);
      ctx.fillStyle = hover || selected ? 'rgba(255, 179, 71, 0.22)' : 'rgba(58, 54, 84, 0.45)';
      ctx.fill();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = hover || selected ? AMBER : '#6f6a9e';
      ctx.stroke();
      ctx.setLineDash([]);
      if (hover) {
        // Ghost preview of the tower that would be built here: a flat
        // silhouette of the selected type at 50% alpha, its range ring,
        // and a green/red tint for affordable / not. The '+' marker steps
        // aside while hovering — the preview says more than the plus does.
        const type = (ui && ui.selectedType) || 'ember';
        const cost = towerCost(type);
        const afford = cost !== undefined && (state.shards || 0) >= cost;
        const tint = afford ? '126, 224, 129' : '255, 90, 78';
        ctx.beginPath();
        ctx.arc(plot.x, plot.y, towerRange({ type, level: 1 }), 0, Math.PI * 2);
        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(' + tint + ', 0.45)';
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.5;
        drawGhostTower(plot.x, plot.y, type);
        ctx.globalAlpha = 1;
      } else if (selected) {
        ctx.beginPath();
        ctx.arc(plot.x, plot.y, 20, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 179, 71, 0.85)';
        ctx.font = font(20, '700');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', plot.x, plot.y + 1);
      }
    }
  }

  function drawLantern(state) {
    const t = state.time || 0;
    const flicker = 0.85 + 0.15 * Math.sin(t * 3.1) * Math.sin(t * 1.7 + 2);
    // Layered glow: a wide faint halo plus a tighter bright core, both
    // breathing with the same flicker so the light feels alive.
    const halo = ctx.createRadialGradient(LANTERN.x, LANTERN.y, 6, LANTERN.x, LANTERN.y, 155 * flicker);
    halo.addColorStop(0, 'rgba(255, 179, 71, 0.42)');
    halo.addColorStop(0.45, 'rgba(255, 140, 46, 0.16)');
    halo.addColorStop(1, 'rgba(255, 140, 46, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(LANTERN.x - 160, LANTERN.y - 160, 320, 320);
    const core = ctx.createRadialGradient(LANTERN.x, LANTERN.y, 2, LANTERN.x, LANTERN.y, 72 * flicker);
    core.addColorStop(0, 'rgba(255, 214, 130, 0.75)');
    core.addColorStop(0.6, 'rgba(255, 179, 71, 0.28)');
    core.addColorStop(1, 'rgba(255, 179, 71, 0)');
    ctx.fillStyle = core;
    ctx.fillRect(LANTERN.x - 76, LANTERN.y - 76, 152, 152);
    // Warm light pool on the ground around the post's foot.
    ctx.save();
    ctx.translate(LANTERN.x, LANTERN.y + 34);
    ctx.scale(1, 0.42);
    const pool = ctx.createRadialGradient(0, 0, 2, 0, 0, 78);
    pool.addColorStop(0, 'rgba(255, 179, 71, 0.30)');
    pool.addColorStop(1, 'rgba(255, 179, 71, 0)');
    ctx.fillStyle = pool;
    ctx.fillRect(-80, -80, 160, 160);
    ctx.restore();
    // Ground shadow under the post.
    dropShadow(LANTERN.x, LANTERN.y + 36, 22, 6, 0.45);
    // Post and hanging lantern.
    ctx.strokeStyle = '#4a3a22';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(LANTERN.x, LANTERN.y + 34);
    ctx.lineTo(LANTERN.x, LANTERN.y - 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(LANTERN.x - 16, LANTERN.y - 6);
    ctx.lineTo(LANTERN.x + 16, LANTERN.y - 6);
    ctx.stroke();
    ctx.fillStyle = '#2c2113';
    ctx.fillRect(LANTERN.x - 14, LANTERN.y - 34, 28, 30);
    ctx.fillStyle = AMBER;
    ctx.fillRect(LANTERN.x - 9, LANTERN.y - 30, 18, 22);
    ctx.fillStyle = '#fff3d0';
    ctx.fillRect(LANTERN.x - 4, LANTERN.y - 27, 8, 16);
    // Hot white heart inside the glass so the flame reads as a source.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(LANTERN.x - 2, LANTERN.y - 24, 4, 10);
    // Lives label sits ABOVE the lantern head: the old spot (below the
    // post foot) is painted over by the bottom bar, so it was invisible.
    const lives = state.lives || 0;
    text('x' + lives, LANTERN.x, LANTERN.y - 44, 16, AMBER, 'center');
  }

  function drawTower(t, selected, state) {
    const def = towerDef(t.type);
    const range = towerRange(t);
    if (selected) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, range, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fill();
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 179, 71, 0.8)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Ground shadow first: the tower stands on the field, not in it.
    dropShadow(t.x, t.y + 18, 20, 7);
    // Stone platform, with a thin lit arc along its top edge.
    ctx.beginPath();
    ctx.arc(t.x, t.y, 21, 0, Math.PI * 2);
    ctx.fillStyle = '#241f3d';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = selected ? AMBER : '#4a4470';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(t.x, t.y, 21, Math.PI * 1.12, Math.PI * 1.88);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.stroke();
    // Stronger coloured glow so each tower type reads at a glance.
    const glow = ctx.createRadialGradient(t.x, t.y, 4, t.x, t.y, 42);
    glow.addColorStop(0, def.glow);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = glow;
    ctx.fillRect(t.x - 42, t.y - 42, 84, 84);
    ctx.globalAlpha = 1;
    const angle = t.angle || -Math.PI / 2;
    if (t.type === 'ember') {
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + Math.cos(angle) * 22, t.y + Math.sin(angle) * 22);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(t.x, t.y - 18);
      ctx.lineTo(t.x - 11, t.y + 10);
      ctx.lineTo(t.x + 11, t.y + 10);
      ctx.closePath();
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(t.x, t.y - 6, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff3d0';
      ctx.fill();
    } else if (t.type === 'frost') {
      ctx.beginPath();
      ctx.moveTo(t.x, t.y - 19);
      ctx.lineTo(t.x + 15, t.y);
      ctx.lineTo(t.x, t.y + 19);
      ctx.lineTo(t.x - 15, t.y);
      ctx.closePath();
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.strokeStyle = '#eafcff';
      ctx.lineWidth = 2;
      for (let k = 0; k < 3; k += 1) {
        const a = (k * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(t.x - Math.cos(a) * 9, t.y - Math.sin(a) * 9);
        ctx.lineTo(t.x + Math.cos(a) * 9, t.y + Math.sin(a) * 9);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(t.x, t.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else {
      // Storm coil: stacked arcs topped by a crackling orb.
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 4;
      for (let k = 0; k < 3; k += 1) {
        ctx.beginPath();
        ctx.arc(t.x, t.y + 10 - k * 9, 11 - k * 2, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(t.x, t.y - 16, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#efe2ff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(t.x, t.y - 16, 4, 0, Math.PI * 2);
      ctx.fillStyle = def.color;
      ctx.fill();
    }
    // Muzzle glow while this tower has a shot in the air. Read-only: the
    // projectile list is only observed, never mutated. Chain links carry
    // fromX/fromY + a life fraction; bolts carry their tower, so the glow
    // sits at the muzzle tip while the bolt flies.
    const projs = (state && state.projectiles) || [];
    for (let i = 0; i < projs.length; i += 1) {
      const p = projs[i];
      if (p.fromX !== undefined && p.fromY !== undefined && p.life !== undefined && p.maxLife) {
        const d = Math.hypot(p.fromX - t.x, p.fromY - t.y);
        if (d < 10) {
          const frac = Math.max(0, Math.min(1, p.life / p.maxLife));
          const mg = ctx.createRadialGradient(p.fromX, p.fromY, 1, p.fromX, p.fromY, 12 + 22 * frac);
          mg.addColorStop(0, 'rgba(255, 255, 255, ' + (0.85 * frac).toFixed(2) + ')');
          mg.addColorStop(0.4, def.glow);
          mg.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.globalAlpha = 0.9 * frac;
          ctx.fillStyle = mg;
          ctx.fillRect(p.fromX - 36, p.fromY - 36, 72, 72);
          ctx.globalAlpha = 1;
        }
      } else if (p.tower === t) {
        const mx = t.x + Math.cos(angle) * 22;
        const my = t.y + Math.sin(angle) * 22;
        const mg = ctx.createRadialGradient(mx, my, 1, mx, my, 18);
        mg.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
        mg.addColorStop(0.5, def.glow);
        mg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = mg;
        ctx.fillRect(mx - 18, my - 18, 36, 36);
        ctx.globalAlpha = 1;
      }
    }
    // Level pips above the tower.
    for (let p = 0; p < 3; p += 1) {
      ctx.beginPath();
      ctx.arc(t.x - 12 + p * 12, t.y - 30, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = p < (t.level || 1) ? AMBER : '#3a3654';
      ctx.fill();
    }
  }

  function drawEnemy(e, state) {
    const r = e.radius || 14;
    const chilled = e.slowUntil && state.time !== undefined && e.slowUntil > state.time;
    const eye = EYE_COLOR[e.kind] || '#ffffff';
    // Boss aura.
    if (e.kind === 'wraith') {
      const aura = ctx.createRadialGradient(e.x, e.y, 4, e.x, e.y, r + 26);
      aura.addColorStop(0, 'rgba(182, 120, 255, 0.4)');
      aura.addColorStop(1, 'rgba(182, 120, 255, 0)');
      ctx.fillStyle = aura;
      ctx.fillRect(e.x - r - 26, e.y - r - 26, (r + 26) * 2, (r + 26) * 2);
    }
    // Ground shadow so the shadow creature still casts one.
    dropShadow(e.x, e.y + r * 0.75, r * 0.9, r * 0.32);
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, r, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = chilled ? '#2a4a5e' : '#2a2438';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = chilled ? FROST : '#4a3f6e';
    ctx.stroke();
    // Bright rim along the top edge: the body catches the sky light, so
    // the silhouette separates from the dark path underneath.
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, r, r * 0.85, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.lineWidth = 2;
    ctx.strokeStyle = chilled ? 'rgba(159, 232, 255, 0.55)' : 'rgba(190, 175, 255, 0.38)';
    ctx.stroke();
    // Facing: toward the next waypoint, so the eyes lead the walk.
    const pts = PATH_POINTS || [];
    const next = pts[Math.min((e.waypointIndex || 0) + 1, pts.length - 1)] || pts[pts.length - 1];
    let fx = 1;
    let fy = 0;
    if (next) {
      const dx = next.x - e.x;
      const dy = next.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      fx = dx / len;
      fy = dy / len;
    }
    const px = -fy;
    const py = fx;
    // Glowing eyes: a small shadowBlur so they bloom against the dark body.
    ctx.save();
    ctx.shadowColor = eye;
    ctx.shadowBlur = 8;
    for (let s = -1; s <= 1; s += 2) {
      const ex = e.x + fx * r * 0.35 + px * s * r * 0.38;
      const ey = e.y + fy * r * 0.35 + py * s * r * 0.38;
      ctx.beginPath();
      ctx.arc(ex, ey, e.kind === 'wraith' ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = eye;
      ctx.fill();
    }
    ctx.restore();
    if (chilled) {
      ctx.beginPath();
      ctx.arc(e.x, e.y, r + 4, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(79, 216, 255, 0.8)';
      ctx.stroke();
    }
    // HP bar for the tough ones, and for anything already hurt.
    if (e.kind === 'brute' || e.kind === 'wraith' || (e.maxHp && e.hp < e.maxHp)) {
      const bw = e.kind === 'wraith' ? 52 : 36;
      const bx = e.x - bw / 2;
      const by = e.y - r - 12;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(bx, by, bw, 5);
      const frac = Math.max(0, Math.min(1, e.hp / (e.maxHp || 1)));
      ctx.fillStyle = e.kind === 'wraith' ? STORM : (frac > 0.5 ? '#7ee081' : '#ff5a4e');
      ctx.fillRect(bx, by, bw * frac, 5);
    }
  }

  function drawProjectiles(state) {
    // The fx layer observes exactly one paint per draw call: update it
    // here, before anything draws, so the kill bursts it spawns from this
    // state are painted by drawParticles below, from the same state.
    updateFx(fx, state);
    const list = state.projectiles || [];
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      const alpha = p.maxLife ? Math.max(0, Math.min(1, p.life / p.maxLife)) : 1;
      if (p.kind === 'chain') {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = STORM;
        ctx.lineWidth = 3;
        ctx.beginPath();
        const segs = 5;
        ctx.moveTo(p.fromX, p.fromY);
        for (let s = 1; s < segs; s += 1) {
          const f = s / segs;
          const mx = p.fromX + (p.toX - p.fromX) * f;
          const my = p.fromY + (p.toY - p.fromY) * f;
          const jog = (s % 2 === 0 ? 7 : -7);
          ctx.lineTo(mx + jog, my - jog * 0.5);
        }
        ctx.lineTo(p.toX, p.toY);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = AMBER;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.fromX !== undefined ? p.fromX : p.x, p.fromY !== undefined ? p.fromY : p.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff3d0';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawParticles(state) {
    const list = state.particles || [];
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      const alpha = p.maxLife ? Math.max(0, p.life / p.maxLife) : 1;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size || 3, 0, Math.PI * 2);
      ctx.fillStyle = p.color || AMBER;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const floats = state.floaters || [];
    for (let i = 0; i < floats.length; i += 1) {
      const f = floats[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life || 0));
      text(f.text, f.x, f.y, 17, f.color || AMBER, 'center');
    }
    ctx.globalAlpha = 1;
    // Renderer-local kill bursts (fx.js): type-flavoured sparks at the
    // exact spot an enemy died. Drawn last so they read over the field.
    drawFx(ctx, fx);
  }

  function drawHud(state) {
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, W, HUD_H);
    // Thin top highlight so the bar reads as a raised panel, not a slab.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fillRect(0, 0, W, 1);
    ctx.fillStyle = AMBER;
    ctx.fillRect(0, HUD_H - 2, W, 2);
    text('Wave ' + (state.wave || 1) + '/15', 16, 29, 20, INK, 'left');
    text('Shards ' + (state.shards || 0), 150, 29, 20, AMBER, 'left');
    text('Lantern ' + (state.lives || 0), 320, 29, 20, (state.lives || 0) <= 5 ? '#ff5a4e' : INK, 'left');
    text('Score ' + (state.score || 0), 480, 29, 20, INK, 'left');
    text('Foes left ' + enemiesLeft(state), 944, 29, 20, INK, 'right');
  }

  function drawBottomBar(state, ui) {
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, BAR_Y, W, BAR_H);
    // Thin top highlight, matching the HUD bar.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fillRect(0, BAR_Y, W, 1);
    ctx.fillStyle = AMBER;
    ctx.fillRect(0, BAR_Y, W, 2);
    for (let i = 0; i < TOWER_CARDS.length; i += 1) {
      const card = TOWER_CARDS[i];
      const rect = towerCardRect(i);
      const selected = ui && ui.selectedType === card.key;
      const afford = (state.shards || 0) >= card.cost;
      const hovered = ui && ui.hover && pointInRect(ui.hover.x, ui.hover.y, rect);
      roundRectPath(rect.x, rect.y, rect.w, rect.h, 8);
      if (selected) {
        // Amber halo behind the selected card so the active choice glows.
        ctx.save();
        ctx.shadowColor = AMBER;
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#33284f';
        ctx.fill();
        ctx.restore();
      } else if (hovered) {
        // Hovered card lifts a little: lighter fill, brighter edge.
        ctx.fillStyle = '#1e1938';
        ctx.fill();
      } else {
        ctx.fillStyle = '#17142e';
        ctx.fill();
      }
      ctx.lineWidth = selected ? 3 : 2;
      ctx.strokeStyle = selected ? AMBER : hovered ? '#8a84b8' : (afford ? '#4a4470' : '#2e2a52');
      ctx.stroke();
      if (selected) {
        // Lit top edge on the chosen card.
        ctx.beginPath();
        ctx.moveTo(rect.x + 12, rect.y + 1);
        ctx.lineTo(rect.x + rect.w - 12, rect.y + 1);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.stroke();
      }
      // Hotkey badge.
      ctx.beginPath();
      ctx.arc(rect.x + 20, rect.y + 20, 11, 0, Math.PI * 2);
      ctx.fillStyle = card.color;
      ctx.fill();
      text(card.hotkey, rect.x + 20, rect.y + 26, 15, '#14132b', 'center');
      text(card.name, rect.x + 38, rect.y + 26, 17, afford || selected ? INK : DIM, 'left');
      text(card.cost + ' shards', rect.x + 16, rect.y + 52, 16, afford ? AMBER : DIM, 'left');
      text(card.desc, rect.x + 16, rect.y + 72, 13, DIM, 'left', '400');
    }
  }

  // Small tooltip next to the cursor while hovering a tower card: name,
  // cost and level-1 damage, all from the rules (towers.js) so the numbers
  // can never disagree with the game. Drawn last on the play screen,
  // clamped inside the canvas so it never runs off an edge.
  function drawCardTooltip(state, ui) {
    const hover = ui && ui.hover;
    if (!hover) return;
    let card = null;
    for (let i = 0; i < TOWER_CARDS.length; i += 1) {
      if (pointInRect(hover.x, hover.y, towerCardRect(i))) { card = TOWER_CARDS[i]; break; }
    }
    if (!card) return;
    const damage = Math.round(towerDamage({ type: card.key, level: 1 }));
    const tw = 204;
    const th = 84;
    let tx = hover.x + 16;
    let ty = hover.y + 16;
    if (tx + tw > W) tx = hover.x - tw - 16;
    if (ty + th > H) ty = hover.y - th - 16;
    if (tx < 4) tx = 4;
    if (ty < HUD_H + 4) ty = HUD_H + 4;
    // Never occlude the bottom-bar buttons (Send wave / Auto-send / Pause /
    // Mute, x >= 584, y >= BAR_Y): if the box would dip into that strip,
    // lift it clear above the bar instead.
    if (tx + tw > 584 && tx < 948 && ty + th > BAR_Y) ty = BAR_Y - th - 8;
    roundRectPath(tx, ty, tw, th, 8);
    ctx.fillStyle = 'rgba(14, 13, 32, 0.95)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = card.color;
    ctx.stroke();
    text(card.name, tx + 12, ty + 24, 16, INK, 'left');
    text(card.cost + ' shards  •  Damage ' + damage, tx + 12, ty + 48, 14, AMBER, 'left', '400');
    text(card.desc, tx + 12, ty + 70, 13, DIM, 'left', '400');
  }

  function drawSelectionPanel(state, ui, screen) {
    // The panel is a play-screen control: under the paused overlay its
    // upgrade/sell buttons would be drawn but not hit-testable, so hide it.
    if (screen !== SCREEN_PLAY) return;
    const tower = resolveTower(state, ui);
    if (!tower) return;
    const def = towerDef(tower.type);
    const level = tower.level || 1;
    const px = 12;
    const py = 316;
    const pw = 244;
    const ph = 180;
    roundRectPath(px, py, pw, ph, 10);
    ctx.fillStyle = 'rgba(14, 13, 32, 0.94)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = AMBER;
    ctx.stroke();
    text(def.name, px + 16, py + 28, 19, INK, 'left');
    text('Level ' + level + ' / 3', px + 16, py + 52, 16, def.color, 'left');
    text('Damage ' + Math.round(towerDamage(tower)), px + 16, py + 76, 16, INK, 'left');
    text('Range ' + Math.round(towerRange(tower)), px + 16, py + 100, 16, INK, 'left');
    text('Kills ' + (tower.kills || 0), px + 16, py + 124, 16, DIM, 'left');
    const buttons = getButtons(SCREEN_PLAY, state, ui);
    for (let i = 0; i < buttons.length; i += 1) {
      if (buttons[i].id === 'upgrade' || buttons[i].id === 'sell') button(buttons[i]);
    }
  }

  function drawPlayField(state, ui) {
    drawField(state);
    drawPath();
    drawPlots(state, ui);
    drawLantern(state);
    const towers = state.towers || [];
    const sel = resolveTower(state, ui);
    for (let i = 0; i < towers.length; i += 1) {
      drawTower(towers[i], sel === towers[i], state);
    }
    const enemies = state.enemies || [];
    for (let i = 0; i < enemies.length; i += 1) drawEnemy(enemies[i], state);
    drawProjectiles(state);
    drawParticles(state);
  }

  function drawTitle(state, ui, best) {
    drawPlayField(state, ui);
    dimScreen(0.72);
    ctx.save();
    ctx.shadowColor = AMBER;
    ctx.shadowBlur = 28;
    text('LANTERNFALL', W / 2, 150, 64, AMBER, 'center');
    ctx.restore();
    text('Defend the last lantern — build towers, hold the path.', W / 2, 196, 21, INK, 'center');
    text('Click a plot to build  •  1 / 2 / 3 choose tower  •  Enter send wave', W / 2, 238, 18, DIM, 'center', '400');
    text('Space pause  •  Esc deselect  •  M mute  •  R restart', W / 2, 266, 18, DIM, 'center', '400');
    text('15 waves. The lantern has 20 lives. Hold the light.', W / 2, 306, 18, INK, 'center', '400');
    if (best) text('Best score: ' + best, W / 2, 344, 20, AMBER, 'center');
    const buttons = getButtons(SCREEN_TITLE, state, ui);
    for (let i = 0; i < buttons.length; i += 1) button(buttons[i]);
  }

  function drawEndPanel(title, titleColor, lines, screen, state, ui) {
    dimScreen(0.6);
    const pw = 520;
    const ph = 340;
    const px = (W - pw) / 2;
    const py = 110;
    roundRectPath(px, py, pw, ph, 12);
    ctx.fillStyle = PANEL_BG;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = titleColor;
    ctx.stroke();
    text(title, W / 2, py + 66, 44, titleColor, 'center');
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], W / 2, py + 118 + i * 34, 21, INK, 'center', '400');
    }
    const buttons = getButtons(screen, state, ui);
    for (let i = 0; i < buttons.length; i += 1) button(buttons[i]);
  }

  function draw(state, ui, screen, best) {
    const s = state || {};
    const u = ui || {};
    if (!s.towers) s.towers = [];
    if (!s.enemies) s.enemies = [];
    if (screen === SCREEN_TITLE) {
      drawTitle(s, u, best || 0);
      return;
    }
    drawPlayField(s, u);
    drawHud(s);
    drawBottomBar(s, u);
    if (screen === SCREEN_PLAY) {
      drawSelectionPanel(s, u, screen);
      // Bottom-bar control buttons (send wave, auto-send, pause, mute).
      // Only on the play screen: the paused overlay has its own buttons and
      // getButtons('paused') must stay the only hit-test list there.
      const buttons = getButtons(SCREEN_PLAY, s, u);
      for (let i = 0; i < buttons.length; i += 1) {
        const b = buttons[i];
        if (b.id === 'upgrade' || b.id === 'sell') continue;
        button(b);
      }
      drawCardTooltip(s, u);
    }
    if (s.waveState === 'build' && screen === SCREEN_PLAY) {
      text('Build phase — place towers, then send the wave.', W / 2, HUD_H + 26, 17, AMBER, 'center', '400');
    }
    if (screen === SCREEN_PAUSED) {
      dimScreen(0.6);
      text('PAUSED', W / 2, 240, 48, INK, 'center');
      text('The shadows wait.', W / 2, 278, 19, DIM, 'center', '400');
      const pb = getButtons(SCREEN_PAUSED, s, u);
      for (let i = 0; i < pb.length; i += 1) button(pb[i]);
    } else if (screen === SCREEN_VICTORY) {
      drawEndPanel('VICTORY!', AMBER, [
        'The lantern still burns.',
        'Score: ' + (s.score || 0),
        'Waves cleared: ' + (s.wavesCleared || 15) + ' / 15',
        'Shards earned: ' + (s.shardsEarned || 0),
        'Best score: ' + (best || s.score || 0),
      ], SCREEN_VICTORY, s, u);
    } else if (screen === SCREEN_OVER) {
      drawEndPanel('THE LANTERN FALLS', '#ff5a4e', [
        'The shadows took the light on wave ' + (s.wave || 1) + '.',
        'Score: ' + (s.score || 0),
        'Waves cleared: ' + (s.wavesCleared || 0) + ' / 15',
        'Best score: ' + (best || s.score || 0),
      ], SCREEN_OVER, s, u);
    }
  }

  return { draw, canvas };
}
