/** Password gate helpers. Works in Node and in the Next.js proxy (Web Crypto). */
export const AUTH_COOKIE = 'pb_auth';

export function gamePassword(): string {
  const password = process.env.GAME_PASSWORD;
  if (!password) {
    throw new Error('GAME_PASSWORD is not set. Add it to .env.local (local) or your host environment variables.');
  }
  return password;
}

/** Deterministic token derived from the password: changing the password logs everyone out. */
export async function authToken(password: string = gamePassword()): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('nirbhay-pen-battle/v1'));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function readCookie(header: string | undefined | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
