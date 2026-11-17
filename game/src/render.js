// LANTERNFALL presentation layer — every pixel on the 960x600 canvas.
// Draws the night field, the winding stone path, plots, towers, shadow
// enemies, projectiles, particles, HUD, tower bar, selection panel and all
// screens. Canvas 2D only: no images, no external fonts, no network.
// The geometry of every clickable button lives in getButtons() below and
// main.js hit-tests against that same list, so art and input can never drift.
import { PATH_POINTS, PLOTS, LANTERN } from './config.js';
import { upgradeCost, sellValue, towerDamage, towerRange } from './towers.js';

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

  // Deterministic starfield: positions from index arithmetic, never random.
  function drawField(state) {
    ctx.fillStyle = '#14132b';
    ctx.fillRect(0, 0, W, H);
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
  }

  function drawPath() {
    const pts = PATH_POINTS || [];
    if (pts.length < 2) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = '#241f3d';
    ctx.lineWidth = 54;
    ctx.stroke();
    ctx.strokeStyle = '#3a3654';
    ctx.lineWidth = 44;
    ctx.stroke();
    // Worn centre line down the stones.
    ctx.setLineDash([14, 18]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
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
      if (hover || selected) {
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
    const glow = ctx.createRadialGradient(LANTERN.x, LANTERN.y, 6, LANTERN.x, LANTERN.y, 110 * flicker);
    glow.addColorStop(0, 'rgba(255, 179, 71, 0.55)');
    glow.addColorStop(0.5, 'rgba(255, 140, 46, 0.18)');
    glow.addColorStop(1, 'rgba(255, 140, 46, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(LANTERN.x - 115, LANTERN.y - 115, 230, 230);
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
    const lives = state.lives || 0;
    text('x' + lives, LANTERN.x, LANTERN.y + 56, 16, AMBER, 'center');
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
    // Stone platform.
    ctx.beginPath();
    ctx.arc(t.x, t.y, 21, 0, Math.PI * 2);
    ctx.fillStyle = '#241f3d';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = selected ? AMBER : '#4a4470';
    ctx.stroke();
    const glow = ctx.createRadialGradient(t.x, t.y, 4, t.x, t.y, 34);
    glow.addColorStop(0, def.glow);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = glow;
    ctx.fillRect(t.x - 34, t.y - 34, 68, 68);
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
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, r, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = chilled ? '#2a4a5e' : '#2a2438';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = chilled ? FROST : '#4a3f6e';
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
    for (let s = -1; s <= 1; s += 2) {
      const ex = e.x + fx * r * 0.35 + px * s * r * 0.38;
      const ey = e.y + fy * r * 0.35 + py * s * r * 0.38;
      ctx.beginPath();
      ctx.arc(ex, ey, e.kind === 'wraith' ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = eye;
      ctx.fill();
    }
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
  }

  function drawHud(state) {
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, W, HUD_H);
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
    ctx.fillStyle = AMBER;
    ctx.fillRect(0, BAR_Y, W, 2);
    for (let i = 0; i < TOWER_CARDS.length; i += 1) {
      const card = TOWER_CARDS[i];
      const rect = towerCardRect(i);
      const selected = ui && ui.selectedType === card.key;
      const afford = (state.shards || 0) >= card.cost;
      roundRectPath(rect.x, rect.y, rect.w, rect.h, 8);
      ctx.fillStyle = selected ? '#33284f' : '#17142e';
      ctx.fill();
      ctx.lineWidth = selected ? 3 : 2;
      ctx.strokeStyle = selected ? AMBER : (afford ? '#4a4470' : '#2e2a52');
      ctx.stroke();
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
