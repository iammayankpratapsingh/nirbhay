import type { PenColorId } from './constants';
import type { MatchSnapshot, Seat } from './match';
import type { PenState } from './physics';

/** 31 unambiguous characters (no 0/O, 1/I/L). 31^6 ≈ 887 million codes. */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_ALPHABET.includes(ch)) return null;
  return code;
}

export interface Profile {
  name: string;
  color: PenColorId;
}

export interface PublicPlayer extends Profile {
  seat: Seat;
  ready: boolean;
  connected: boolean;
  /** Milliseconds left before a disconnected player loses their seat. */
  graceMs: number | null;
}

export type RoomStatus = 'lobby' | 'playing' | 'over';

export interface RoomView {
  code: string;
  status: RoomStatus;
  paused: boolean;
  you: Seat;
  players: (PublicPlayer | null)[];
  match: MatchSnapshot | null;
  rematch: boolean[];
  notice: string | null;
}

export interface FrameMsg {
  seq: number;
  /** Server clock (ms) when the frame was produced. */
  t: number;
  pens: PenState[];
  hits: number;
}

export type ErrorCode =
  | 'BAD_CODE'
  | 'NOT_FOUND'
  | 'FULL'
  | 'RATE_LIMITED'
  | 'BAD_CREDENTIALS'
  | 'NOT_IN_ROOM'
  | 'NOT_PLAYING'
  | 'PAUSED'
  | 'NOT_YOUR_TURN'
  | 'PENS_MOVING'
  | 'GAME_OVER'
  | 'INVALID_SHOT'
  | 'NOT_IN_LOBBY'
  | 'ALREADY_IN_ROOM';

export type Ack<T = Record<string, never>> = (res: ({ ok: true } & T) | { ok: false; error: ErrorCode }) => void;

export interface JoinedInfo {
  code: string;
  seat: Seat;
  playerId: string;
  secret: string;
}

export const ERROR_TEXT: Record<ErrorCode, string> = {
  BAD_CODE: 'Room codes are 6 letters/numbers. Check the code and try again.',
  NOT_FOUND: 'No room with that code. It may have expired.',
  FULL: 'That room already has two players.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  BAD_CREDENTIALS: 'Your seat in that room is no longer available.',
  NOT_IN_ROOM: 'You are not in a room.',
  NOT_PLAYING: 'The match has not started.',
  PAUSED: 'The match is paused while a player reconnects.',
  NOT_YOUR_TURN: "It is not your turn.",
  PENS_MOVING: 'Wait for the pens to stop moving.',
  GAME_OVER: 'The match is over.',
  INVALID_SHOT: 'That shot was not valid.',
  NOT_IN_LOBBY: 'You can only change that in the lobby.',
  ALREADY_IN_ROOM: 'You are already in a room.',
};
