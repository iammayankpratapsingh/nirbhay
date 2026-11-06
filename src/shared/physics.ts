import Matter from 'matter-js';
import { PEN, SHOT, SIM, TABLE } from './constants';
import { penCorners, pointInRect, polygonOverlapsRect } from './geometry';

const { Engine, Bodies, Body, Composite, Events } = Matter;

export interface PenPose {
  x: number;
  y: number;
  angle: number;
}

export interface PenState extends PenPose {
  vx: number;
  vy: number;
  av: number;
  /** True once the pen has completely left the tabletop. */
  out: boolean;
}

/**
 * A shot. `angle` is the direction of travel (radians), `power` is 0..1 and
 * `offset` is where along the pen it was flicked (-1 = tip end, 1 = cap end).
 */
export interface Shot {
  angle: number;
  power: number;
  offset: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates untrusted input. Power is clamped to the maximum; garbage is rejected. */
export function sanitizeShot(raw: unknown): Shot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.angle) || !finite(r.power)) return null;
  const offset = r.offset === undefined ? 0 : r.offset;
  if (!finite(offset)) return null;
  if (r.power <= 0) return null;
  const power = Math.min(1, r.power);
  if (power < SHOT.minPower) return null;
  return {
    angle: Math.atan2(Math.sin(r.angle), Math.cos(r.angle)),
    power,
    offset: Math.max(-1, Math.min(1, offset)),
  };
}

export function isPenOnTable(p: PenPose): boolean {
  return polygonOverlapsRect(penCorners(p.x, p.y, p.angle, PEN.length, PEN.width), TABLE);
}

export function startingPoses(jitter: () => number = () => 0.5): PenPose[] {
  const j = (amp: number) => (jitter() - 0.5) * 2 * amp;
  return [
    { x: TABLE.w * 0.27 + j(20), y: TABLE.h / 2 + j(40), angle: Math.PI / 2 + j(0.35) },
    { x: TABLE.w * 0.73 + j(20), y: TABLE.h / 2 + j(40), angle: Math.PI / 2 + j(0.35) },
  ];
}

/** Matter.js simulation of the tabletop. One `step()` advances 1/60 s. */
export class PenSim {
  readonly engine: Matter.Engine;
  readonly bodies: Matter.Body[];
  readonly out: boolean[];
  /** Pose of each pen at the moment it fell, kept for rendering. */
  private readonly lastPose: PenState[];
  private quietFrames = 0;
  private pendingBounces: { a: Matter.Body; b: Matter.Body; nx: number; ny: number; vn: number }[] = [];
  frames = 0;
  hits = 0;

  constructor(poses: readonly PenPose[]) {
    this.engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
    this.engine.positionIterations = 8;
    this.engine.velocityIterations = 6;
    this.bodies = poses.map((p, i) =>
      Bodies.rectangle(p.x, p.y, PEN.length, PEN.width, {
        angle: p.angle,
        density: PEN.density,
        restitution: PEN.restitution,
        friction: PEN.friction,
        frictionAir: PEN.tableFriction,
        frictionStatic: 0.2,
        chamfer: { radius: 6 },
        label: `pen-${i}`,
      }),
    );
    Composite.add(this.engine.world, this.bodies);
    this.out = poses.map((p) => !isPenOnTable(p));
    this.lastPose = poses.map((p) => ({ ...p, vx: 0, vy: 0, av: 0, out: false }));
    // Matter's solver treats these broadside hits as almost perfectly inelastic,
    // so record the approach speed of each new contact and add the bounce back.
    Events.on(this.engine, 'collisionStart', (e) => {
      this.hits += e.pairs.length;
      for (const pair of e.pairs) {
        const a = pair.bodyA;
        const b = pair.bodyB;
        const n = pair.collision.normal;
        const va = Body.getVelocity(a);
        const vb = Body.getVelocity(b);
        const vn = (va.x - vb.x) * n.x + (va.y - vb.y) * n.y;
        if (Math.abs(vn) > 0.3) this.pendingBounces.push({ a, b, nx: n.x, ny: n.y, vn });
      }
    });
  }

