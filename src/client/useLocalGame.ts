'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { chooseAiShot, type Difficulty } from '../shared/ai';
import { SIM, type PenColorId } from '../shared/constants';
import { Match, type Phase, type Seat } from '../shared/match';
import type { Shot } from '../shared/physics';
import type { ArenaScene } from './Arena';
import { sfx } from './sound';

export interface LocalStatus {
  active: boolean;
  turn: Seat;
  phase: Phase;
  winner: Seat | null;
  draw: boolean;
  thinking: boolean;
  matchKey: number;
}

interface Opts {
  vsComputer: boolean;
  difficulty: Difficulty;
  colors: [PenColorId, PenColorId];
  tags: [string, string];
}

const IDLE: LocalStatus = { active: false, turn: 0, phase: 'aiming', winner: null, draw: false, thinking: false, matchKey: 0 };

export function useLocalGame(opts: Opts) {
  const matchRef = useRef<Match | null>(null);
  const previewRef = useRef<{ seat: Seat; shot: Shot } | null>(null);
  const nextFirst = useRef<Seat>(0);
  const [status, setStatus] = useState<LocalStatus>(IDLE);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const sync = useCallback((extra: Partial<LocalStatus> = {}) => {
    const m = matchRef.current;
    setStatus((s) =>
      m
        ? { ...s, active: true, turn: m.turn, phase: m.phase, winner: m.winner, draw: m.draw, thinking: false, ...extra }
        : { ...IDLE, matchKey: s.matchKey },
    );
  }, []);

  const start = useCallback(() => {
    // Vs computer: the human always opens the first match, then turns alternate.
    const first = nextFirst.current;
    nextFirst.current = first === 0 ? 1 : 0;
    matchRef.current = new Match({ firstTurn: first });
    previewRef.current = null;
    setStatus((s) => ({ ...s, matchKey: s.matchKey + 1 }));
    sync();
  }, [sync]);

  const stop = useCallback(() => {
    matchRef.current = null;
    previewRef.current = null;
    nextFirst.current = 0;
    sync();
  }, [sync]);

  const aimableSeat = (m: Match | null): Seat | null => {
    if (!m || m.phase !== 'aiming' || previewRef.current) return null;
    if (optsRef.current.vsComputer && m.turn === 1) return null;
    return m.turn;
  };

  const shoot = useCallback(
    (shot: Shot) => {
      const m = matchRef.current;
      const seat = aimableSeat(m);
      if (!m || seat === null) return;
      if (m.shoot(seat, shot).ok) {
        sfx.flick(shot.power);
        sync();
      }
    },
    [sync],
  );

  // Fixed-step simulation loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hits = 0;
    let out = [false, false];
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const m = matchRef.current;
      const dt = Math.min(100, now - last);
      last = now;
      if (!m || m.phase !== 'moving') {
        acc = 0;
        if (m) {
          hits = m.sim.hits;
          out = [...m.sim.out];
        }
        return;
      }
      acc += dt;
      let resolved = false;
      while (acc >= SIM.frameMs && m.phase === 'moving') {
        acc -= SIM.frameMs;
        resolved = m.tick() || resolved;
      }
      if (m.sim.hits > hits) sfx.hit();
      hits = m.sim.hits;
      if (m.sim.out.some((o, i) => o && !out[i])) sfx.fall();
      out = [...m.sim.out];
      if (resolved) {
        if ((m.phase as string) === 'over') setTimeout(() => (m.draw ? sfx.draw() : sfx.win()), 250);
        sync();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sync]);

  // Computer opponent.
  useEffect(() => {
    if (!opts.vsComputer || !status.active || status.phase !== 'aiming' || status.turn !== 1) return;
    const m = matchRef.current;
    if (!m) return;
    setStatus((s) => ({ ...s, thinking: true }));
    let fire: ReturnType<typeof setTimeout> | undefined;
    const think = setTimeout(() => {
      if (matchRef.current !== m) return;
      const shot = chooseAiShot(m.sim.snapshot(), 1, optsRef.current.difficulty);
      previewRef.current = { seat: 1, shot };
      fire = setTimeout(() => {
        previewRef.current = null;
        if (matchRef.current !== m) return;
        if (m.shoot(1, shot).ok) sfx.flick(shot.power);
        sync();
      }, 650);
    }, 550);
    return () => {
      clearTimeout(think);
      if (fire) clearTimeout(fire);
      previewRef.current = null;
    };
  }, [opts.vsComputer, status.active, status.phase, status.turn, status.matchKey, sync]);

  const getScene = useCallback((): ArenaScene | null => {
    const m = matchRef.current;
    if (!m) return null;
    const o = optsRef.current;
    return {
      pens: m.sim.snapshot(),
      colors: o.colors,
      tags: o.tags,
      turn: m.turn,
      phase: m.phase,
      aimable: aimableSeat(m),
      preview: previewRef.current,
      matchKey: status.matchKey,
    };
  }, [status.matchKey]);

  return { status, start, stop, shoot, getScene };
}
