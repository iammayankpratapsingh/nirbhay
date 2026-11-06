import { isColorId, sanitizeName, type PenColorId } from '../shared/constants';
import type { Difficulty } from '../shared/ai';

export type Mode = 'cpu' | 'local' | 'online';

export interface Prefs {
  mode: Mode;
  difficulty: Difficulty;
  names: [string, string];
  colors: [PenColorId, PenColorId];
  sound: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  mode: 'cpu',
  difficulty: 'normal',
  names: ['Nirbhay', 'Player 2'],
  colors: ['lime', 'coral'],
  sound: true,
};

const KEY = 'nirbhay-pen-battle:prefs:v1';

/** Personal preferences only. Multiplayer never goes through browser storage. */
export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
    const d = DEFAULT_PREFS;
    return {
      mode: ['cpu', 'local', 'online'].includes(raw.mode) ? raw.mode : d.mode,
      difficulty: ['easy', 'normal', 'hard'].includes(raw.difficulty) ? raw.difficulty : d.difficulty,
      names: [sanitizeName(raw.names?.[0], d.names[0]), sanitizeName(raw.names?.[1], d.names[1])],
      colors: [isColorId(raw.colors?.[0]) ? raw.colors[0] : d.colors[0], isColorId(raw.colors?.[1]) ? raw.colors[1] : d.colors[1]],
      sound: typeof raw.sound === 'boolean' ? raw.sound : d.sound,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode) — preferences just won't persist */
  }
}

/** Per-tab reconnect credentials so a refresh or dropped connection can reclaim the seat. */
const SEAT_KEY = 'nirbhay-pen-battle:seat';
export interface SeatCreds {
  code: string;
  playerId: string;
  secret: string;
}
export function loadSeat(): SeatCreds | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SEAT_KEY) || 'null');
    return v && typeof v.code === 'string' ? v : null;
  } catch {
    return null;
  }
}
export function saveSeat(c: SeatCreds | null) {
  try {
    if (c) sessionStorage.setItem(SEAT_KEY, JSON.stringify(c));
    else sessionStorage.removeItem(SEAT_KEY);
  } catch {
    /* ignore */
  }
}
