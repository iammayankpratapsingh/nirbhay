/**
 * Single-process production/dev server: Next.js pages + Socket.IO multiplayer
 * on the same port. Use this on any Node host that supports WebSockets.
 */
import { createServer } from 'node:http';
import next from 'next';
import { Server } from 'socket.io';
import { authToken } from '../src/shared/auth';
import { createGameServer } from './game-server';

const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOST || '0.0.0.0';
const dev = process.env.NODE_ENV !== 'production';

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const httpServer = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    handle(req, res);
  });

  const io = new Server(httpServer, { path: '/socket.io', serveClient: false });
  createGameServer(io, { authToken: await authToken() });

  httpServer.listen(port, hostname, () => {
    console.log(`> Nirbhay: Pen Battle ready on http://localhost:${port} (${dev ? 'development' : 'production'})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
