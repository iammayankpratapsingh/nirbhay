/** World units are arbitrary "pixels" of a 1000 x 620 tabletop. */
export const TABLE = { x: 0, y: 0, w: 1000, h: 620 } as const;

/** The visible area around the table (the floor pens fall onto). */
export const VIEW = { x: -90, y: -90, w: 1180, h: 800 } as const;

export const PEN = {
  length: 168,
  width: 18,
  density: 0.002,
  restitution: 0.55,
  friction: 0.04,
  /** Linear + angular damping that models the table surface. */
  tableFriction: 0.032,
} as const;

export const SHOT = {
  /** Drag distance (world units) that reaches 100% power. */
  maxDrag: 230,
  /** Speed at 100% power, in world units per 1/60 s. */
  maxSpeed: 27,
  /** Spin at 100% power when hit at the very end of the pen (rad per 1/60 s). */
  maxSpin: 0.32,
  /** Shots weaker than this are treated as a cancelled aim. */
  minPower: 0.04,
} as const;

export const SIM = {
  frameMs: 1000 / 60,
  substeps: 3,
  settleSpeed: 0.05,
  settleAngular: 0.0015,
  settleFrames: 18,
  /** Hard cap so a shot always ends (10 s). */
  maxShotFrames: 600,
  /** Outward slide applied once a pen's centre of mass is past the edge (it tips). */
  tipAccel: 0.12,
} as const;

export type PenColorId = 'ice' | 'coral' | 'lime' | 'lavender' | 'gold';

export interface PenColor {
  id: PenColorId;
  label: string;
  base: string;
  light: string;
  dark: string;
}

export const PEN_COLORS: readonly PenColor[] = [
  { id: 'ice', label: 'Ice blue', base: '#7cc8f2', light: '#cdeeff', dark: '#2f7fae' },
  { id: 'coral', label: 'Coral', base: '#ff7a63', light: '#ffc4b8', dark: '#c2412c' },
  { id: 'lime', label: 'Lime', base: '#a6e23a', light: '#e2ffa8', dark: '#5f8f12' },
  { id: 'lavender', label: 'Lavender', base: '#b29cff', light: '#e4dbff', dark: '#6b52c9' },
  { id: 'gold', label: 'Gold', base: '#f2c13b', light: '#fff0b3', dark: '#a87a0c' },
];

export const COLOR_IDS = PEN_COLORS.map((c) => c.id);

export function penColor(id: string): PenColor {
  return PEN_COLORS.find((c) => c.id === id) ?? PEN_COLORS[0];
}

export function isColorId(v: unknown): v is PenColorId {
  return typeof v === 'string' && (COLOR_IDS as string[]).includes(v);
}

/** Returns `wanted` unless the opponent already has it, then the next free colour. */
export function distinctColor(wanted: PenColorId, taken: PenColorId | null): PenColorId {
  if (wanted !== taken) return wanted;
  const idx = COLOR_IDS.indexOf(wanted);
  return COLOR_IDS[(idx + 1) % COLOR_IDS.length];
}

export const NAME_MAX = 16;

export function sanitizeName(raw: unknown, fallback = 'Player'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return cleaned || fallback;
}
