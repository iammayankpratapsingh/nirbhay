import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authToken } from '../src/shared/auth';
import type { JoinedInfo, RoomView } from '../src/shared/protocol';
import { createGameServer, type GameServer, type GameServerOptions } from '../server/game-server';

const TOKEN = await authToken('test-password');

let http: HttpServer;
let ioServer: Server;
let game: GameServer;
let url: string;
let clock = 0;
const sockets: Socket[] = [];

async function boot(opts: GameServerOptions = {}) {
  http = createServer();
  ioServer = new Server(http);
  game = createGameServer(ioServer, { authToken: TOKEN, graceMs: 400, tickMs: 1, sweepMs: 1e9, ...opts });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

async function client(token: string | null = TOKEN): Promise<Socket> {
  const s = connect(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth: token ? { token } : {},
  });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', (e) => reject(e));
  });
  return s;
}

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const call = <T = object>(s: Socket, ev: string, ...args: unknown[]) =>
  s.timeout(3000).emitWithAck(ev, ...args) as Promise<Res<T>>;

/** Resolves with the next room:state matching `pred` (state already received counts too). */
function stateWhere(s: Socket, pred: (v: RoomView) => boolean, ms = 4000): Promise<RoomView> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.off('room:state', on);
      reject(new Error('timed out waiting for state'));
    }, ms);
    const on = (v: RoomView) => {
      if (pred(v)) {
        clearTimeout(timer);
        s.off('room:state', on);
        resolve(v);
      }
    };
    s.on('room:state', on);
  });
}

async function createAndJoin() {
  const a = await client();
  const b = await client();
  const created = await call<JoinedInfo>(a, 'room:create', { name: 'Nirbhay', color: 'lime' });
  if (!created.ok) throw new Error(created.error);
  const joined = await call<JoinedInfo>(b, 'room:join', { code: created.code, profile: { name: 'Friend', color: 'gold' } });
  if (!joined.ok) throw new Error(joined.error);
  return { a, b, code: created.code, ainfo: created, binfo: joined };
}

async function startMatch() {
  const ctx = await createAndJoin();
  const playing = stateWhere(ctx.a, (v) => v.status === 'playing');
  await call(ctx.a, 'lobby:ready', true);
  await call(ctx.b, 'lobby:ready', true);
  const view = await playing;
  return { ...ctx, view };
}

beforeEach(async () => {
  clock = Date.now();
  await boot();
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  game.close();
  await new Promise<void>((r) => ioServer.close(() => r()));
});

