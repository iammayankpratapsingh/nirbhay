import { PEN, SHOT, TABLE, VIEW, type PenColor } from '../shared/constants';

type Ctx = CanvasRenderingContext2D;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let woodCache: HTMLCanvasElement | null = null;

/** Procedural warm wood tabletop, generated once. */
export function woodTexture(): HTMLCanvasElement {
  if (woodCache) return woodCache;
  const k = 2;
  const c = document.createElement('canvas');
  c.width = TABLE.w * k;
  c.height = TABLE.h * k;
  const g = c.getContext('2d')!;
  g.scale(k, k);
  const rand = mulberry32(20_07);

  const base = g.createLinearGradient(0, 0, TABLE.w, TABLE.h);
  base.addColorStop(0, '#d29a5e');
  base.addColorStop(0.5, '#c0814a');
  base.addColorStop(1, '#b0703d');
  g.fillStyle = base;
  g.fillRect(0, 0, TABLE.w, TABLE.h);

  const planks = 5;
  const ph = TABLE.h / planks;
  for (let p = 0; p < planks; p++) {
    const y0 = p * ph;
    g.fillStyle = `rgba(${rand() > 0.5 ? '255,220,170' : '90,45,15'},${0.04 + rand() * 0.06})`;
    g.fillRect(0, y0, TABLE.w, ph);
    // Grain lines
    for (let i = 0; i < 46; i++) {
      const yy = y0 + rand() * ph;
      const amp = 1.5 + rand() * 4;
      const freq = 0.004 + rand() * 0.01;
      const phase = rand() * Math.PI * 2;
      g.beginPath();
      for (let x = 0; x <= TABLE.w; x += 8) {
        const y = yy + Math.sin(x * freq + phase) * amp + Math.sin(x * 0.03 + phase * 2) * 0.6;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = `rgba(95,48,18,${0.05 + rand() * 0.13})`;
      g.lineWidth = 0.6 + rand() * 1.8;
      g.stroke();
    }
    // Knots
    if (rand() > 0.35) {
      const kx = 80 + rand() * (TABLE.w - 160);
      const ky = y0 + ph * (0.3 + rand() * 0.4);
      for (let r = 1; r <= 6; r++) {
        g.beginPath();
        g.ellipse(kx, ky, r * 5.5, r * 2.2, 0, 0, Math.PI * 2);
        g.strokeStyle = `rgba(85,40,12,${0.22 - r * 0.028})`;
        g.lineWidth = 1.2;
        g.stroke();
      }
      g.beginPath();
      g.ellipse(kx, ky, 4, 1.8, 0, 0, Math.PI * 2);
      g.fillStyle = 'rgba(70,32,10,0.45)';
      g.fill();
    }
    // Plank seam
    if (p > 0) {
      g.fillStyle = 'rgba(60,28,8,0.45)';
      g.fillRect(0, y0 - 0.8, TABLE.w, 1.6);
      g.fillStyle = 'rgba(255,225,180,0.18)';
      g.fillRect(0, y0 + 0.8, TABLE.w, 1);
    }
  }
  // Fine speckle
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(70,35,10,${rand() * 0.08})`;
    g.fillRect(rand() * TABLE.w, rand() * TABLE.h, 1.4, 0.7);
  }
  // Varnish sheen + vignette
  const sheen = g.createLinearGradient(0, 0, TABLE.w * 0.6, TABLE.h);
  sheen.addColorStop(0, 'rgba(255,240,210,0.16)');
  sheen.addColorStop(0.45, 'rgba(255,240,210,0)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, TABLE.w, TABLE.h);
  const vig = g.createRadialGradient(TABLE.w / 2, TABLE.h / 2, TABLE.h * 0.3, TABLE.w / 2, TABLE.h / 2, TABLE.w * 0.65);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(40,15,0,0.28)');
  g.fillStyle = vig;
  g.fillRect(0, 0, TABLE.w, TABLE.h);
  woodCache = c;
  return c;
}

export function drawFloor(ctx: Ctx) {
  const g = ctx.createRadialGradient(TABLE.w / 2, TABLE.h / 2, 100, TABLE.w / 2, TABLE.h / 2, VIEW.w * 0.7);
  g.addColorStop(0, '#163a2b');
  g.addColorStop(1, '#0a1c14');
  ctx.fillStyle = g;
  ctx.fillRect(VIEW.x - 400, VIEW.y - 400, VIEW.w + 800, VIEW.h + 800);
  // faint floor tiles
  ctx.strokeStyle = 'rgba(182,242,74,0.045)';
  ctx.lineWidth = 1;
  for (let x = VIEW.x - 400; x < VIEW.x + VIEW.w + 400; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, VIEW.y - 400);
    ctx.lineTo(x, VIEW.y + VIEW.h + 400);
    ctx.stroke();
  }
  for (let y = VIEW.y - 400; y < VIEW.y + VIEW.h + 400; y += 60) {
    ctx.beginPath();
    ctx.moveTo(VIEW.x - 400, y);
    ctx.lineTo(VIEW.x + VIEW.w + 400, y);
    ctx.stroke();
  }
}

export function drawTable(ctx: Ctx, px: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 40 * px;
  ctx.shadowOffsetY = 18 * px;
  ctx.fillStyle = '#7a4520';
  ctx.fillRect(TABLE.x, TABLE.y, TABLE.w, TABLE.h + 12);
  ctx.restore();
  // Front edge thickness
  const edge = ctx.createLinearGradient(0, TABLE.h, 0, TABLE.h + 12);
  edge.addColorStop(0, '#8a5128');
  edge.addColorStop(1, '#4e2a10');
  ctx.fillStyle = edge;
  ctx.fillRect(TABLE.x, TABLE.h, TABLE.w, 12);
  ctx.drawImage(woodTexture(), TABLE.x, TABLE.y, TABLE.w, TABLE.h);
  // Bevel
  ctx.strokeStyle = 'rgba(255,228,190,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(TABLE.x + 1, TABLE.h);
  ctx.lineTo(TABLE.x + 1, TABLE.y + 1);
  ctx.lineTo(TABLE.w - 1, TABLE.y + 1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(60,25,5,0.5)';
  ctx.beginPath();
  ctx.moveTo(TABLE.w - 1, TABLE.y + 1);
  ctx.lineTo(TABLE.w - 1, TABLE.h - 1);
  ctx.lineTo(TABLE.x + 1, TABLE.h - 1);
  ctx.stroke();
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function metal(ctx: Ctx, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#f7f9fb');
  g.addColorStop(0.35, '#b9c1c9');
  g.addColorStop(0.6, '#eef1f4');
  g.addColorStop(1, '#6b737c');
  return g;
}

export interface PenDrawOpts {
  alpha?: number;
  scale?: number;
  glow?: number; // 0..1
  /** World units per device pixel inverse (for shadows). */
  px: number;
  /** Shadow offset in world units. */
  lift?: number;
}

/** Top-down pen: metallic tip, rubber grip, barrel, cap with clip. Tip at -x. */
export function drawPen(ctx: Ctx, x: number, y: number, angle: number, color: PenColor, o: PenDrawOpts) {
  const L = PEN.length;
  const W = PEN.width;
  const h = L / 2;
  const scale = o.scale ?? 1;
  const lift = o.lift ?? 1;
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;

  // Drop shadow (cast down-right, independent of pen rotation)
  ctx.save();
  ctx.translate(x + 5 * lift, y + 7 * lift);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.filter = 'none';
  ctx.fillStyle = `rgba(20,8,0,${0.28 + 0.1 * Math.min(lift, 2)})`;
  ctx.shadowColor = 'rgba(20,8,0,0.5)';
  ctx.shadowBlur = 6 * lift * o.px;
  rr(ctx, -h, -W / 2 + 1, L, W - 2, W / 2);
  ctx.fill();
  ctx.restore();

  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  if (o.glow && o.glow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(182,242,74,${0.85 * o.glow})`;
    ctx.shadowBlur = 22 * o.px;
    ctx.strokeStyle = `rgba(210,255,140,${0.75 * o.glow})`;
    ctx.lineWidth = 3;
    rr(ctx, -h - 6, -W / 2 - 6, L + 12, W + 12, W / 2 + 6);
    ctx.stroke();
    ctx.restore();
  }

  // Metallic tip cone
  ctx.beginPath();
  ctx.moveTo(-h + 1, -1.6);
  ctx.lineTo(-h + 19, -6.5);
  ctx.lineTo(-h + 19, 6.5);
  ctx.lineTo(-h + 1, 1.6);
  ctx.closePath();
  ctx.fillStyle = metal(ctx, -6.5, 6.5);
  ctx.fill();
  ctx.fillStyle = '#1b1b1f';
  ctx.beginPath();
  ctx.arc(-h + 1.4, 0, 1.7, 0, Math.PI * 2);
  ctx.fill();

  // Grip
  rr(ctx, -h + 17, -7.5, 32, 15, 4);
  const grip = ctx.createLinearGradient(0, -7.5, 0, 7.5);
  grip.addColorStop(0, '#4a4f55');
  grip.addColorStop(0.4, '#2a2e33');
  grip.addColorStop(1, '#14171a');
  ctx.fillStyle = grip;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let gx = -h + 21; gx < -h + 47; gx += 4) {
    ctx.beginPath();
    ctx.moveTo(gx, -6.5);
    ctx.lineTo(gx, 6.5);
    ctx.stroke();
  }

  // Barrel
  const barrel = ctx.createLinearGradient(0, -8, 0, 8);
  barrel.addColorStop(0, color.light);
  barrel.addColorStop(0.35, color.base);
  barrel.addColorStop(1, color.dark);
  rr(ctx, -h + 46, -8, 88, 16, 3);
  ctx.fillStyle = barrel;
  ctx.fill();

  // Cap
  const cap = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
  cap.addColorStop(0, color.light);
  cap.addColorStop(0.3, color.base);
  cap.addColorStop(0.75, color.dark);
  cap.addColorStop(1, '#00000055');
  rr(ctx, h - 56, -W / 2, 56, W, [3, W / 2, W / 2, 3]);
  ctx.fillStyle = cap;
  ctx.fill();
  // Cap ring
  rr(ctx, h - 58, -W / 2 - 0.5, 5, W + 1, 1.5);
  ctx.fillStyle = metal(ctx, -W / 2, W / 2);
  ctx.fill();
  // Clip (seen from above: a metal strip along the cap with a ball end)
  rr(ctx, h - 46, -2.6, 42, 5.2, 2.6);
  ctx.fillStyle = metal(ctx, -2.6, 2.6);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(h - 45, 0, 3.6, 0, Math.PI * 2);
  ctx.fillStyle = metal(ctx, -3.6, 3.6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Specular highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-h + 50, -4.5);
  ctx.lineTo(h - 8, -4.5);
  ctx.stroke();
  ctx.restore();
}

