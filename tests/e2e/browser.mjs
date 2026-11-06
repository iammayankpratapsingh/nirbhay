// End-to-end browser test: node tests/e2e/browser.mjs [baseUrl] [screenshotDir]
// Requires a running server (npm run build && PORT=3100 npm start) and `npx playwright install chromium`.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3100';
const BASE2 = BASE.replace('localhost', '127.0.0.1');
const SHOTS = process.argv[3] || 'test-results';
const PASSWORD = process.env.GAME_PASSWORD;
if (!PASSWORD) throw new Error("Set GAME_PASSWORD to run the e2e test");
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function unlock(page, url = BASE) {
  await page.goto(url);
  await page.waitForURL(/\/unlock/);
  await page.fill('#pw', PASSWORD);
  await page.click('button:has-text("Enter the arena")');
  await page.waitForURL((u) => !u.pathname.startsWith('/unlock'));
  await page.waitForSelector('canvas.arena-canvas');
}

const status = (page) => page.locator('.turn span').last().innerText();
const waitStatus = (page, re, timeout = 20000) =>
  page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.turn span:last-child')?.textContent || ''), re.source, { timeout });

const pen = (page, seat) => page.evaluate((s) => window.__penBattle.penOnScreen(s), seat);

/** Drag back from `seat`'s pen, away from the opponent, so it flies at them. */
async function flick(page, seat, power = 0.55) {
  const me = await pen(page, seat);
  const them = await pen(page, seat === 0 ? 1 : 0);
  const scale = await page.evaluate(() => window.__penBattle.worldScale());
  const dx = them.x - me.x;
  const dy = them.y - me.y;
  const len = Math.hypot(dx, dy);
  const dist = power * 230 * scale;
  await page.mouse.move(me.x, me.y);
  await page.mouse.down();
  await page.mouse.move(me.x - (dx / len) * dist, me.y - (dy / len) * dist, { steps: 8 });
  const meter = await page.locator('.meter-val').innerText();
  await page.mouse.up();
  return meter;
}