  applyShot(index: number, shot: Shot): void {
    const body = this.bodies[index];
    if (!body || this.out[index]) return;
    const speed = shot.power * SHOT.maxSpeed;
    const dx = Math.cos(shot.angle);
    const dy = Math.sin(shot.angle);
    Body.setVelocity(body, { x: dx * speed, y: dy * speed });
    // Lever arm along the pen axis -> spin. cross(r, d) with r = axis * offset.
    const ax = Math.cos(body.angle);
    const ay = Math.sin(body.angle);
    const cross = ax * dy - ay * dx;
    Body.setAngularVelocity(body, shot.offset * cross * shot.power * SHOT.maxSpin);
    this.quietFrames = 0;
    this.frames = 0;
  }

  step(): void {
    const dt = SIM.frameMs / SIM.substeps;
    for (let s = 0; s < SIM.substeps; s++) {
      this.applyTableEffects();
      Engine.update(this.engine, dt);
      this.applyBounces();
    }
    this.frames++;
    this.checkFalls();
    if (this.isQuiet()) this.quietFrames++;
    else this.quietFrames = 0;
  }

  private applyBounces(): void {
    for (const { a, b, nx, ny, vn } of this.pendingBounces) {
      const va = Body.getVelocity(a);
      const vb = Body.getVelocity(b);
      const now = (va.x - vb.x) * nx + (va.y - vb.y) * ny;
      const target = -vn * PEN.restitution;
      const delta = target - now;
      // Only ever push the pens apart, never pull them together.
      if (Math.sign(delta) !== Math.sign(target)) continue;
      const wa = b.mass / (a.mass + b.mass);
      const wb = a.mass / (a.mass + b.mass);
      Body.setVelocity(a, { x: va.x + nx * delta * wa, y: va.y + ny * delta * wa });
      Body.setVelocity(b, { x: vb.x - nx * delta * wb, y: vb.y - ny * delta * wb });
    }
    this.pendingBounces = [];
  }

  /** Pens past their balance point tip over the edge instead of hovering there. */
  private applyTableEffects(): void {
    this.bodies.forEach((b, i) => {
      if (this.out[i]) return;
      const c = b.position;
      if (pointInRect(c, TABLE)) {
        b.frictionAir = PEN.tableFriction;
        return;
      }
      b.frictionAir = 0.004;
      const ox = c.x < TABLE.x ? -1 : c.x > TABLE.x + TABLE.w ? 1 : 0;
      const oy = c.y < TABLE.y ? -1 : c.y > TABLE.y + TABLE.h ? 1 : 0;
      const v = Body.getVelocity(b);
      const k = SIM.tipAccel / SIM.substeps;
      Body.setVelocity(b, { x: v.x + ox * k, y: v.y + oy * k });
    });
  }

  private checkFalls(): void {
    this.bodies.forEach((b, i) => {
      if (this.out[i]) return;
      const pose = { x: b.position.x, y: b.position.y, angle: b.angle };
      if (!isPenOnTable(pose)) {
        this.out[i] = true;
        const v = Body.getVelocity(b);
        this.lastPose[i] = { ...pose, vx: v.x, vy: v.y, av: Body.getAngularVelocity(b), out: true };
        Composite.remove(this.engine.world, b);
      }
    });
  }

  private isQuiet(): boolean {
    return this.bodies.every(
      (b, i) =>
        this.out[i] ||
        (Body.getSpeed(b) < SIM.settleSpeed && Math.abs(Body.getAngularVelocity(b)) < SIM.settleAngular &&
          pointInRect(b.position, TABLE)),
    );
  }

  isSettled(): boolean {
    return this.quietFrames >= SIM.settleFrames || this.frames >= SIM.maxShotFrames;
  }

  /** Stops everything (used once a shot has settled). */
  freeze(): void {
    this.bodies.forEach((b, i) => {
      if (this.out[i]) return;
      Body.setVelocity(b, { x: 0, y: 0 });
      Body.setAngularVelocity(b, 0);
    });
  }

  /** Teleport pens (testing / tooling). */
  setPose(index: number, pose: PenPose): void {
    const b = this.bodies[index];
    Body.setPosition(b, { x: pose.x, y: pose.y });
    Body.setAngle(b, pose.angle);
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
  }

  snapshot(): PenState[] {
    return this.bodies.map((b, i) => {
      if (this.out[i]) return { ...this.lastPose[i] };
      const v = Body.getVelocity(b);
      return {
        x: b.position.x,
        y: b.position.y,
        angle: b.angle,
        vx: v.x,
        vy: v.y,
        av: Body.getAngularVelocity(b),
        out: false,
      };
    });
  }
}