describe('room creation and joining', () => {
  it('creates a short code and lets a second device join by code', async () => {
    const a = await client();
    const b = await client();
    const created = await call<JoinedInfo>(a, 'room:create', { name: 'Nirbhay', color: 'lime' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(created.seat).toBe(0);

    const lobby = stateWhere(a, (v) => v.players[1] !== null);
    // Codes are case/format tolerant, e.g. typed as "abc-def".
    const typed = `${created.code.slice(0, 3).toLowerCase()}-${created.code.slice(3)}`;
    const joined = await call<JoinedInfo>(b, 'room:join', { code: typed, profile: { name: 'Friend', color: 'gold' } });
    expect(joined.ok && joined.seat).toBe(1);
    const view = await lobby;
    expect(view.status).toBe('lobby');
    expect(view.players.map((p) => p?.name)).toEqual(['Nirbhay', 'Friend']);
    expect(view.players.map((p) => p?.ready)).toEqual([false, false]);
    // Secrets never leak into the shared view.
    expect(JSON.stringify(view)).not.toContain(joined.ok ? joined.secret : 'x');
  });

  it('keeps opponents visually distinct when both pick the same colour', async () => {
    const a = await client();
    const b = await client();
    const created = await call<JoinedInfo>(a, 'room:create', { name: 'A', color: 'ice' });
    if (!created.ok) throw new Error();
    const view = stateWhere(b, (v) => v.players[1] !== null);
    await call(b, 'room:join', { code: created.code, profile: { name: 'B', color: 'ice' } });
    const v = await view;
    expect(v.players[0]?.color).toBe('ice');
    expect(v.players[1]?.color).not.toBe('ice');
  });

  it('rejects malformed codes, unknown rooms and full rooms', async () => {
    const { code } = await createAndJoin();
    const c = await client();
    expect(await call(c, 'room:join', { code: '12', profile: {} })).toEqual({ ok: false, error: 'BAD_CODE' });
    expect(await call(c, 'room:join', { code: 'ZZZZZZ', profile: {} })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await call(c, 'room:join', { code, profile: {} })).toEqual({ ok: false, error: 'FULL' });
  });

  it('rate-limits code guessing', async () => {
    const c = await client();
    for (let i = 0; i < 10; i++) await call(c, 'room:join', { code: 'ZZZZZZ', profile: {} });
    expect(await call(c, 'room:join', { code: 'ZZZZZZ', profile: {} })).toEqual({ ok: false, error: 'RATE_LIMITED' });
  });

  it('refuses connections without the game password token', async () => {
    await expect(client(null)).rejects.toThrow('UNAUTHORIZED');
    await expect(client('wrong')).rejects.toThrow('UNAUTHORIZED');
  });

  it('starts only when both players are ready', async () => {
    const { a, b } = await createAndJoin();
    await call(a, 'lobby:ready', true);
    expect([...game.rooms.values()][0].status).toBe('lobby');
    const playing = stateWhere(a, (v) => v.status === 'playing');
    await call(b, 'lobby:ready', true);
    const v = await playing;
    expect(v.match?.phase).toBe('aiming');
    expect(v.match?.turn).toBe(0);
  });
});

describe('server-side validation of moves', () => {
  it('rejects out-of-turn, outsider, invalid and mid-motion shots', async () => {
    const { a, b } = await startMatch();
    const outsider = await client();
    const shot = { angle: -Math.PI / 2, power: 0.3, offset: 0 };

    expect(await call(b, 'game:shot', shot)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    // Claiming another seat in the payload is ignored: the server uses the socket's seat.
    expect(await call(b, 'game:shot', { ...shot, seat: 0 })).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(await call(outsider, 'game:shot', shot)).toEqual({ ok: false, error: 'NOT_IN_ROOM' });
    expect(await call(a, 'game:shot', { angle: 'left', power: 1 })).toEqual({ ok: false, error: 'INVALID_SHOT' });
    expect(await call(a, 'game:shot', { angle: 0, power: NaN })).toEqual({ ok: false, error: 'INVALID_SHOT' });

    const nextTurn = stateWhere(a, (v) => v.match?.phase === 'aiming' && v.match.turn === 1);
    expect(await call(a, 'game:shot', shot)).toEqual({ ok: true });
    expect(await call(a, 'game:shot', shot)).toEqual({ ok: false, error: 'PENS_MOVING' });
    expect(await call(b, 'game:shot', shot)).toEqual({ ok: false, error: 'PENS_MOVING' });
    await nextTurn;
    expect(await call(a, 'game:shot', shot)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(await call(b, 'game:shot', shot)).toEqual({ ok: true });
  });

  it('clamps over-powered shots on the server', async () => {
    const { a } = await startMatch();
    const echoed = new Promise<{ shot: { power: number } }>((r) => a.once('game:shot', r));
    await call(a, 'game:shot', { angle: -Math.PI / 2, power: 999, offset: 0 });
    expect((await echoed).shot.power).toBe(1);
  });

  it('streams authoritative frames while pens move', async () => {
    const { a, b } = await startMatch();
    const frames: number[] = [];
    b.on('game:frame', (f: { seq: number }) => frames.push(f.seq));
    const settled = stateWhere(b, (v) => v.match?.turn === 1);
    await call(a, 'game:shot', { angle: -Math.PI / 2, power: 0.3, offset: 0 });
    await settled;
    expect(frames.length).toBeGreaterThan(5);
    expect(frames).toEqual([...frames].sort((x, y) => x - y));
  });

  it('only lobby players can change profile or readiness', async () => {
    const { a } = await startMatch();
    expect(await call(a, 'lobby:ready', false)).toEqual({ ok: false, error: 'NOT_IN_LOBBY' });
    expect(await call(a, 'lobby:profile', { name: 'X', color: 'gold' })).toEqual({ ok: false, error: 'NOT_IN_LOBBY' });
  });
});

describe('winning, draws and rematch', () => {
  it('declares the winner and rematches in the same room', async () => {
    const { a, b, code } = await startMatch();
    const over = stateWhere(b, (v) => v.status === 'over');
    // Seat 0 starts on the left: flick it straight off the left edge.
    await call(a, 'game:shot', { angle: Math.PI, power: 1, offset: 0 });
    const v = await over;
    expect(v.match?.winner).toBe(1);
    expect(v.match?.draw).toBe(false);

    await call(a, 'game:rematch');
    expect([...game.rooms.values()][0].status).toBe('over');
    const again = stateWhere(a, (s) => s.status === 'playing');
    await call(b, 'game:rematch');
    const re = await again;
    expect(re.code).toBe(code);
    expect(re.match?.turn).toBe(1); // first turn alternates
    expect(re.match?.pens.every((p) => !p.out)).toBe(true);
  });
});

describe('disconnects and reconnects', () => {
  it('pauses on a temporary disconnect and resumes with the saved seat', async () => {
    const { a, b, code, binfo } = await startMatch();
    const paused = stateWhere(a, (v) => v.paused && v.players[1]?.connected === false);
    b.disconnect();
    const pv = await paused;
    expect(pv.players[1]?.graceMs).toBeGreaterThan(0);
    expect(await call(a, 'game:shot', { angle: 0, power: 0.5 })).toEqual({ ok: false, error: 'PAUSED' });

    const b2 = await client();
    expect(await call(b2, 'room:resume', { code, playerId: binfo.playerId, secret: 'guess' })).toEqual({
      ok: false,
      error: 'BAD_CREDENTIALS',
    });
    const resumed = stateWhere(a, (v) => !v.paused && v.players[1]?.connected === true);
    const res = await call<JoinedInfo>(b2, 'room:resume', { code, playerId: binfo.playerId, secret: binfo.secret });
    expect(res.ok && res.seat).toBe(1);
    const rv = await resumed;
    expect(rv.status).toBe('playing');
    expect(await call(a, 'game:shot', { angle: -Math.PI / 2, power: 0.3 })).toEqual({ ok: true });
  });

  it('frees the seat when a player does not return in time', async () => {
    const { a, b, code } = await startMatch();
    const back = stateWhere(a, (v) => v.status === 'lobby' && v.players[1] === null, 3000);
    b.disconnect();
    const v = await back;
    expect(v.notice).toMatch(/did not reconnect/);
    expect(v.players[0]?.ready).toBe(false);
    // The same room code accepts a new friend.
    const c = await client();
    const joined = await call<JoinedInfo>(c, 'room:join', { code, profile: { name: 'New' } });
    expect(joined.ok && joined.seat).toBe(1);
  });

  it('tells the remaining player when the opponent leaves', async () => {
    const { a, b } = await startMatch();
    const left = stateWhere(a, (v) => v.status === 'lobby' && v.players[1] === null);
    await call(b, 'room:leave');
    expect((await left).notice).toMatch(/left the room/);
  });

  it('a second tab resuming the same seat replaces the first', async () => {
    const { a, code, ainfo } = await startMatch();
    const closed = new Promise<{ reason: string }>((r) => a.once('room:closed', r));
    const a2 = await client();
    const res = await call<JoinedInfo>(a2, 'room:resume', { code, playerId: ainfo.playerId, secret: ainfo.secret });
    expect(res.ok).toBe(true);
    expect((await closed).reason).toBe('replaced');
    expect(await call(a, 'game:shot', { angle: 0, power: 0.5 })).toEqual({ ok: false, error: 'NOT_IN_ROOM' });
  });
});

describe('room expiry', () => {
  it('deletes abandoned rooms', async () => {
    game.close();
    await new Promise<void>((r) => ioServer.close(() => r()));
    await boot({ now: () => clock, idleMs: 60_000 });
    const a = await client();
    const created = await call<JoinedInfo>(a, 'room:create', { name: 'A' });
    if (!created.ok) throw new Error();
    const closed = new Promise<{ reason: string }>((r) => a.once('room:closed', r));
    clock += 30_000;
    game.sweep();
    expect(game.rooms.has(created.code)).toBe(true);
    clock += 31_000;
    game.sweep();
    expect(game.rooms.has(created.code)).toBe(false);
    expect((await closed).reason).toBe('expired');
    const b = await client();
    expect(await call(b, 'room:join', { code: created.code, profile: {} })).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});
