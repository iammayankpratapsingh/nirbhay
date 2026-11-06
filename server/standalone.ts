/**
 * Multiplayer-only server (no Next.js). Use this when the website is hosted on
 * Vercel, which cannot keep WebSocket servers running. Set ALLOWED_ORIGINS to
 * your site URL(s), comma separated, e.g. https://nirbhay-pen-battle.vercel.app
 */
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { authToken } from '../src/shared/auth';
import { createGameServer } from './game-server';

const port = Number(process.env.PORT || 3001);
const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const httpServer = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(req.url === '/healthz' ? 'ok' : 'Nirbhay: Pen Battle multiplayer server');
  });
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    cors: { origin: origins, credentials: true },
  });
  createGameServer(io, { authToken: await authToken() });
  httpServer.listen(port, () => {
    console.log(`> Multiplayer server on :${port}, allowing ${origins.join(', ')}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
