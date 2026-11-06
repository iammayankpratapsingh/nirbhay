'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty } from '../shared/ai';
import { distinctColor, NAME_MAX, PEN_COLORS, penColor, sanitizeName, type PenColorId } from '../shared/constants';
import { startingPoses } from '../shared/physics';
import { normalizeRoomCode, type RoomView } from '../shared/protocol';
import Arena, { type ArenaScene } from './Arena';
import HowToDialog from './HowToDialog';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Mode, type Prefs } from './prefs';
import { setSoundEnabled, sfx } from './sound';
import { useLocalGame } from './useLocalGame';
import { useOnline, type Conn } from './useOnline';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'cpu', label: 'Vs Computer', hint: 'Battle the desk bot' },
  { id: 'local', label: 'Pass & Play', hint: 'Two players, one device' },
  { id: 'online', label: 'Online', hint: 'Friends on two devices' },
];

const DIFFS: { id: Difficulty; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'normal', label: 'Normal' },
  { id: 'hard', label: 'Hard' },
];

const IDLE_POSES = startingPoses();

function useReducedMotion() {
  const [rm, setRm] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setRm(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return rm;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function Swatch({ color, size = 14 }: { color: PenColorId; size?: number }) {
  return <span className="swatch" style={{ background: penColor(color).base, width: size, height: size }} aria-hidden="true" />;
}

function ColorPicker({
  value,
  onChange,
  blocked,
  label,
}: {
  value: PenColorId;
  onChange: (c: PenColorId) => void;
  blocked?: PenColorId | null;
  label: string;
}) {
  return (
    <fieldset className="colors">
      <legend className="field-label">{label}</legend>
      <div className="color-row">
        {PEN_COLORS.map((c) => {
          const taken = blocked === c.id;
          return (
            <label key={c.id} className={`color-opt${taken ? ' is-taken' : ''}`} title={taken ? `${c.label} (opponent)` : c.label}>
              <input
                type="radio"
                name={label}
                value={c.id}
                checked={value === c.id}
                disabled={taken}
                onChange={() => onChange(c.id)}
              />
              <span className="color-dot" style={{ background: `linear-gradient(135deg, ${c.light}, ${c.base} 45%, ${c.dark})` }} />
              <span className="sr-only">
                {c.label}
                {taken ? ' (taken by opponent)' : ''}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function NameField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        value={value}
        maxLength={NAME_MAX}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const CONN_TEXT: Record<Conn, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  offline: 'Server unreachable',
  unauthorized: 'Session expired',
};

function ConnBadge({ conn, onRetry }: { conn: Conn; onRetry: () => void }) {
  return (
    <span className={`conn conn-${conn}`} role="status">
      <span className="conn-dot" aria-hidden="true" />
      {CONN_TEXT[conn]}
      {(conn === 'offline' || conn === 'reconnecting') && (
        <button className="link-btn" onClick={onRetry}>
          Retry
        </button>
      )}
      {conn === 'unauthorized' && (
        <button className="link-btn" onClick={() => window.location.reload()}>
          Unlock
        </button>
      )}
    </span>
  );
}

const Icon = {
  sound: (on: boolean) => (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {on ? (
        <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1.2" fill="currentColor" />
    </svg>
  ),
  chevron: (open: boolean) => (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

export default function PenBattle() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [invited, setInvited] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [graceDeadline, setGraceDeadline] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const howRef = useRef<HTMLDialogElement>(null);
  const meterRef = useRef<HTMLSpanElement>(null);
  const meterTextRef = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();

  // Load prefs + invitation link once on the client.
  useEffect(() => {
    const p = loadPrefs();
    const code = normalizeRoomCode(new URLSearchParams(window.location.search).get('room'));
    if (code) {
      setInvited(code);
      setJoinCode(code);
      p.mode = 'online';
    }
    setPrefs(p);
    setSoundEnabled(p.sound);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) savePrefs(prefs);
  }, [prefs, hydrated]);

  const update = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  const setName = (i: 0 | 1, v: string) =>
    setPrefs((p) => ({ ...p, names: (i === 0 ? [v, p.names[1]] : [p.names[0], v]) as [string, string] }));
  const setColor = (i: 0 | 1, c: PenColorId) =>
    setPrefs((p) => {
      const colors = [...p.colors] as [PenColorId, PenColorId];
      colors[i] = c;
      const other = i === 0 ? 1 : 0;
      colors[other] = distinctColor(colors[other], c);
      return { ...p, colors };
    });

  const mode = prefs.mode;
  const names: [string, string] = [sanitizeName(prefs.names[0], 'Player 1'), sanitizeName(prefs.names[1], 'Player 2')];
  const colors: [PenColorId, PenColorId] = [prefs.colors[0], distinctColor(prefs.colors[1], prefs.colors[0])];
  const diffLabel = DIFFS.find((d) => d.id === prefs.difficulty)!.label;
  const tags: [string, string] = mode === 'cpu' ? [names[0], `CPU · ${diffLabel}`] : names;

  const local = useLocalGame({ vsComputer: mode === 'cpu', difficulty: prefs.difficulty, colors, tags });
  const online = useOnline(hydrated && mode === 'online');
  const room = online.room;
  const inRoom = mode === 'online' && !!room;

  // Changing mode or difficulty ends any local match.
  const { stop: stopLocal } = local;
  useEffect(() => {
    stopLocal();
  }, [mode, prefs.difficulty, stopLocal]);

  // Keep the online lobby in sync with the profile.
  const profile = useMemo(() => ({ name: names[0], color: prefs.colors[0] }), [names[0], prefs.colors[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const { updateProfile } = online;
  useEffect(() => {
    if (room?.status !== 'lobby') return;
    const me = room.players[room.you];
    if (me && me.name === profile.name && me.color === profile.color) return;
    const t = setTimeout(() => void updateProfile(profile), 450);
    return () => clearTimeout(t);
  }, [profile, room?.status, room?.code, updateProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opponent reconnect countdown.
  const opp = room ? room.players[room.you === 0 ? 1 : 0] : null;
  useEffect(() => {
    setGraceDeadline(opp && !opp.connected && opp.graceMs !== null ? Date.now() + opp.graceMs : null);
  }, [opp?.connected, opp?.graceMs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (graceDeadline === null) return;
    const i = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(i);
  }, [graceDeadline]);

  // Collapse the mobile settings panel once a match is under way.
  const playing = (mode !== 'online' && local.status.active) || (inRoom && room!.status !== 'lobby');
  useEffect(() => {
    if (playing) setPanelOpen(false);
  }, [playing]);

  // Clean the invite out of the URL once used.
  useEffect(() => {
    if (room && invited) {
      window.history.replaceState(null, '', window.location.pathname);
      setInvited(null);
    }
  }, [room, invited]);

  const idleScene = useCallback(
    (): ArenaScene => ({
      pens: IDLE_POSES.map((p) => ({ ...p, vx: 0, vy: 0, av: 0, out: false })),
      colors,
      tags: mode === 'online' ? ['', ''] : tags,
      turn: 0,
      phase: 'aiming',
      aimable: null,
      preview: null,
      matchKey: -1,
    }),
    [colors[0], colors[1], tags[0], tags[1], mode], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const getScene = useCallback(() => {
    const s = mode === 'online' ? online.getScene(colors) : local.getScene();
    if (s) return s;
    const idle = idleScene();
    return { ...idle, turn: 1 as const, phase: 'over' as const };
  }, [mode, online.getScene, local.getScene, idleScene]); // eslint-disable-line react-hooks/exhaustive-deps

  const onShot = mode === 'online' ? online.shoot : local.shoot;

  const onAim = useCallback((power: number | null) => {
    const pct = power === null ? 0 : Math.round(power * 100);
    if (meterRef.current) {
      meterRef.current.style.transform = `scaleX(${pct / 100})`;
      meterRef.current.dataset.level = pct > 80 ? 'high' : pct > 45 ? 'mid' : 'low';
    }
    if (meterTextRef.current) meterTextRef.current.textContent = power === null ? '—' : `${pct}%`;
  }, []);

  // ---------- status line ----------
  let statusText = '';
  let statusColor: PenColorId | null = null;
  if (mode !== 'online') {
    const s = local.status;
    if (!s.active) statusText = 'Press Start to battle';
    else if (s.phase === 'over') statusText = s.draw ? 'Draw! Both pens fell.' : `${tags[s.winner!]} wins!`;
    else if (s.phase === 'moving') statusText = 'Pens moving…';
    else if (mode === 'cpu' && s.turn === 1) statusText = 'Computer is aiming…';
    else {
      statusText = `${names[s.turn]}'s turn — drag back from your pen`;
      statusColor = colors[s.turn];
    }
  } else if (!room) {
    statusText = 'Create or join a room';
  } else if (room.status === 'lobby') {
    statusText = room.players[0] && room.players[1] ? 'Lobby — waiting for both players to be ready' : 'Lobby — waiting for a friend to join';
  } else if (room.paused || online.conn !== 'connected') {
    statusText = 'Paused — waiting for reconnection';
  } else if (room.match) {
    const m = room.match;
    if (m.phase === 'over') statusText = m.draw ? 'Draw! Both pens fell.' : m.winner === room.you ? 'You win!' : `${room.players[m.winner!]?.name} wins!`;
    else if (m.phase === 'moving') statusText = 'Pens moving…';
    else if (m.turn === room.you) {
      statusText = 'Your turn — drag back from your pen';
      statusColor = room.players[room.you]?.color ?? null;
    } else {
      statusText = `${room.players[m.turn]?.name ?? 'Opponent'}'s turn`;
      statusColor = room.players[m.turn]?.color ?? null;
    }
  }
  useEffect(() => {
    if (statusText !== 'Pens moving…') setAnnounce(statusText);
  }, [statusText]);

  const doCopy = async (what: 'code' | 'link') => {
    if (!room) return;
    const text = what === 'code' ? room.code : `${window.location.origin}/?room=${room.code}`;
    if (await copyText(text)) {
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    }
  };

  const toggleSound = () => {
    const on = !prefs.sound;
    update({ sound: on });
    setSoundEnabled(on);
    if (on) sfx.click();
  };

  const startLocal = () => {
    sfx.click();
    local.start();
  };

  // ---------- overlays ----------
  function overlay(): React.ReactNode {
    if (mode !== 'online') {
      const s = local.status;
      if (!s.active) {
        return (
          <div className="card overlay-card">
            <p className="eyebrow">{mode === 'cpu' ? `Vs Computer · ${diffLabel}` : 'Pass & Play'}</p>
            <h2 className="display card-title">Ready to flick?</h2>
            <p className="muted">
              {mode === 'cpu'
                ? `${names[0]} vs the desk bot. Knock its pen off the table.`
                : `${names[0]} vs ${names[1]}. Pass the device after each shot.`}
            </p>
            <button className="btn btn-primary btn-lg" onClick={startLocal} autoFocus>
              Start match
            </button>
          </div>
        );
      }
      if (s.phase === 'over') {
        return (
          <div className="card overlay-card result" role="dialog" aria-label="Match result">
            {s.draw ? (
              <>
                <p className="eyebrow">Both pens hit the floor</p>
                <h2 className="display card-title">It&apos;s a draw!</h2>
              </>
            ) : (
              <>
                <p className="eyebrow">Last pen standing</p>
                <h2 className="display card-title">
                  <Swatch color={colors[s.winner!]} size={18} /> {tags[s.winner!]} wins!
                </h2>
              </>
            )}
            <div className="btn-row">
              <button className="btn btn-primary btn-lg" onClick={startLocal} autoFocus>
                Rematch
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  local.stop();
                  setPanelOpen(true);
                }}
              >
                Change settings
              </button>
            </div>
          </div>
        );
      }
      return null;
    }

    // ----- online -----
    if (!room) {
      const canAct = online.conn === 'connected' && !online.busy;
      return (
        <div className="card overlay-card online-card">
          <p className="eyebrow">Online multiplayer</p>
          <h2 className="display card-title">Play a friend</h2>
          {invited && <p className="invite-banner">You were invited to room <strong>{invited}</strong>. Pick your name and colour, then join.</p>}
          <ConnBadge conn={online.conn} onRetry={online.retry} />
          {online.conn === 'offline' && (
            <p className="muted small">
              The multiplayer server could not be reached. Local modes still work. If this site is on Vercel, the
              multiplayer server must be deployed separately (see README).
            </p>
          )}
          <button className="btn btn-primary btn-lg" disabled={!canAct} onClick={() => void online.create(profile)}>
            {online.busy ? 'Working…' : 'Create room'}
          </button>
          <div className="or">
            <span>or join with a code</span>
          </div>
          <form
            className="join-row"
            onSubmit={(e) => {
              e.preventDefault();
              void online.join(joinCode, profile);
            }}
          >
            <label htmlFor="join-code" className="sr-only">
              Room code
            </label>
            <input
              id="join-code"
              className="input code-input"
              placeholder="ABC234"
              value={joinCode}
              maxLength={8}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
            <button className="btn btn-secondary" disabled={!canAct || joinCode.trim().length < 6} autoFocus={!!invited}>
              Join
            </button>
          </form>
          {online.error && (
            <p className="form-error" role="alert">
              {online.error}
            </p>
          )}
        </div>
      );
    }

    const meDisconnected = online.conn !== 'connected';
    if (meDisconnected) {
      return (
        <div className="card overlay-card" role="alertdialog" aria-label="Connection lost">
          <p className="eyebrow">Game paused</p>
          <h2 className="display card-title">Connection lost</h2>
          <p className="muted">Trying to reconnect you to room {room.code}. Your seat is saved for about a minute.</p>
          <ConnBadge conn={online.conn} onRetry={online.retry} />
          <div className="btn-row">
            <button className="btn btn-primary" onClick={online.retry}>
              Retry now
            </button>
            <button className="btn btn-ghost" onClick={() => void online.leave()}>
              Leave room
            </button>
          </div>
        </div>
      );
    }

    if (room.status === "lobby") return lobby(room);

    if (room.paused && opp && !opp.connected) {
      const secs = graceDeadline ? Math.max(0, Math.ceil((graceDeadline - Date.now()) / 1000)) : 0;
      return (
        <div className="card overlay-card" role="alertdialog" aria-label="Opponent disconnected">
          <p className="eyebrow">Game paused</p>
          <h2 className="display card-title">{opp.name} lost connection</h2>
          <p className="muted">
            Waiting for them to come back{secs ? ` (${secs}s)` : '…'}. If they don&apos;t, their seat opens up and you can invite
            someone else with the same code.
          </p>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => void online.leave()}>
              Leave room
            </button>
          </div>
        </div>
      );
    }

    if (room.status === 'over' && room.match) {
      const m = room.match;
      const mine = room.rematch[room.you];
      const theirs = room.rematch[room.you === 0 ? 1 : 0];
      return (
        <div className="card overlay-card result" role="dialog" aria-label="Match result">
          {m.draw ? (
            <>
              <p className="eyebrow">Both pens hit the floor</p>
              <h2 className="display card-title">It&apos;s a draw!</h2>
            </>
          ) : (
            <>
              <p className="eyebrow">{m.winner === room.you ? 'Last pen standing' : 'Knocked off!'}</p>
              <h2 className="display card-title">
                <Swatch color={room.players[m.winner!]?.color ?? 'ice'} size={18} />{' '}
                {m.winner === room.you ? 'You win!' : `${room.players[m.winner!]?.name} wins!`}
              </h2>
            </>
          )}
          {theirs && !mine && <p className="muted">{opp?.name} wants a rematch!</p>}
          <div className="btn-row">
            <button className="btn btn-primary btn-lg" disabled={mine} onClick={() => void online.rematch()} autoFocus>
              {mine ? `Waiting for ${opp?.name ?? 'opponent'}…` : 'Rematch'}
            </button>
            <button className="btn btn-ghost" onClick={() => void online.leave()}>
              Leave room
            </button>
          </div>
        </div>
      );
    }
    return null;
  }

  function lobby(room: RoomView) {
    const me = room.players[room.you];
    const both = !!(room.players[0] && room.players[1]);
    return (
      <div className="card overlay-card lobby" aria-label="Lobby">
        <p className="eyebrow">Room code</p>
        <p className="room-code" aria-label={`Room code ${room.code.split('').join(' ')}`}>
          {room.code}
        </p>
        <div className="btn-row">
          <button className="btn btn-secondary btn-sm" onClick={() => void doCopy('code')}>
            {copied === 'code' ? 'Copied!' : 'Copy code'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => void doCopy('link')}>
            {copied === 'link' ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>
        <ul className="players">
          {room.players.map((p, i) => (
            <li key={i} className={p ? '' : 'empty'}>
              {p ? (
                <>
                  <Swatch color={p.color} size={16} />
                  <span className="pname">
                    {p.name}
                    {i === room.you ? ' (you)' : ''}
                  </span>
                  <span className={`pill ${!p.connected ? 'pill-warn' : p.ready ? 'pill-ok' : ''}`}>
                    {!p.connected ? 'Reconnecting' : p.ready ? 'Ready' : 'Not ready'}
                  </span>
                </>
              ) : (
                <span className="muted">Waiting for a friend… share the code</span>
              )}
            </li>
          ))}
        </ul>
        {room.notice && <p className="notice">{room.notice}</p>}
        <div className="btn-row">
          <button
            className={`btn btn-lg ${me?.ready ? 'btn-ghost' : 'btn-primary'}`}
            onClick={() => void online.setReady(!me?.ready)}
            aria-pressed={!!me?.ready}
          >
            {me?.ready ? 'Not ready' : "I'm ready"}
          </button>
          <button className="btn btn-ghost" onClick={() => void online.leave()}>
            Leave
          </button>
        </div>
        <p className="muted small">{both ? 'The match starts when both players are ready.' : 'Your friend can join from any device.'}</p>
        {online.error && (
          <p className="form-error" role="alert">
            {online.error}
          </p>
        )}
      </div>
    );
  }

  const ov = overlay();
  const arenaLabel = `Pen battle table. ${statusText}. ${
    'Drag backwards from your pen to aim, or press Enter, then arrow keys to aim and adjust power, and Enter to shoot.'
  }`;

  return (
    <div className="app">
      <aside className={`panel ${panelOpen ? 'is-open' : ''}`} aria-label="Game settings">
        <div className="panel-top">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true" />
            <div>
              <h1 className="brand-title">
                Nirbhay<span className="brand-colon">:</span> Pen Battle
              </h1>
            </div>
          </div>
          <div className="top-actions">
            <button
              className="icon-btn"
              onClick={toggleSound}
              aria-pressed={prefs.sound}
              aria-label={prefs.sound ? 'Sound on' : 'Sound off'}
              title={prefs.sound ? 'Sound on' : 'Sound off'}
            >
              {Icon.sound(prefs.sound)}
            </button>
            <button className="icon-btn" onClick={() => howRef.current?.showModal()} aria-label="How to play" title="How to play">
              {Icon.help}
            </button>
            <button
              className="icon-btn panel-toggle"
              onClick={() => setPanelOpen((o) => !o)}
              aria-expanded={panelOpen}
              aria-controls="settings-body"
            >
              <span className="toggle-text">{panelOpen ? 'Hide' : 'Setup'}</span>
              {Icon.chevron(panelOpen)}
            </button>
          </div>
        </div>

        <div className="panel-body" id="settings-body">
          <header className="hero">
            <h2 className="display hero-title">Your desk. Your battleground.</h2>
            <p className="hero-sub">Flick it. Fight it. Be the last pen standing.</p>
          </header>

          <section className="section" aria-labelledby="mode-h">
            <h3 id="mode-h" className="section-title">
              Game mode
            </h3>
            <div className="mode-tabs" role="radiogroup" aria-labelledby="mode-h">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={mode === m.id}
                  className={`mode-tab ${mode === m.id ? 'is-active' : ''}`}
                  disabled={inRoom && m.id !== 'online'}
                  title={inRoom && m.id !== 'online' ? 'Leave the online room first' : m.hint}
                  onClick={() => update({ mode: m.id })}
                >
                  <span className="mode-label">{m.label}</span>
                  <span className="mode-hint">{m.hint}</span>
                </button>
              ))}
            </div>
          </section>

          {mode === 'cpu' && (
            <section className="section" aria-labelledby="diff-h">
              <h3 id="diff-h" className="section-title">
                Difficulty
              </h3>
              <div className="seg" role="radiogroup" aria-labelledby="diff-h">
                {DIFFS.map((d) => (
                  <button
                    key={d.id}
                    role="radio"
                    aria-checked={prefs.difficulty === d.id}
                    className={`seg-btn ${prefs.difficulty === d.id ? 'is-active' : ''}`}
                    onClick={() => update({ difficulty: d.id })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="section" aria-labelledby="p1-h">
            <h3 id="p1-h" className="section-title">
              <Swatch color={colors[0]} /> {mode === 'local' ? 'Player 1' : 'You'}
            </h3>
            <NameField id="name-0" label="Display name" value={prefs.names[0]} onChange={(v) => setName(0, v)} />
            <ColorPicker
              label="Pen colour"
              value={prefs.colors[0]}
              onChange={(c) => setColor(0, c)}
              blocked={mode === 'online' ? (opp?.color ?? null) : null}
            />
          </section>

          {mode !== 'online' && (
            <section className="section" aria-labelledby="p2-h">
              <h3 id="p2-h" className="section-title">
                <Swatch color={colors[1]} /> {mode === 'cpu' ? 'Computer' : 'Player 2'}
              </h3>
              {mode === 'local' && (
                <NameField id="name-1" label="Display name" value={prefs.names[1]} onChange={(v) => setName(1, v)} />
              )}
              <ColorPicker label="Opponent pen colour" value={colors[1]} onChange={(c) => setColor(1, c)} blocked={colors[0]} />
            </section>
          )}

          {mode !== 'online' ? (
            <button className="btn btn-primary btn-lg btn-block" onClick={startLocal}>
              {local.status.active ? 'Restart match' : 'Start match'}
            </button>
          ) : (
            <section className="section" aria-labelledby="room-h">
              <h3 id="room-h" className="section-title">
                Room
              </h3>
              <ConnBadge conn={online.conn} onRetry={online.retry} />
              {room ? (
                <>
                  <p className="room-line">
                    Code <strong className="mono">{room.code}</strong>
                  </p>
                  <div className="btn-row">
                    <button className="btn btn-secondary btn-sm" onClick={() => void doCopy('code')}>
                      {copied === 'code' ? 'Copied!' : 'Copy code'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => void doCopy('link')}>
                      {copied === 'link' ? 'Copied!' : 'Copy invite link'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => void online.leave()}>
                      Leave room
                    </button>
                  </div>
                  {room.status !== 'lobby' && <p className="muted small">Name and colour can be changed in the lobby.</p>}
                </>
              ) : (
                <p className="muted small">Create a room and send the code or link to a friend on another device.</p>
              )}
            </section>
          )}

          <footer className="panel-foot">
            <button className="link-btn" onClick={() => howRef.current?.showModal()}>
              How to play
            </button>
            <p className="dedication">Made for Nirbhay Rajput.</p>
          </footer>
        </div>
      </aside>

      <main className="stage">
        <div className="statusbar">
          <p className="turn" aria-hidden="true">
            {statusColor && <Swatch color={statusColor} size={14} />}
            <span>{statusText}</span>
          </p>
          <div className="meter" aria-hidden="true">
            <span className="meter-label">Power</span>
            <span className="meter-track">
              <span className="meter-fill" ref={meterRef} />
            </span>
            <span className="meter-val" ref={meterTextRef}>
              —
            </span>
          </div>
          {mode === 'online' && <ConnBadge conn={online.conn} onRetry={online.retry} />}
        </div>
        <div className="arena">
          <Arena getScene={getScene} onShot={onShot} onAim={onAim} reducedMotion={reducedMotion} label={arenaLabel} />
          {ov && <div className="overlay">{ov}</div>}
        </div>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </main>

      <HowToDialog ref={howRef} />
    </div>
  );
}
