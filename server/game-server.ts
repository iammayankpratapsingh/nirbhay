import { randomBytes, randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { AUTH_COOKIE, readCookie, safeEqual } from '../src/shared/auth';
import { distinctColor, isColorId, sanitizeName, type PenColorId } from '../src/shared/constants';
import { Match, type Seat } from '../src/shared/match';
import {
  normalizeRoomCode,
  ROOM_ALPHABET,
  ROOM_CODE_LENGTH,
  type Ack,
  type ErrorCode,
  type FrameMsg,
  type JoinedInfo,
  type Profile,
  type PublicPlayer,
  type RoomStatus,
  type RoomView,
} from '../src/shared/protocol';

export interface GameServerOptions {
  /** When set, sockets must present this token (handshake auth or cookie). */
  authToken?: string | null;
  /** How long a disconnected player keeps their seat. */
  graceMs?: number;
  /** Rooms with no activity for this long are deleted. */
  idleMs?: number;
  sweepMs?: number;
  tickMs?: number;
  /** Broadcast a frame every N physics ticks (2 → 30 Hz). */
  frameEvery?: number;
  maxFailedJoinsPerMinute?: number;
  now?: () => number;
  random?: () => number;
}

interface Player {
  id: string;
  secret: string;
  seat: Seat;
  name: string;
  color: PenColorId;
  ready: boolean;
  socketId: string | null;
  disconnectedAt: number | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

export interface Room {
  code: string;
  players: [Player | null, Player | null];
  status: RoomStatus;
  match: Match | null;
  paused: boolean;
  rematch: [boolean, boolean];
  nextFirstTurn: Seat;
  createdAt: number;
  lastActivity: number;
  notice: string | null;
  loop: ReturnType<typeof setInterval> | null;
  seq: number;
}

interface SocketData {
  code?: string;
  playerId?: string;
  fails?: number[];
}

const channel = (code: string) => `room:${code}`;
const token = () => randomBytes(18).toString('base64url');

function asProfile(raw: unknown): Profile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { name: sanitizeName(r.name), color: isColorId(r.color) ? r.color : 'ice' };
}

export function createGameServer(io: Server, opts: GameServerOptions = {}) {
  const graceMs = opts.graceMs ?? 60_000;
  const idleMs = opts.idleMs ?? 30 * 60_000;
  const tickMs = opts.tickMs ?? 1000 / 60;
  const frameEvery = opts.frameEvery ?? 2;
  const maxFails = opts.maxFailedJoinsPerMinute ?? 10;
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const rooms = new Map<string, Room>();

  if (opts.authToken) {
    const expected = opts.authToken;
    io.use((socket, next) => {
      const given =
        (typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null) ??
        readCookie(socket.handshake.headers.cookie, AUTH_COOKIE);
      if (given && safeEqual(given, expected)) next();
      else next(new Error('UNAUTHORIZED'));
    });
  }

  // ---------- helpers ----------
  function newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  }

  const data = (s: Socket) => s.data as SocketData;

  function currentSeat(socket: Socket): { room: Room; player: Player } | null {
    const d = data(socket);
    if (!d.code || !d.playerId) return null;
    const room = rooms.get(d.code);
    if (!room) return null;
    const player = room.players.find((p) => p?.id === d.playerId) ?? null;
    if (!player || player.socketId !== socket.id) return null;
    return { room, player };
  }

  function view(room: Room, you: Seat): RoomView {
    const t = now();
    const players = room.players.map((p): PublicPlayer | null =>
      p
        ? {
            seat: p.seat,
            name: p.name,
            color: p.color,
            ready: p.ready,
            connected: p.socketId !== null,
            graceMs: p.disconnectedAt === null ? null : Math.max(0, graceMs - (t - p.disconnectedAt)),
          }
        : null,
    );
    return {
      code: room.code,
      status: room.status,
      paused: room.paused,
      you,
      players,
      match: room.match ? room.match.snapshot() : null,
      rematch: [...room.rematch],
      notice: room.notice,
    };
  }

  function broadcast(room: Room) {
    for (const p of room.players) {
      if (p?.socketId) io.to(p.socketId).emit('room:state', view(room, p.seat));
    }
  }

  function touch(room: Room) {
    room.lastActivity = now();
  }

  function stopLoop(room: Room) {
    if (room.loop) clearInterval(room.loop);
    room.loop = null;
  }

  function sendFrame(room: Room) {
    if (!room.match) return;
    const snap = room.match.sim.snapshot();
    const msg: FrameMsg = { seq: ++room.seq, t: now(), pens: snap, hits: room.match.sim.hits };
    io.to(channel(room.code)).emit('game:frame', msg);
  }

  function startLoop(room: Room) {
    if (room.loop) return;
    let n = 0;
    room.loop = setInterval(() => {
      const m = room.match;
      if (!m || m.phase !== 'moving') return stopLoop(room);
      if (room.paused) return;
      const resolved = m.tick();
      n++;
      if (resolved || n % frameEvery === 0) sendFrame(room);
      if (resolved) {
        stopLoop(room);
        if ((m.phase as string) === "over") room.status = "over";
        touch(room);
        broadcast(room);
      }
    }, tickMs);
  }

  function updatePause(room: Room) {
    const present = room.players.filter((p): p is Player => !!p);
    room.paused = room.status !== 'lobby' && present.some((p) => p.socketId === null);
  }

  function maybeStart(room: Room) {
    const [a, b] = room.players;
    if (room.status !== 'lobby' || !a || !b) return;
    if (!a.ready || !b.ready || !a.socketId || !b.socketId) return;
    room.match = new Match({ firstTurn: room.nextFirstTurn, random });
    room.nextFirstTurn = room.nextFirstTurn === 0 ? 1 : 0;
    room.status = 'playing';
    room.rematch = [false, false];
    room.notice = null;
    room.paused = false;
  }

  function deleteRoom(room: Room, reason: string) {
    stopLoop(room);
    for (const p of room.players) {
      if (!p) continue;
      if (p.graceTimer) clearTimeout(p.graceTimer);
      if (p.socketId) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) {
          s.emit('room:closed', { reason });
          s.leave(channel(room.code));
          data(s).code = undefined;
          data(s).playerId = undefined;
        }
      }
    }
    rooms.delete(room.code);
  }

  function removePlayer(room: Room, seat: Seat, why: 'left' | 'timeout') {
    const p = room.players[seat];
    if (!p) return;
    if (p.graceTimer) clearTimeout(p.graceTimer);
    if (p.socketId) {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) {
        s.leave(channel(room.code));
        data(s).code = undefined;
        data(s).playerId = undefined;
      }
    }
    room.players[seat] = null;
    const other = room.players[seat === 0 ? 1 : 0];
    if (!other) return deleteRoom(room, 'empty');
    stopLoop(room);
    room.status = 'lobby';
    room.match = null;
    room.paused = false;
    room.rematch = [false, false];
    other.ready = false;
    room.notice =
      why === 'left'
        ? `${p.name} left the room. Share the code to invite someone else.`
        : `${p.name} did not reconnect in time. Share the code to invite someone else.`;
    touch(room);
    broadcast(room);
  }

  function seatPlayer(socket: Socket, room: Room, player: Player) {
    const d = data(socket);
    d.code = room.code;
    d.playerId = player.id;
    player.socketId = socket.id;
    player.disconnectedAt = null;
    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = null;
    socket.join(channel(room.code));
  }

  function leaveCurrent(socket: Socket) {
    const cur = currentSeat(socket);
    if (cur) removePlayer(cur.room, cur.player.seat, 'left');
  }

  function failJoin(socket: Socket, ack: Ack<JoinedInfo>, error: ErrorCode) {
    const d = data(socket);
    d.fails = [...(d.fails ?? []), now()];
    ack({ ok: false, error });
  }

  function rateLimited(socket: Socket): boolean {
    const d = data(socket);
    const t = now();
    d.fails = (d.fails ?? []).filter((x) => t - x < 60_000);
    return d.fails.length >= maxFails;
  }

  const safeAck = <T>(ack: unknown): Ack<T> => (typeof ack === 'function' ? (ack as Ack<T>) : () => {});

  // ---------- connection handling ----------
  io.on('connection', (socket) => {
    socket.on('room:create', (rawProfile: unknown, rawAck: unknown) => {
      const ack = safeAck<JoinedInfo>(rawAck);
      leaveCurrent(socket);
      const profile = asProfile(rawProfile);
      const t = now();
      const room: Room = {
        code: newCode(),
        players: [null, null],
        status: 'lobby',
        match: null,
        paused: false,
        rematch: [false, false],
        nextFirstTurn: 0,
        createdAt: t,
        lastActivity: t,
        notice: null,
        loop: null,
        seq: 0,
      };
      const player: Player = {
        id: token(),
        secret: token(),
        seat: 0,
        ...profile,
        ready: false,
        socketId: null,
        disconnectedAt: null,
        graceTimer: null,
      };
      room.players[0] = player;
      rooms.set(room.code, room);
      seatPlayer(socket, room, player);
      ack({ ok: true, code: room.code, seat: 0, playerId: player.id, secret: player.secret });
      broadcast(room);
    });

    socket.on('room:join', (raw: unknown, rawAck: unknown) => {
      const ack = safeAck<JoinedInfo>(rawAck);
      if (rateLimited(socket)) return ack({ ok: false, error: 'RATE_LIMITED' });
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const code = normalizeRoomCode(r.code);
      if (!code) return failJoin(socket, ack, 'BAD_CODE');
      const room = rooms.get(code);
      if (!room) return failJoin(socket, ack, 'NOT_FOUND');
      const cur = currentSeat(socket);
      if (cur?.room === room) return ack({ ok: false, error: 'ALREADY_IN_ROOM' });
      const seat = room.players[0] === null ? 0 : room.players[1] === null ? 1 : null;
      if (seat === null) return ack({ ok: false, error: 'FULL' });
      leaveCurrent(socket);
      if (!rooms.has(code)) return failJoin(socket, ack, 'NOT_FOUND');
      const profile = asProfile(r.profile);
      const other = room.players[seat === 0 ? 1 : 0];
      const player: Player = {
        id: token(),
        secret: token(),
        seat,
        name: profile.name,
        color: distinctColor(profile.color, other?.color ?? null),
        ready: false,
        socketId: null,
        disconnectedAt: null,
        graceTimer: null,
      };
      room.players[seat] = player;
      room.notice = null;
      seatPlayer(socket, room, player);
      touch(room);
      ack({ ok: true, code, seat, playerId: player.id, secret: player.secret });
      broadcast(room);
    });

    socket.on('room:resume', (raw: unknown, rawAck: unknown) => {
      const ack = safeAck<JoinedInfo>(rawAck);
      if (rateLimited(socket)) return ack({ ok: false, error: 'RATE_LIMITED' });
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const code = normalizeRoomCode(r.code);
      const room = code ? rooms.get(code) : undefined;
      if (!code || !room) return failJoin(socket, ack, 'NOT_FOUND');
      const player = room.players.find((p) => p && p.id === r.playerId) ?? null;
      if (!player || typeof r.secret !== 'string' || !safeEqual(player.secret, r.secret)) {
        return failJoin(socket, ack, 'BAD_CREDENTIALS');
      }
      // Another tab/socket held this seat: detach it.
      if (player.socketId && player.socketId !== socket.id) {
        const old = io.sockets.sockets.get(player.socketId);
        if (old) {
          old.emit('room:closed', { reason: 'replaced' });
          old.leave(channel(room.code));
          data(old).code = undefined;
          data(old).playerId = undefined;
        }
      }
      const cur = currentSeat(socket);
      if (cur && cur.room !== room) removePlayer(cur.room, cur.player.seat, 'left');
      seatPlayer(socket, room, player);
      updatePause(room);
      maybeStart(room);
      touch(room);
      ack({ ok: true, code, seat: player.seat, playerId: player.id, secret: player.secret });
      broadcast(room);
      if (room.match?.phase === 'moving') startLoop(room);
    });

    socket.on('lobby:profile', (raw: unknown, rawAck: unknown) => {
      const ack = safeAck(rawAck);
      const cur = currentSeat(socket);
      if (!cur) return ack({ ok: false, error: 'NOT_IN_ROOM' });
      if (cur.room.status !== 'lobby') return ack({ ok: false, error: 'NOT_IN_LOBBY' });
      const profile = asProfile(raw);
      const other = cur.room.players[cur.player.seat === 0 ? 1 : 0];
      cur.player.name = profile.name;
      cur.player.color = distinctColor(profile.color, other?.color ?? null);
      touch(cur.room);
      ack({ ok: true });
      broadcast(cur.room);
    });

    socket.on('lobby:ready', (ready: unknown, rawAck: unknown) => {
      const ack = safeAck(rawAck);
      const cur = currentSeat(socket);
      if (!cur) return ack({ ok: false, error: 'NOT_IN_ROOM' });
      if (cur.room.status !== 'lobby') return ack({ ok: false, error: 'NOT_IN_LOBBY' });
      cur.player.ready = ready === true;
      touch(cur.room);
      maybeStart(cur.room);
      ack({ ok: true });
      broadcast(cur.room);
    });

    socket.on('game:shot', (raw: unknown, rawAck: unknown) => {
      const ack = safeAck(rawAck);
      const cur = currentSeat(socket);
      if (!cur) return ack({ ok: false, error: 'NOT_IN_ROOM' });
      const { room, player } = cur;
      if (!room.match || room.status === 'lobby') return ack({ ok: false, error: 'NOT_PLAYING' });
      if (room.paused) return ack({ ok: false, error: 'PAUSED' });
      const res = room.match.shoot(player.seat, raw);
      if (!res.ok) return ack({ ok: false, error: res.reason });
      touch(room);
      ack({ ok: true });
      io.to(channel(room.code)).emit('game:shot', { seat: player.seat, shot: res.shot });
      broadcast(room);
      startLoop(room);
    });

    socket.on('game:rematch', (rawAck: unknown) => {
      const ack = safeAck(rawAck);
      const cur = currentSeat(socket);
      if (!cur) return ack({ ok: false, error: 'NOT_IN_ROOM' });
      const { room, player } = cur;
      if (room.status !== 'over') return ack({ ok: false, error: 'NOT_PLAYING' });
      room.rematch[player.seat] = true;
      touch(room);
      if (room.rematch[0] && room.rematch[1]) {
        room.status = 'lobby';
        maybeStart(room);
      }
      ack({ ok: true });
      broadcast(room);
    });

    socket.on('room:leave', (rawAck: unknown) => {
      leaveCurrent(socket);
      safeAck(rawAck)({ ok: true });
    });

    socket.on('disconnect', () => {
      const cur = currentSeat(socket);
      if (!cur) return;
      const { room, player } = cur;
      player.socketId = null;
      player.disconnectedAt = now();
      player.graceTimer = setTimeout(() => {
        if (rooms.get(room.code) === room && player.socketId === null && room.players[player.seat] === player) {
          removePlayer(room, player.seat, 'timeout');
        }
      }, graceMs);
      updatePause(room);
      broadcast(room);
    });
  });

  // ---------- expiry ----------
  function sweep() {
    const t = now();
    for (const room of [...rooms.values()]) {
      const present = room.players.filter((p): p is Player => !!p);
      const allGone = present.every((p) => p.socketId === null && p.disconnectedAt !== null && t - p.disconnectedAt >= graceMs);
      if (t - room.lastActivity >= idleMs || allGone) deleteRoom(room, 'expired');
    }
  }
  const sweeper = setInterval(sweep, opts.sweepMs ?? 15_000);
  sweeper.unref?.();

  return {
    rooms,
    sweep,
    close() {
      clearInterval(sweeper);
      for (const room of [...rooms.values()]) deleteRoom(room, 'shutdown');
    },
  };
}

export type GameServer = ReturnType<typeof createGameServer>;
