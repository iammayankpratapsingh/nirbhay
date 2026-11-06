import { NextResponse } from 'next/server';
import { AUTH_COOKIE, authToken, gamePassword, safeEqual } from '../../../src/shared/auth';

const attempts = new Map<string, number[]>();

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 10) {
    return NextResponse.json({ ok: false, error: 'Too many tries. Wait a minute.' }, { status: 429 });
  }
  let password = '';
  try {
    const body = await request.json();
    password = typeof body?.password === 'string' ? body.password : '';
  } catch {
    /* empty body */
  }
  if (!safeEqual(password, gamePassword())) {
    recent.push(now);
    attempts.set(ip, recent);
    return NextResponse.json({ ok: false, error: 'Wrong password. Try again.' }, { status: 401 });
  }
  attempts.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await authToken(), {
    httpOnly: true,
    sameSite: 'lax',
    // Secure on HTTPS hosts; plain HTTP still works for LAN play (http://192.168.x.x:3000).
    secure: (request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '')) === 'https',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(AUTH_COOKIE);
  return res;
}
