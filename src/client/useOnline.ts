'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { lerpAngle } from '../shared/geometry';
import type { PenState, Shot } from '../shared/physics';
import { ERROR_TEXT, type ErrorCode, type FrameMsg, type JoinedInfo, type Profile, type RoomView } from '../shared/protocol';
import type { ArenaScene } from './Arena';
import { loadSeat, saveSeat } from './prefs';
import { sfx } from './sound';

export type Conn = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'unauthorized';

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };

const CLOSED_TEXT: Record<string, string> = {
  expired: 'The room expired after being inactive.',
  replaced: 'You opened this room in another tab, so this tab was disconnected.',
  empty: 'The room closed.',
  shutdown: 'The game server restarted. Create a new room to keep playing.',
};

const INTERP_DELAY = 85;

export function useOnline(active: boolean) {
  const socketRef = useRef<Socket | null>(null);
  const roomRef = useRef<RoomView | null>(null);
  const framesRef = useRef<{ at: number; pens: PenState[] }[]>([]);
  const matchKeyRef = useRef(0);
  const soundRef = useRef({ hits: 0, out: [false, false] });
  const [conn, setConn] = useState<Conn>('idle');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applyRoom = useCallback((v: RoomView | null) => {
    const prev = roomRef.current;
    if (v?.status === 'playing' && (!prev || prev.status !== 'playing' || prev.code !== v.code)) {
      matchKeyRef.current++;
      soundRef.current = { hits: v.match?.hits ?? 0, out: [false, false] };
    }
    if (v?.status === 'over' && prev?.status === 'playing') {
      setTimeout(() => (v.match?.draw ? sfx.draw() : sfx.win()), 250);
    }
    if (!v || v.match?.phase !== 'moving') framesRef.current = [];
    roomRef.current = v;
    setRoom(v);
  }, []);

  const connect = useCallback(async () => {
    if (socketRef.current) {
      if (!socketRef.current.connected) socketRef.current.connect();
      return;
    }
    setConn('connecting');
    let token = '';
    let url: string | null = null;
    try {
      const res = await fetch('/api/session', { cache: 'no-store' });
      if (res.status === 401) {
        setConn('unauthorized');
        return;
      }
      const body = (await res.json()) as { token: string; multiplayerUrl: string | null };
      token = body.token;
      url = body.multiplayerUrl;
    } catch {
      setConn('offline');
      return;
    }
    const s = io(url ?? undefined, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 700,
      reconnectionDelayMax: 4000,
      timeout: 7000,
    });
    socketRef.current = s;
    let everConnected = false;

    s.on('connect', () => {
      everConnected = true;
      setConn('connected');
      const creds = loadSeat();
      if (!creds) return;
      s.timeout(6000).emit('room:resume', creds, (err: unknown, res: Res<JoinedInfo>) => {
        if (err) return;
        if (!res.ok) {
          saveSeat(null);
          applyRoom(null);
          setError(res.error === 'RATE_LIMITED' ? ERROR_TEXT.RATE_LIMITED : 'Your previous room is no longer available.');
        }
      });
    });
    s.on('disconnect', (reason) => {
      setConn(reason === 'io client disconnect' ? 'idle' : 'reconnecting');
    });
    s.on('connect_error', (err) => {
      if (err.message === 'UNAUTHORIZED') {
        setConn('unauthorized');
        s.disconnect();
        return;
      }
      setConn(everConnected || roomRef.current ? 'reconnecting' : 'offline');
    });
    s.on('room:state', (v: RoomView) => applyRoom(v));
    s.on('room:closed', ({ reason }: { reason: string }) => {
      saveSeat(null);
      applyRoom(null);
      setError(CLOSED_TEXT[reason] ?? 'The room closed.');
    });
    s.on('game:shot', ({ shot }: { shot: Shot }) => sfx.flick(shot.power));
    s.on('game:frame', (f: FrameMsg) => {
      const buf = framesRef.current;
      buf.push({ at: performance.now(), pens: f.pens });
      if (buf.length > 40) buf.splice(0, buf.length - 40);
      const snd = soundRef.current;
      if (f.hits > snd.hits) sfx.hit();
      if (f.pens.some((p, i) => p.out && !snd.out[i])) sfx.fall();
      soundRef.current = { hits: f.hits, out: f.pens.map((p) => p.out) };
    });
  }, [applyRoom]);

  useEffect(() => {
    if (active) void connect();
  }, [active, connect]);

  useEffect(
    () => () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    },
    [],
  );

  const request = useCallback(async <T,>(event: string, ...args: unknown[]): Promise<Res<T> | null> => {
    const s = socketRef.current;
    if (!s?.connected) {
      setError('Not connected to the multiplayer server yet.');
      return null;
    }
    try {
      return (await s.timeout(7000).emitWithAck(event, ...args)) as Res<T>;
    } catch {
      setError('The server did not respond. Check your connection and try again.');
      return null;
    }
  }, []);

  const enter = useCallback(
    async (event: 'room:create' | 'room:join', payload: unknown) => {
      setBusy(true);
      setError(null);
      const res = await request<JoinedInfo>(event, payload);
      setBusy(false);
      if (!res) return false;
      if (!res.ok) {
        setError(ERROR_TEXT[res.error] ?? 'Something went wrong.');
        return false;
      }
      saveSeat({ code: res.code, playerId: res.playerId, secret: res.secret });
      return true;
    },
    [request],
  );

  const create = useCallback((profile: Profile) => enter('room:create', profile), [enter]);
  const join = useCallback((code: string, profile: Profile) => enter('room:join', { code, profile }), [enter]);

  const simple = useCallback(
    async (event: string, ...args: unknown[]) => {
      const res = await request(event, ...args);
      if (res && !res.ok) setError(ERROR_TEXT[res.error] ?? 'Something went wrong.');
      return !!res?.ok;
    },
    [request],
  );

  const setReady = useCallback((ready: boolean) => simple('lobby:ready', ready), [simple]);
  const updateProfile = useCallback((p: Profile) => simple('lobby:profile', p), [simple]);
  const rematch = useCallback(() => simple('game:rematch'), [simple]);
  const shoot = useCallback(
    (shot: Shot) => {
      setError(null);
      void simple('game:shot', shot);
    },
    [simple],
  );

  const leave = useCallback(async () => {
    saveSeat(null);
    applyRoom(null);
    setError(null);
    const s = socketRef.current;
    if (s?.connected) await s.timeout(3000).emitWithAck('room:leave').catch(() => undefined);
  }, [applyRoom]);

  const retry = useCallback(() => {
    setError(null);
    const s = socketRef.current;
    if (!s) return void connect();
    s.disconnect();
    setConn('connecting');
    s.connect();
  }, [connect]);

  const getScene = useCallback(
    (colorsFallback: ArenaScene['colors']): ArenaScene | null => {
      const v = roomRef.current;
      if (!v?.match) return null;
      let pens = v.match.pens;
      const buf = framesRef.current;
      if (v.match.phase === 'moving' && buf.length) {
        const t = performance.now() - INTERP_DELAY;
        let i = buf.length - 1;
        while (i > 0 && buf[i - 1].at > t) i--;
        const b = buf[i];
        const a = buf[Math.max(0, i - 1)];
        const span = b.at - a.at;
        const k = span > 0 ? Math.max(0, Math.min(1, (t - a.at) / span)) : 1;
        pens = b.pens.map((pb, j) => {
          const pa = a.pens[j];
          if (pb.out || pa.out) return pb;
          return { ...pb, x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k, angle: lerpAngle(pa.angle, pb.angle, k) };
        });
      }
      const canAim =
        conn === 'connected' && v.status === 'playing' && !v.paused && v.match.phase === 'aiming' && v.match.turn === v.you;
      return {
        pens,
        colors: v.players.map((p, i) => p?.color ?? colorsFallback[i]),
        tags: v.players.map((p, i) => (i === v.you ? `${p?.name ?? 'You'} (you)` : p?.name ?? '')),
        turn: v.match.turn,
        phase: v.match.phase,
        aimable: canAim ? v.you : null,
        preview: null,
        matchKey: matchKeyRef.current,
      };
    },
    [conn],
  );

  return { conn, room, error, setError, busy, create, join, setReady, updateProfile, rematch, shoot, leave, retry, getScene };
}
