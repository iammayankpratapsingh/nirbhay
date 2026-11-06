import { NextResponse } from 'next/server';
import { authToken } from '../../../src/shared/auth';

export const dynamic = 'force-dynamic';

/**
 * Only reachable once unlocked (see proxy.ts). Hands the client the token the
 * multiplayer server checks, and where that server lives (null = same origin).
 */
export async function GET() {
  return NextResponse.json(
    { token: await authToken(), multiplayerUrl: process.env.MULTIPLAYER_URL || null },
    { headers: { 'cache-control': 'no-store' } },
  );
}
