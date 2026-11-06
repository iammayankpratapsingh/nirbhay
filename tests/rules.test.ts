import Matter from 'matter-js';
import { describe, expect, it } from 'vitest';
import { chooseAiShot } from '../src/shared/ai';
import { PEN, SHOT, TABLE } from '../src/shared/constants';
import { decideOutcome, Match } from '../src/shared/match';
import { isPenOnTable, PenSim, sanitizeShot } from '../src/shared/physics';
import { normalizeRoomCode } from '../src/shared/protocol';

const UP = -Math.PI / 2;
const RIGHT = 0;
const LEFT = Math.PI;

describe('turn enforcement', () => {
  it('rejects the player whose turn it is not', () => {
    const m = new Match({ firstTurn: 0 });
    expect(m.shoot(1, { angle: 0, power: 0.5, offset: 0 })).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
    expect(m.phase).toBe('aiming');
  });

  it('rejects any shot while pens are still moving', () => {
    const m = new Match({ firstTurn: 0 });
    expect(m.shoot(0, { angle: UP, power: 0.3, offset: 0 }).ok).toBe(true);
    expect(m.phase).toBe('moving');
    expect(m.shoot(0, { angle: UP, power: 0.3, offset: 0 })).toEqual({ ok: false, reason: 'PENS_MOVING' });
    expect(m.shoot(1, { angle: UP, power: 0.3, offset: 0 })).toEqual({ ok: false, reason: 'PENS_MOVING' });
  });

  it('passes the turn only after every pen has stopped', () => {
    const m = new Match({ firstTurn: 0 });
    m.shoot(0, { angle: UP, power: 0.25, offset: 0 });
    m.tick();
    expect(m.turn).toBe(0);
    m.runToRest();
    expect(m.phase).toBe('aiming');
    expect(m.turn).toBe(1);
    for (const p of m.sim.snapshot()) expect(Math.hypot(p.vx, p.vy)).toBe(0);
  });
});

describe('shot power limits', () => {
  it('clamps power above the maximum to 100%', () => {
    expect(sanitizeShot({ angle: 0, power: 50, offset: 0 })?.power).toBe(1);
  });

  it('rejects malformed, negative and negligible shots', () => {
    for (const bad of [null, 'x', {}, { angle: NaN, power: 1 }, { angle: 0, power: Infinity }, { angle: 0, power: -1 },
      { angle: 0, power: 0 }, { angle: 0, power: SHOT.minPower / 2 }, { angle: 0, power: 1, offset: 'x' }]) {
      expect(sanitizeShot(bad)).toBeNull();
    }
  });

  it('clamps the flick offset to the pen', () => {
    expect(sanitizeShot({ angle: 0, power: 1, offset: 9 })?.offset).toBe(1);
  });

  it('an over-powered shot moves no faster than a 100% shot', () => {
    const speedFor = (power: number) => {
      const m = new Match({ firstTurn: 0, poses: [{ x: 500, y: 310, angle: 0 }, { x: 500, y: 100, angle: 0 }] });
      m.shoot(0, { angle: UP, power, offset: 0 });
      const v = Matter.Body.getVelocity(m.sim.bodies[0]);
      return Math.hypot(v.x, v.y);
    };
    expect(speedFor(1)).toBeCloseTo(SHOT.maxSpeed, 5);
    expect(speedFor(1e9)).toBeCloseTo(SHOT.maxSpeed, 5);
    expect(speedFor(0.5)).toBeCloseTo(SHOT.maxSpeed / 2, 5);
  });
});

