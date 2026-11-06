'use client';

import { useEffect, useRef } from 'react';
import { PEN, SHOT, VIEW, penColor, type PenColorId } from '../shared/constants';
import { distToSegment } from '../shared/geometry';
import type { Phase, Seat } from '../shared/match';
import type { PenState, Shot } from '../shared/physics';
import { drawAim, drawFloor, drawPen, drawTable, drawTag } from './render';

export interface ArenaScene {
  pens: PenState[];
  colors: PenColorId[];
  tags: string[];
  turn: Seat;
  phase: Phase;
  /** Seat the local user may aim right now, or null. */
  aimable: Seat | null;
  /** Shown while the computer lines up its shot. */
  preview: { seat: Seat; shot: Shot } | null;
  /** Bumps whenever a fresh match starts (resets fall animations). */
  matchKey: number;
}

interface Props {
  getScene: () => ArenaScene | null;
  onShot: (shot: Shot) => void;
  onAim?: (power: number | null) => void;
  reducedMotion: boolean;
  label: string;
}

interface Drag {
  pointerId: number;
  seat: Seat;
  grab: { x: number; y: number };
  offset: number;
  cur: { x: number; y: number };
}

function shotFromDrag(d: Drag): Shot {
  const dx = d.grab.x - d.cur.x;
  const dy = d.grab.y - d.cur.y;
  const len = Math.hypot(dx, dy);
  return { angle: Math.atan2(dy, dx), power: Math.min(1, len / SHOT.maxDrag), offset: d.offset };
}

