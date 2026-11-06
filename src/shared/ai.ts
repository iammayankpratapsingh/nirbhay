import { PEN, TABLE } from './constants';
import { edgeDistance } from './geometry';
import { Match, type Seat } from './match';
import type { PenState, Shot } from './physics';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Profile {
  candidates: number;
  /** Execution error added to the chosen shot (radians, 1 sigma-ish). */
  angleNoise: number;
  powerNoise: number;
  powerRange: [number, number];
  /** Pick randomly from the best N candidates. */
  pickFrom: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { candidates: 6, angleNoise: 0.3, powerNoise: 0.25, powerRange: [0.35, 0.75], pickFrom: 4 },
  normal: { candidates: 16, angleNoise: 0.1, powerNoise: 0.1, powerRange: [0.45, 0.95], pickFrom: 2 },
  hard: { candidates: 42, angleNoise: 0.025, powerNoise: 0.03, powerRange: [0.55, 1], pickFrom: 1 },
};

export function aiProfile(d: Difficulty): Readonly<Profile> {
  return PROFILES[d];
}

function scoreResult(pens: PenState[], out: boolean[], me: Seat): number {
  const them = me === 0 ? 1 : 0;
  if (out[me] && out[them]) return -300;
  if (out[me]) return -1000;
  if (out[them]) return 1000;
  const theirEdge = edgeDistance(pens[them], TABLE);
  const myEdge = edgeDistance(pens[me], TABLE);
  return (200 - theirEdge) - Math.max(0, 140 - myEdge) * 2.5;
}

/** Simulates a shot from the current resting position and scores it for `me`. */
export function evaluateShot(pens: PenState[], me: Seat, shot: Shot): number {
  const m = new Match({ firstTurn: me, poses: pens.map((p) => ({ x: p.x, y: p.y, angle: p.angle })) });
  m.shoot(me, shot);
  m.runToRest(420);
  return scoreResult(m.sim.snapshot(), m.sim.out, me);
}

/**
 * Chooses a shot aimed at the opponent. Better difficulties consider more
 * candidates (each simulated with the real physics) and execute more precisely.
 */
export function chooseAiShot(
  pens: PenState[],
  me: Seat,
  difficulty: Difficulty,
  rand: () => number = Math.random,
): Shot {
  const p = PROFILES[difficulty];
  const them = me === 0 ? 1 : 0;
  const mine = pens[me];
  const target = pens[them];
  const candidates: { shot: Shot; score: number }[] = [];
  for (let i = 0; i < p.candidates; i++) {
    // Aim at a point somewhere along the opponent pen.
    const along = (rand() - 0.5) * PEN.length * 0.7;
    const tx = target.x + Math.cos(target.angle) * along;
    const ty = target.y + Math.sin(target.angle) * along;
    const angle = Math.atan2(ty - mine.y, tx - mine.x) + (rand() - 0.5) * 0.12;
    const power = p.powerRange[0] + rand() * (p.powerRange[1] - p.powerRange[0]);
    const offset = (rand() - 0.5) * 0.6;
    const shot = { angle, power, offset };
    candidates.push({ shot, score: evaluateShot(pens, me, shot) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const pick = candidates[Math.floor(rand() * Math.min(p.pickFrom, candidates.length))].shot;
  const noisy = (amp: number) => (rand() + rand() - 1) * amp;
  return {
    angle: pick.angle + noisy(p.angleNoise),
    power: Math.max(0.15, Math.min(1, pick.power + noisy(p.powerNoise))),
    offset: pick.offset,
  };
}