describe('pen elimination', () => {
  it('a pen hanging over the edge is still on the table', () => {
    // Centre is 10 units past the right edge but the pen still overlaps it.
    expect(isPenOnTable({ x: TABLE.w + 10, y: 300, angle: 0 })).toBe(true);
    expect(isPenOnTable({ x: TABLE.w + PEN.length / 2 - 1, y: 300, angle: 0 })).toBe(true);
  });

  it('a pen is eliminated only once it has completely left the tabletop', () => {
    expect(isPenOnTable({ x: TABLE.w + PEN.length / 2 + 1, y: 300, angle: 0 })).toBe(false);
    // Near a corner: the bounding box overlaps the table, the rotated pen does not.
    expect(isPenOnTable({ x: TABLE.w + 50, y: -50, angle: Math.PI / 4 })).toBe(false);
  });

  it('the simulation removes a pen that slides off and keeps the other', () => {
    const sim = new PenSim([{ x: 120, y: 310, angle: Math.PI / 2 }, { x: 800, y: 310, angle: Math.PI / 2 }]);
    sim.applyShot(0, { angle: LEFT, power: 1, offset: 0 });
    let fellAtFrame = -1;
    for (let i = 0; i < 600 && fellAtFrame < 0; i++) {
      sim.step();
      if (sim.out[0]) fellAtFrame = i;
      else expect(isPenOnTable(sim.snapshot()[0])).toBe(true);
    }
    expect(fellAtFrame).toBeGreaterThan(0);
    expect(sim.out).toEqual([true, false]);
    expect(Matter.Composite.allBodies(sim.engine.world)).toHaveLength(1);
  });

  it('a pen balanced past its tipping point falls instead of hovering', () => {
    const sim = new PenSim([{ x: TABLE.w + 5, y: 300, angle: 0 }, { x: 300, y: 300, angle: 0 }]);
    expect(sim.out[0]).toBe(false);
    for (let i = 0; i < 600 && !sim.out[0]; i++) sim.step();
    expect(sim.out[0]).toBe(true);
  });
});

describe('winner and draw detection', () => {
  it('decides outcomes from which pens fell', () => {
    expect(decideOutcome([false, false])).toBeNull();
    expect(decideOutcome([false, true])).toEqual({ winner: 0, draw: false });
    expect(decideOutcome([true, false])).toEqual({ winner: 1, draw: false });
    expect(decideOutcome([true, true])).toEqual({ winner: null, draw: true });
  });

  it('knocking the opponent off wins', () => {
    const m = new Match({
      firstTurn: 0,
      poses: [{ x: 600, y: 310, angle: Math.PI / 2 }, { x: 930, y: 310, angle: Math.PI / 2 }],
    });
    m.shoot(0, { angle: RIGHT, power: 0.6, offset: 0 });
    m.runToRest();
    expect(m.sim.out).toEqual([false, true]);
    expect(m.phase).toBe('over');
    expect(m.winner).toBe(0);
    expect(m.draw).toBe(false);
    expect(m.shoot(1, { angle: 0, power: 1 })).toEqual({ ok: false, reason: 'GAME_OVER' });
  });

  it('flicking your own pen off the table loses', () => {
    const m = new Match({
      firstTurn: 0,
      poses: [{ x: 100, y: 310, angle: Math.PI / 2 }, { x: 800, y: 310, angle: Math.PI / 2 }],
    });
    m.shoot(0, { angle: LEFT, power: 1, offset: 0 });
    m.runToRest();
    expect(m.winner).toBe(1);
    expect(m.draw).toBe(false);
  });

  it('both pens falling on the same shot is a draw', () => {
    const m = new Match({
      firstTurn: 0,
      poses: [{ x: 880, y: 310, angle: Math.PI / 2 }, { x: 935, y: 310, angle: Math.PI / 2 }],
    });
    m.shoot(0, { angle: RIGHT, power: 1, offset: 0 });
    m.runToRest();
    expect(m.sim.out).toEqual([true, true]);
    expect(m.phase).toBe('over');
    expect(m.draw).toBe(true);
    expect(m.winner).toBeNull();
  });
});

describe('computer opponent', () => {
  it('aims toward the opponent, tighter on harder levels', () => {
    const m = new Match();
    const pens = m.sim.snapshot();
    const direct = Math.atan2(pens[0].y - pens[1].y, pens[0].x - pens[1].x);
    const spread = (d: 'easy' | 'hard') => {
      let total = 0;
      for (let i = 0; i < 6; i++) {
        const s = chooseAiShot(pens, 1, d);
        expect(s.power).toBeGreaterThan(0);
        expect(s.power).toBeLessThanOrEqual(1);
        total += Math.abs(Math.atan2(Math.sin(s.angle - direct), Math.cos(s.angle - direct)));
      }
      return total / 6;
    };
    const hard = spread('hard');
    expect(hard).toBeLessThan(0.35);
    expect(spread('easy')).toBeLessThan(1.2);
  });
});

describe('room codes', () => {
  it('normalises and validates codes', () => {
    expect(normalizeRoomCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeRoomCode('ABC23')).toBeNull();
    expect(normalizeRoomCode('ABCDE0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeRoomCode(42)).toBeNull();
  });
});