export function powerColor(p: number): string {
  const hue = 85 - p * 75;
  return `hsl(${hue} 90% 58%)`;
}

export interface AimDraw {
  from: { x: number; y: number };
  angle: number;
  power: number;
  /** Grab point and pointer for the rubber band (omit for AI preview). */
  band?: { a: { x: number; y: number }; b: { x: number; y: number } };
}

export function drawAim(ctx: Ctx, aim: AimDraw, px: number) {
  const { from, angle, power } = aim;
  const col = powerColor(power);
  ctx.save();
  if (aim.band) {
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(aim.band.a.x, aim.band.a.y);
    ctx.lineTo(aim.band.b.x, aim.band.b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(aim.band.b.x, aim.band.b.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
  }
  const len = 70 + power * (SHOT.maxDrag + 30);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Dotted travel guide
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (let d = len + 22; d < len + 22 + 160 * power; d += 18) {
    ctx.beginPath();
    ctx.arc(from.x + dx * d, from.y + dy * d, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.translate(from.x, from.y);
  ctx.rotate(angle);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 6 * px;
  ctx.shadowOffsetY = 2 * px;
  ctx.beginPath();
  ctx.moveTo(18, -4);
  ctx.lineTo(len - 22, -7);
  ctx.lineTo(len - 22, -16);
  ctx.lineTo(len + 6, 0);
  ctx.lineTo(len - 22, 16);
  ctx.lineTo(len - 22, 7);
  ctx.lineTo(18, 4);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(10,30,15,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Screen-space label (never rotated with the view). */
export function drawTag(ctx: Ctx, sx: number, sy: number, text: string, color: string, active: boolean, dpr: number) {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = '700 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 18;
  const h = 22;
  const x = Math.round(sx - w / 2);
  const y = Math.round(sy - h / 2);
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 11);
  ctx.fillStyle = active ? '#b6f24a' : 'rgba(8,24,17,0.88)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = active ? '#0c1f10' : '#eaf5ee';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, sx, y + h / 2 + 0.5);
  ctx.restore();
}