const browser = await chromium.launch();
try {
  // ---------- Password gate ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    check('unauthenticated visit redirects to /unlock', page.url().includes('/unlock'));
    await page.fill('#pw', 'wrong-password');
    await page.click('button:has-text("Enter the arena")');
    await page.waitForSelector('.form-error');
    check('wrong password is rejected', (await page.locator('.form-error').innerText()).includes('Wrong password'));
    await page.screenshot({ path: `${SHOTS}/01-unlock.png` });
    await page.fill('#pw', PASSWORD);
    await page.click('button:has-text("Enter the arena")');
    await page.waitForSelector('canvas.arena-canvas');
    check('correct password opens the game', true);

    // ---------- Desktop layout & copy ----------
    const text = await page.locator('body').innerText();
    for (const s of ['Your desk. Your battleground.', 'Flick it. Fight it. Be the last pen standing.', 'Made for Nirbhay Rajput.']) {
      check(`shows "${s}"`, text.includes(s));
    }
    check('default name is Nirbhay', (await page.inputValue('#name-0')) === 'Nirbhay');
    const panelBox = await page.locator('.panel').boundingBox();
    const arenaBox = await page.locator('.arena').boundingBox();
    check('desktop: settings sidebar left of arena', panelBox.x < arenaBox.x && arenaBox.width > 700, `arena ${Math.round(arenaBox.width)}px wide`);

    // ---------- How to play dialog ----------
    await page.click('button[aria-label="How to play"]');
    check('How to Play dialog opens', await page.locator('dialog.dialog').evaluate((d) => d.open));
    await page.screenshot({ path: `${SHOTS}/02-howto.png` });
    await page.keyboard.press('Escape');
    check('How to Play closes with Esc', !(await page.locator('dialog.dialog').evaluate((d) => d.open)));

    // ---------- Vs Computer ----------
    await page.click('.seg-btn:has-text("Hard")');
    await page.click('.overlay button:has-text("Start match")');
    await waitStatus(page, /Nirbhay's turn/);
    check('vs computer: human starts', true);
    const p1Before = await pen(page, 1);
    const meter = await flick(page, 0, 0.8);
    check('power meter shows drag power', /^\d+%$/.test(meter), meter);
    await waitStatus(page, /Pens moving|Computer is aiming|wins|Draw/, 3000);
    check('shot fired by drag', true, await status(page));
    await waitStatus(page, /Computer is aiming|wins|Draw/, 15000);
    const p1After = await pen(page, 1);
    check('collision moved the computer pen', Math.hypot(p1After.x - p1Before.x, p1After.y - p1Before.y) > 3);
    await page.screenshot({ path: `${SHOTS}/03-desktop-cpu.png` });
    await waitStatus(page, /Nirbhay's turn|wins|Draw/, 20000);
    check('computer takes its turn and play returns', true, await status(page));
    await page.screenshot({ path: `${SHOTS}/04-desktop-after-cpu.png` });

    // ---------- Keyboard shot ----------
    if (/Nirbhay's turn/.test(await status(page))) {
      await page.locator('canvas.arena-canvas').focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowUp');
      const kbMeter = await page.locator('.meter-val').innerText();
      await page.keyboard.press('Enter');
      await waitStatus(page, /Pens moving|Computer is aiming|wins|Draw/, 3000);
      check('keyboard aiming + shooting works', true, `power ${kbMeter}`);
    }

    // ---------- Preferences persist ----------
    await page.click('.mode-tab:has-text("Pass & Play")');
    await page.fill('#name-0', 'Nirbhay R');
    await page.fill('#name-1', 'Kabir');
    await page.click('.color-opt[title="Gold"]');
    await page.reload();
    await page.waitForSelector('#name-1');
    const persisted =
      (await page.inputValue('#name-0')) === 'Nirbhay R' &&
      (await page.inputValue('#name-1')) === 'Kabir' &&
      (await page.locator('.color-opt[title="Gold"] input').first().isChecked());
    check('preferences saved locally (mode, names, colour)', persisted);
    // Opponent cannot pick the same colour.
    check('opponent colour picker blocks your colour', await page.locator('.colors').nth(1).locator('input[value="gold"]').isDisabled());

    // ---------- Pass & play turn switching ----------
    await page.click('.overlay button:has-text("Start match")');
    await waitStatus(page, /Nirbhay R's turn/);
    const notAimable = await pen(page, 1);
    check('pass & play: only the current player may aim', notAimable.aimable === 0);
    await flick(page, 0, 0.3);
    await waitStatus(page, /Kabir's turn|wins|Draw/, 15000);
    check('pass & play: turn passes after pens stop', /Kabir's turn/.test(await status(page)), await status(page));
    await page.screenshot({ path: `${SHOTS}/05-desktop-passplay.png` });
    await ctx.close();
  }

  // ---------- Mobile ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const page = await ctx.newPage();
    await unlock(page);
    await page.screenshot({ path: `${SHOTS}/06-mobile-setup.png` });
    const panel = await page.locator('.panel').boundingBox();
    const arena = await page.locator('.arena').boundingBox();
    check('mobile: settings above arena', panel.y < arena.y);
    await page.click('.overlay button:has-text("Start match")');
    await page.waitForTimeout(300);
    const noScroll = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
    check('mobile: no page scrolling while playing', noScroll);
    check('mobile: table rotated to fill portrait screen', await page.evaluate(() => window.__penBattle.rotated()));
    const arena2 = await page.locator('.arena').boundingBox();
    check('mobile: settings collapse during play so arena is large', arena2.height > 600, `${Math.round(arena2.height)}px tall`);
    const me = await pen(page, 0);
    const them = await pen(page, 1);
    const scale = await page.evaluate(() => window.__penBattle.worldScale());
    const dx = them.x - me.x, dy = them.y - me.y, len = Math.hypot(dx, dy);
    // Touch drag via CDP touch events
    const cdp = await ctx.newCDPSession(page);
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(me.x, me.y) });
    for (let i = 1; i <= 8; i++) {
      const d = (i / 8) * 0.5 * 230 * scale;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(me.x - (dx / len) * d, me.y - (dy / len) * d) });
    }
    await page.screenshot({ path: `${SHOTS}/07-mobile-aiming.png` });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitStatus(page, /Pens moving|Computer is aiming|wins|Draw/, 3000);
    check('mobile: touch drag fires a shot', true);
    await waitStatus(page, /Computer is aiming|wins|Draw/, 15000);
    await page.screenshot({ path: `${SHOTS}/08-mobile-play.png` });
    await ctx.close();
  }

  // ---------- Online: two separate browser contexts ----------
  {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctxB = await browser.newContext({ viewport: { width: 1000, height: 760 } });
    const A = await ctxA.newPage();
    const B = await ctxB.newPage();
    await unlock(A);
    await A.click('.mode-tab:has-text("Online")');
    await A.waitForSelector('.overlay .conn-connected', { timeout: 10000 });
    check('online: connects to multiplayer server', true);
    await A.click('button:has-text("Create room")');
    await A.waitForSelector('.room-code');
    const code = (await A.locator('.room-code').innerText()).trim();
    check('online: room created with short code', /^[A-Z2-9]{6}$/.test(code), code);
    await A.screenshot({ path: `${SHOTS}/09-online-lobby-host.png` });

    // Friend uses the invitation link on a different origin/context (separate cookies & storage).
    await unlock(B, `${BASE2}/?room=ZZZZZZ`);
    await B.waitForSelector('.overlay .conn-connected', { timeout: 10000 });
    await B.click('.overlay button:has-text("Join")');
    await B.waitForSelector('.overlay .form-error');
    check('online: invalid code shows an error', (await B.locator('.overlay .form-error').innerText()).includes('No room'));
    await B.goto(`${BASE2}/?room=${code}`);
    await B.waitForSelector('.invite-banner');
    check('online: invitation link pre-fills the code', (await B.inputValue('#join-code')) === code);
    await B.fill('#name-0', 'Friend');
    await B.click('.overlay button:has-text("Join")');
    await B.waitForSelector('.room-code');
    await A.waitForFunction(() => document.querySelectorAll('.players li:not(.empty)').length === 2);
    const lobbyNames = await A.locator('.players .pname').allInnerTexts();
    check('online: lobby lists both players', lobbyNames.join('|').includes('Nirbhay') && lobbyNames.join('|').includes('Friend'), lobbyNames.join(', '));
    const colorsDiffer = await A.evaluate(() => {
      const s = [...document.querySelectorAll('.players .swatch')].map((e) => e.style.background);
      return s.length === 2 && s[0] !== s[1];
    });
    check('online: opponents have different colours', colorsDiffer);

    await A.click('button:has-text("I\'m ready")');
    await B.waitForSelector('.players .pill-ok');
    check('online: ready status visible to the other player', true);
    await A.screenshot({ path: `${SHOTS}/10-online-lobby-ready.png` });
    check('online: match does not start until both are ready', /Lobby/.test(await status(A)));
    await B.click('button:has-text("I\'m ready")');
    await waitStatus(A, /Your turn/, 8000);
    await waitStatus(B, /Nirbhay's turn/, 8000);
    check('online: match starts when both ready', true);
    check('online: friend cannot aim on host\'s turn', (await pen(B, 1)).aimable === null);

    const beforeOnB = await pen(B, 0);
    await flick(A, 0, 0.45);
    await waitStatus(B, /Pens moving|Your turn|wins|Draw/, 5000);
    await B.waitForTimeout(250);
    const movingOnB = await pen(B, 0);
    check('online: shot is mirrored on the other device', Math.hypot(movingOnB.x - beforeOnB.x, movingOnB.y - beforeOnB.y) > 2);
    await waitStatus(B, /Your turn|wins|Draw/, 15000);
    const aPen0 = await pen(A, 0);
    const bPen0 = await pen(B, 0);
    check('online: friend gets the turn after pens stop', /Your turn/.test(await status(B)), await status(B));
    check('online: both devices agree on final positions', Math.abs(aPen0.angle - bPen0.angle) < 1e-6, `angle ${aPen0.angle.toFixed(4)} vs ${bPen0.angle.toFixed(4)}`);
    await B.screenshot({ path: `${SHOTS}/11-online-friend-turn.png` });

    // Disconnect: friend's network drops.
    await ctxB.setOffline(true);
    await A.waitForSelector('text=lost connection', { timeout: 15000 });
    check('online: host sees pause when friend disconnects', true);
    await A.screenshot({ path: `${SHOTS}/12-online-opponent-disconnected.png` });
    await B.waitForSelector('text=Connection lost', { timeout: 15000 });
    check('online: friend sees recovery options while offline', await B.locator('button:has-text("Retry now")').isVisible());
    await B.screenshot({ path: `${SHOTS}/13-online-connection-lost.png` });
    await ctxB.setOffline(false);
    await B.click('button:has-text("Retry now")');
    await waitStatus(B, /Your turn/, 15000);
    await waitStatus(A, /Friend's turn/, 15000);
    check('online: reconnect resumes the same match and turn', true);

    // Refresh also keeps the seat.
    await B.reload();
    await waitStatus(B, /Your turn/, 15000);
    check('online: page refresh reclaims the seat', true);
    await flick(B, 1, 0.4);
    await waitStatus(A, /Your turn|wins|Draw/, 15000);
    check('online: play continues after reconnect', true, await status(A));

    await B.click('.panel button:has-text("Leave room")');
    await A.waitForSelector('text=left the room', { timeout: 8000 });
    check('online: host is told when the friend leaves', true);
    await A.screenshot({ path: `${SHOTS}/14-online-opponent-left.png` });
    await ctxA.close();
    await ctxB.close();
  }
} catch (err) {
  check('unexpected error', false, String(err?.message || err).split('\n')[0]);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
