import { PenSim, sanitizeShot, startingPoses, type PenPose, type PenState, type Shot } from './physics';

export type Seat = 0 | 1;
export type Phase = 'aiming' | 'moving' | 'over';

export interface MatchSnapshot {
  pens: PenState[];
  turn: Seat;
  phase: Phase;
  /** Winning seat, or null for a draw / match in progress. */
  winner: Seat | null;
  draw: boolean;
  shots: number;
  hits: number;
  lastShot: { seat: Seat; shot: Shot } | null;
}

export type ShotRejection = 'GAME_OVER' | 'NOT_YOUR_TURN' | 'PENS_MOVING' | 'INVALID_SHOT';
export type ShotResult = { ok: true; shot: Shot } | { ok: false; reason: ShotRejection };

export interface Outcome {
  winner: Seat | null;
  draw: boolean;
}

/**
 * Win rules: if both pens left the table during the shot it is a draw;
 * if exactly one left, the other pen wins; otherwise play continues.
 */
export function decideOutcome(out: readonly boolean[]): Outcome | null {
  const [a, b] = out;
  if (a && b) return { winner: null, draw: true };
  if (a) return { winner: 1, draw: false };
  if (b) return { winner: 0, draw: false };
  return null;
}

export interface MatchOptions {
  firstTurn?: Seat;
  poses?: PenPose[];
  random?: () => number;
}

/** Turn-based rules wrapped around the physics. Shared by local play, the AI and the server. */
export class Match {
  readonly sim: PenSim;
  turn: Seat;
  phase: Phase = 'aiming';
  winner: Seat | null = null;
  draw = false;
  shots = 0;
  lastShot: { seat: Seat; shot: Shot } | null = null;

  constructor(opts: MatchOptions = {}) {
    this.turn = opts.firstTurn ?? 0;
    this.sim = new PenSim(opts.poses ?? startingPoses(opts.random ?? Math.random));
  }

  canShoot(seat: Seat): ShotRejection | null {
    if (this.phase === 'over') return 'GAME_OVER';
    if (this.phase === 'moving') return 'PENS_MOVING';
    if (seat !== this.turn) return 'NOT_YOUR_TURN';
    return null;
  }

  shoot(seat: Seat, raw: unknown): ShotResult {
    const blocked = this.canShoot(seat);
    if (blocked) return { ok: false, reason: blocked };
    const shot = sanitizeShot(raw);
    if (!shot) return { ok: false, reason: 'INVALID_SHOT' };
    this.sim.applyShot(seat, shot);
    this.phase = 'moving';
    this.shots++;
    this.lastShot = { seat, shot };
    return { ok: true, shot };
  }

  /** Advance 1/60 s. Returns true when the shot just resolved. */
  tick(): boolean {
    if (this.phase !== 'moving') return false;
    this.sim.step();
    if (!this.sim.isSettled()) return false;
    this.sim.freeze();
    const outcome = decideOutcome(this.sim.out);
    if (outcome) {
      this.phase = 'over';
      this.winner = outcome.winner;
      this.draw = outcome.draw;
    } else {
      this.phase = 'aiming';
      this.turn = this.turn === 0 ? 1 : 0;
    }
    return true;
  }

  /** Runs the current shot to completion synchronously. */
  runToRest(maxFrames = 2000): void {
    for (let i = 0; i < maxFrames && this.phase === 'moving'; i++) this.tick();
  }

  snapshot(): MatchSnapshot {
    return {
      pens: this.sim.snapshot(),
      turn: this.turn,
      phase: this.phase,
      winner: this.winner,
      draw: this.draw,
      shots: this.shots,
      hits: this.sim.hits,
      lastShot: this.lastShot,
    };
  }
}
