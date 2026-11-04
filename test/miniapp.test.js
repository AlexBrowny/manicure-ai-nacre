import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mainMenu } from '../src/bot/keyboards.js';
import { getProfile } from '../src/bot/store.js';
import { loadConfig } from '../src/config.js';
import { listBookings } from '../src/domain/bookings.js';
import { createApp } from '../src/http/app.js';
import { signInitData, verifyInitData } from '../src/http/telegramAuth.js';
import { seedDefaults } from '../src/seed.js';
import { makeCtx } from './helpers.js';

const TOKEN = '123456:TEST-TOKEN';
const NOW = Date.parse('2026-11-03T05:00:00Z');

/** initData так, как его подписал бы Telegram. */
function initData({ user = { id: 4242, first_name: 'Анна', last_name: 'Смирнова' }, authDate = NOW / 1000, token = TOKEN } = {}) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(authDate)), query_id: 'AAE', user: JSON.stringify(user) });
  params.set('hash', signInitData(params, token));
  return params.toString();
}

test('verifyInitData accepts data signed with the bot token', () => {
  const user = verifyInitData(initData(), TOKEN, { now: NOW });
  assert.equal(user.id, 4242);
  assert.equal(user.first_name, 'Анна');
});

test('verifyInitData rejects forged, foreign, stale and empty data', () => {
  assert.throws(() => verifyInitData(initData({ token: '999:OTHER' }), TOKEN, { now: NOW }), { code: 'bad_init_data' });
  const tampered = initData().replace(encodeURIComponent('"id":4242'), encodeURIComponent('"id":1'));
  assert.throws(() => verifyInitData(tampered, TOKEN, { now: NOW }), { code: 'bad_init_data' });
  assert.throws(() => verifyInitData(initData({ authDate: NOW / 1000 - 2 * 86400 }), TOKEN, { now: NOW }), /устарела/);
  for (const junk of ['', undefined, 'hash=zz', 'a=1']) assert.throws(() => verifyInitData(junk, TOKEN, { now: NOW }), { code: 'bad_init_data' });
  assert.throws(() => verifyInitData(initData(), '', { now: NOW }), { code: 'bot_offline' });
});

let server;
let base;
let ctx;
const created = [];

before(async () => {
  ctx = makeCtx({ now: '2026-11-03T05:00:00Z' });
  ctx.cfg.telegram = { token: TOKEN, botUsername: 'nacre_bot', adminChatIds: [], webAppUrl: 'https://studio.example/app/' };
  ctx.cfg.admin = { password: 'x', sessionSecret: 's', sessionHours: 1, cookieSecure: false };
  ctx.cfg.studio = { name: 'Nacré', phone: '+998 90 000-00-00', address: 'ул. 1' };
  seedDefaults(ctx);
  const events = new EventEmitter();
  events.on('booking:created', (b) => created.push(b));
  await new Promise((resolve) => { server = createApp({ ctx, events, logger: { error() {} } }).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const call = async (path, { data = initData(), body } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(data ? { 'X-Telegram-Init-Data': data } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json(), headers: res.headers };
};

test('mini app API refuses requests without valid Telegram data', async () => {
  assert.equal((await call('/api/miniapp/me', { data: null })).status, 401);
  assert.equal((await call('/api/miniapp/me', { data: initData({ token: '1:bad' }) })).status, 401);
});

test('mini app knows the client by Telegram name, and a booking is linked to the chat', async () => {
  const me = await call('/api/miniapp/me');
  assert.deepEqual(me.json.data, { name: 'Анна Смирнова', phone: '' });

  const slot = (await (await fetch(`${base}/api/public/slots?serviceId=1&date=2026-11-04`)).json()).data.slots[0];
  const res = await call('/api/miniapp/bookings', {
    body: { serviceId: 1, masterId: null, date: '2026-11-04', time: slot.time, name: 'Анна Смирнова', phone: '90 111 22 33' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.booking.start, slot.time);
  assert.equal(res.json.data.reminders, 'за 2 часа и за 10 минут');
  assert.equal(res.json.data.booking.clientPhone, undefined, 'телефон наружу не отдаём');

  const [booking] = listBookings(ctx, { from: '2026-11-04', to: '2026-11-04' });
  assert.equal(booking.source, 'telegram');
  assert.equal(booking.tgChatId, 4242);
  assert.equal(created.length, 1, 'администраторы получают уведомление');
  assert.deepEqual({ ...getProfile(ctx.db, 4242) }, { name: 'Анна Смирнова', phone: '+998901112233' });
  assert.equal((await call('/api/miniapp/me')).json.data.phone, '+998901112233', 'телефон подставится в следующий раз');
});

test('the mini app page may be framed by Telegram Web and load the Telegram SDK; the site may not', async () => {
  const app = await fetch(`${base}/app/`);
  assert.equal(app.status, 200);
  const csp = app.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' https:\/\/telegram\.org/);
  assert.match(csp, /frame-ancestors https:\/\/web\.telegram\.org/);
  const site = (await fetch(`${base}/`)).headers.get('content-security-policy');
  assert.match(site, /frame-ancestors 'none'/);
  assert.doesNotMatch(site, /telegram\.org/);
});

test('the bot menu opens the mini app when WEBAPP_URL is set', () => {
  const withApp = mainMenu('https://studio.example/app/').inline_keyboard;
  assert.deepEqual(withApp[0][0], { text: '📅 Календарь записи', web_app: { url: 'https://studio.example/app/' } });
  const plain = mainMenu().inline_keyboard.flat();
  assert.ok(plain.every((b) => !b.web_app));
});

test('WEBAPP_URL must be https', () => {
  assert.equal(loadConfig({}).telegram.webAppUrl, '');
  assert.equal(loadConfig({ WEBAPP_URL: 'https://studio.uz/app/' }).telegram.webAppUrl, 'https://studio.uz/app/');
  assert.throws(() => loadConfig({ WEBAPP_URL: 'http://localhost:3000/app/' }), /https/);
});
