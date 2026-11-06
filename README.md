# Nirbhay: Pen Battle

*Your desk. Your battleground.* Flick it. Fight it. Be the last pen standing.

A browser version of tabletop pen fighting, made for Nirbhay Rajput. Players take turns flicking their pen to knock the other pen off a wooden table. The last pen left on the table wins. If both pens fall on the same shot, it's a draw.

- **Vs Computer**: Easy, Normal or Hard. The bot tests possible shots with the real physics engine before it shoots.
- **Pass & Play**: two players on one device.
- **Online**: two devices join one room with a 6-character code or an invite link. The server runs the physics and decides the result.

The game asks for a password before it opens. Set the password with the `GAME_PASSWORD` environment variable (required). For local development, put `GAME_PASSWORD=...` in `.env.local`, which is git-ignored.

## Tech

Next.js 16 (React 19, TypeScript), Matter.js physics, and Node.js + Socket.IO for multiplayer. The browser and the server use the same physics and rules code (`src/shared`). No accounts, API keys, paid services, chat, ads or tracking.

```
app/                 Next.js pages: game (/), password screen (/unlock), API routes
proxy.ts             Password gate (Next.js 16 "proxy", formerly middleware)
src/shared/          Physics (Matter.js), rules, AI, protocol, auth: used by browser AND server
src/client/          React UI, canvas renderer, local-game + online hooks, sound
server/game-server.ts  Authoritative Socket.IO rooms (turns, shots, physics, reconnects, expiry)
server/index.ts      One process: Next.js + Socket.IO on the same port
server/standalone.ts Multiplayer-only server (for when the website is on Vercel)
tests/               Vitest unit + real Socket.IO integration tests, Playwright browser test
```

## Run it locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev            # development server with hot reload: http://localhost:3000
```

Production build:

```bash
npm run build
npm start              # http://localhost:3000 (PORT=xxxx to change)
```

Open the page, enter the password, and play.

### Play online from two devices on the same Wi-Fi

1. Run `npm run dev` (or `npm run build && npm start`) on your computer.
2. Find your computer's local IP address (macOS: `ipconfig getifaddr en0`, for example `192.168.1.20`).
3. On both devices, open `http://192.168.1.20:3000`. Your computer can use `http://localhost:3000`.
4. Device 1: choose **Online**, then **Create room**. Tap **Copy invite link**, or read the code out loud.
5. Device 2: open the invite link, or choose **Online**, type the code and tap **Join**.
6. Both players tap **I'm ready**. The match starts when both are ready.

If a device can't connect, allow Node.js through your computer's firewall.

## Tests

```bash
npm test               # 33 tests: rules, physics, AI, and real Socket.IO server + clients
npm run typecheck
# Browser test (needs a running production server and Chromium):
npx playwright install chromium
npm run build && PORT=3100 npm start &
npm run e2e -- http://localhost:3100
```

The tests cover:

- Turn enforcement
- Shot-power clamping and rejection of bad shots
- Pens are eliminated only once they have completely left the table, and pens balanced past the edge tip off
- Win, self-knockout and draw detection
- Room create and join, invalid, full and rate-limited codes, and password-token checks
- Out-of-turn, outsider and spoofed-seat shots
- Pause on disconnect, reconnect with the saved seat, seat freed after the grace period, leaving the room, a second tab taking over the seat
- Rematch in the same room, and expiry of abandoned rooms

## Deploying

### Option A: one Node host (simplest, everything works)

Use any host that runs a long-lived Node process with WebSockets, such as Render, Railway, Fly.io or a VPS.

- Build: `npm ci && npm run build`
- Start: `npm start` (uses `$PORT`)
- Environment: `GAME_PASSWORD` (required)
- Health check: `/healthz`

On Render you can use the included `render.yaml`: New → Blueprint → choose your repo. The free plan sleeps when nobody is using it, so the first visit can take about 30 s.

### Option B: Vercel for the website, plus a separate multiplayer server

Vercel runs serverless functions. They cannot keep a Socket.IO/WebSocket server running, so online play needs a second, small server somewhere else. Vs Computer and Pass & Play work on Vercel without it.

1. **Multiplayer server** (for example a Render "Web Service" from this repo):
   - Build: `npm ci && npm run build:server`
   - Start: `npm run start:multiplayer`
   - Environment: `GAME_PASSWORD` (must match Vercel) and `ALLOWED_ORIGINS=https://your-app.vercel.app`
2. **Vercel**: import the repo (framework: Next.js, default settings). Set these environment variables:
   - `GAME_PASSWORD` (same value as on the multiplayer server)
   - `MULTIPLAYER_URL=https://your-multiplayer-server.onrender.com`
3. Redeploy. The Online tab now connects to the multiplayer server. The server only accepts players who unlocked the site, because it checks a token derived from the password.

If `MULTIPLAYER_URL` isn't set on Vercel, the Online tab shows "Server unreachable" and the local modes keep working.

## Notes

- Personal preferences (mode, difficulty, names, colours, sound) are saved in `localStorage`. Multiplayer state never uses browser storage. A tab keeps only its own reconnect credentials, in `sessionStorage`, so a refresh can get its seat back.
- A disconnected player keeps their seat for 60 s and the match pauses meanwhile. If they don't come back, the seat opens and the same code can be shared again. Rooms with no activity are deleted after 30 minutes.
- `npm run zip` creates `nirbhay-pen-battle-source.zip` without `node_modules`, build output or `.env` files.