export default function Arena({ getScene, onShot, onAim, reducedMotion, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const kbRef = useRef<{ angle: number; power: number } | null>(null);
  const matrixRef = useRef<DOMMatrix | null>(null);
  const fallRef = useRef<{ key: number; at: (number | null)[] }>({ key: -1, at: [null, null] });
  const props = useRef({ getScene, onShot, onAim, reducedMotion });
  props.current = { getScene, onShot, onAim, reducedMotion };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      cssW = r.width;
      cssH = r.height;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      const rotate = cssH > cssW * 1.05;
      const vw = rotate ? VIEW.h : VIEW.w;
      const vh = rotate ? VIEW.w : VIEW.h;
      const s = Math.min(cssW / vw, cssH / vh);
      matrixRef.current = new DOMMatrix()
        .translate(cssW / 2, cssH / 2)
        .rotate(rotate ? 90 : 0)
        .scale(s)
        .translate(-(VIEW.x + VIEW.w / 2), -(VIEW.y + VIEW.h / 2));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const scene = props.current.getScene();
      const m = matrixRef.current!;
      const scale = Math.hypot(m.a, m.b);
      const px = scale * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(new DOMMatrix().scale(dpr).multiply(m));
      drawFloor(ctx);
      drawTable(ctx, px);
      if (!scene) return;

      const fall = fallRef.current;
      if (fall.key !== scene.matchKey) {
        fall.key = scene.matchKey;
        fall.at = [null, null];
      }
      const rm = props.current.reducedMotion;
      const pulse = rm ? 1 : 0.65 + 0.35 * Math.sin(now / 260);

      // Pens: falling ones first so they appear "below" the table edge feel.
      scene.pens.forEach((p, i) => {
        const color = penColor(scene.colors[i]);
        if (p.out) {
          if (fall.at[i] === null) fall.at[i] = now;
          const dur = rm ? 250 : 750;
          const t = Math.min(1, (now - fall.at[i]!) / dur);
          if (t >= 1) return;
          const drift = rm ? 0 : t * 26;
          drawPen(ctx, p.x + p.vx * drift, p.y + p.vy * drift + (rm ? 0 : t * t * 40), p.angle + (rm ? 0 : p.av * drift * 2 + t * 0.6), color, {
            px,
            alpha: 1 - t,
            scale: 1 - 0.35 * t,
            lift: 1 + t * 3,
          });
        }
      });
      scene.pens.forEach((p, i) => {
        if (p.out) return;
        const active = scene.phase === 'aiming' && scene.turn === i;
        drawPen(ctx, p.x, p.y, p.angle, penColor(scene.colors[i]), { px, glow: active ? pulse : 0 });
      });

      // Aim
      const d = dragRef.current;
      if (d && scene.aimable === d.seat && !scene.pens[d.seat].out) {
        const s = shotFromDrag(d);
        drawAim(ctx, { from: scene.pens[d.seat], angle: s.angle, power: s.power, band: { a: d.grab, b: d.cur } }, px);
      } else if (kbRef.current && scene.aimable !== null) {
        drawAim(ctx, { from: scene.pens[scene.aimable], ...kbRef.current }, px);
      } else if (scene.preview) {
        drawAim(ctx, { from: scene.pens[scene.preview.seat], angle: scene.preview.shot.angle, power: scene.preview.shot.power }, px);
      }

      // Name tags in screen space
      scene.pens.forEach((p, i) => {
        if (p.out || !scene.tags[i]) return;
        const pt = m.transformPoint(new DOMPoint(p.x, p.y));
        const active = scene.phase === 'aiming' && scene.turn === i;
        drawTag(ctx, pt.x, pt.y - Math.max(26, PEN.length * scale * 0.18) - 12, scene.tags[i], penColor(scene.colors[i]).base, active, dpr);
      });
    };
    raf = requestAnimationFrame(frame);
    // Read-only hook used by the automated browser tests to find pens on screen.
    (window as unknown as { __penBattle?: unknown }).__penBattle = {
      penOnScreen(seat: number) {
        const scene = props.current.getScene();
        const m = matrixRef.current;
        if (!scene || !m) return null;
        const p = scene.pens[seat];
        const pt = m.transformPoint(new DOMPoint(p.x, p.y));
        const r = canvas.getBoundingClientRect();
        return { x: r.left + pt.x, y: r.top + pt.y, angle: p.angle, aimable: scene.aimable, turn: scene.turn, phase: scene.phase };
      },
      worldScale: () => (matrixRef.current ? Math.hypot(matrixRef.current.a, matrixRef.current.b) : 0),
      rotated: () => (matrixRef.current ? Math.abs(matrixRef.current.b) > 1e-6 : false),
    };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const p = matrixRef.current!.inverse().transformPoint(new DOMPoint(e.clientX - r.left, e.clientY - r.top));
    return { x: p.x, y: p.y };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const scene = props.current.getScene();
    if (!scene || scene.aimable === null || dragRef.current) return;
    const pen = scene.pens[scene.aimable];
    if (pen.out) return;
    const w = toWorld(e);
    const c = Math.cos(pen.angle);
    const s = Math.sin(pen.angle);
    const a = { x: pen.x - (c * PEN.length) / 2, y: pen.y - (s * PEN.length) / 2 };
    const b = { x: pen.x + (c * PEN.length) / 2, y: pen.y + (s * PEN.length) / 2 };
    const hit = distToSegment(w, a, b);
    const reach = e.pointerType === 'mouse' ? 70 : 115;
    if (hit.dist > reach) return;
    e.preventDefault();
    canvasRef.current!.setPointerCapture(e.pointerId);
    kbRef.current = null;
    // Grab point on the pen: decides spin.
    const t = hit.t;
    const grab = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    dragRef.current = { pointerId: e.pointerId, seat: scene.aimable, grab, offset: (t * 2 - 1) * 0.9, cur: w };
    props.current.onAim?.(0);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.cur = toWorld(e);
    props.current.onAim?.(shotFromDrag(d).power);
  };

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>, cancel: boolean) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    props.current.onAim?.(null);
    const scene = props.current.getScene();
    if (cancel || !scene || scene.aimable !== d.seat) return;
    const shot = shotFromDrag(d);
    if (shot.power >= SHOT.minPower) props.current.onShot(shot);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const scene = props.current.getScene();
    if (!scene || scene.aimable === null) return;
    const me = scene.pens[scene.aimable];
    const them = scene.pens[scene.aimable === 0 ? 1 : 0];
    let kb = kbRef.current ?? { angle: Math.atan2(them.y - me.y, them.x - me.x), power: 0.5 };
    const step = e.shiftKey ? 0.02 : 0.08;
    switch (e.key) {
      case 'ArrowLeft':
        kb = { ...kb, angle: kb.angle - step };
        break;
      case 'ArrowRight':
        kb = { ...kb, angle: kb.angle + step };
        break;
      case 'ArrowUp':
        kb = { ...kb, power: Math.min(1, kb.power + 0.05) };
        break;
      case 'ArrowDown':
        kb = { ...kb, power: Math.max(0.05, kb.power - 0.05) };
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (!kbRef.current) {
          kbRef.current = kb;
          props.current.onAim?.(kb.power);
          return;
        }
        kbRef.current = null;
        props.current.onAim?.(null);
        props.current.onShot({ angle: kb.angle, power: kb.power, offset: 0 });
        return;
      }
      case 'Escape':
        kbRef.current = null;
        props.current.onAim?.(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    kbRef.current = kb;
    props.current.onAim?.(kb.power);
  };

  return (
    <canvas
      ref={canvasRef}
      className="arena-canvas"
      tabIndex={0}
      role="img"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (kbRef.current) {
          kbRef.current = null;
          props.current.onAim?.(null);
        }
      }}
    />
  );
}
