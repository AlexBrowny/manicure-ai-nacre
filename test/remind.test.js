import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBot } from '../src/bot/index.js';
import { loadConfig } from '../src/config.js';
import { createBooking } from '../src/domain/bookings.js';
import { createApp } from '../src/http/app.js';
import { seedDefaults } from '../src/seed.js';
import { makeCtx } from './helpers.js';

const quiet = { error() {}, log() {} };
let server;
let base;
let ctx;
const runtime = {};
const sent = [];

before(async () => {
  ctx = await makeCtx({ now: '2026-11-03T05:00:00Z' });
  ctx.cfg.admin = { password: 'pw', sessionSecret: 'secret', sessionHours: 1, cookieSecure: false };
  ctx.cfg.telegram = { token: '', botUsername: '', adminChatIds: [] };
  ctx.cfg.studio = { name: 'Nacré', phone: '+998 90 000-00-00', address: 'ул. Тестовая, 1' };
  await seedDefaults(ctx);
  runtime.sendReminder = async (booking) => { sent.push(booking.id); };
  await new Promise((resolve) => { server = createApp({ ctx, runtime, logger: quiet }).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => server.close());

async function login() {
  const res = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'pw' }) });
  return res.headers.get('set-cookie').split(';')[0];
}

const remind = async (id, cookie) => {
  const res = await fetch(`${base}/api/admin/bookings/${id}/remind`, { method: 'POST', headers: { Cookie: cookie } });
  return { status: res.status, json: await res.json() };
};

const book = (extra) => createBooking(ctx, {
  serviceId: 1, masterId: null, date: '2026-11-03', startMin: 720, name: 'Клиентка', phone: '+998901112233', source: 'web', ...extra,
});

test('admin can send a reminder to a Telegram-linked client and the time is recorded', async () => {
  const cookie = await login();
  const booking = await book({ source: 'telegram', tgChatId: 77 });
  const res = await remind(booking.id, cookie);
  assert.equal(res.status, 200);
  assert.deepEqual(sent, [booking.id]);
  assert.ok(res.json.data.lastRemindedAt);
  const again = await remind(booking.id, cookie);
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'too_soon');
});

test('reminding a client without Telegram explains why it is impossible', async () => {
  const cookie = await login();
  const booking = await book({ startMin: 900, phone: '+998902223344' });
  const res = await remind(booking.id, cookie);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'no_telegram');
});

test('the remind endpoint requires an admin session and reports a stopped bot', async () => {
  const booking = await book({ startMin: 960, phone: '+998903334455', source: 'telegram', tgChatId: 78 });
  assert.equal((await remind(booking.id, 'nacre_admin=nope')).status, 401);
  const saved = runtime.sendReminder;
  delete runtime.sendReminder;
  const res = await remind(booking.id, await login());
  runtime.sendReminder = saved;
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'bot_offline');
});

test('the bot sends a manual reminder and surfaces Telegram failures', async () => {
  const dctx = await makeCtx({ now: '2026-11-03T05:00:00Z' });
  dctx.cfg.telegram = { token: 'T:T', botUsername: 'b', adminChatIds: [] };
  dctx.cfg.studio = { name: 'Nacré', phone: '+998 90 000-00-00', address: 'ул. 1' };
  await seedDefaults(dctx);
  const botRuntime = {};
  const app = createBot({
    ctx: dctx, events: new EventEmitter(), token: 'T:T', logger: quiet, runtime: botRuntime,
    botInfo: { id: 1, is_bot: true, first_name: 'b', username: 'b', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false },
  });
  const calls = [];
  let fail = false;
  app.bot.api.config.use((prev, method, payload) => {
    calls.push({ method, payload });
    if (fail) return Promise.resolve({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    return Promise.resolve({ ok: true, result: { message_id: 1, date: 0, chat: { id: payload.chat_id, type: 'private' } } });
  });
  const booking = await createBooking(dctx, {
    serviceId: 1, masterId: null, date: '2026-11-03', startMin: 720, name: 'Анна', phone: '+998901112233', source: 'telegram', tgChatId: 55,
  });
  assert.equal(typeof botRuntime.sendReminder, 'function', 'бот отдаёт функцию для админки');
  await botRuntime.sendReminder(booking);
  assert.equal(calls.at(-1).payload.chat_id, 55);
  assert.match(calls.at(-1).payload.text, /Напоминаем о вашей записи/);
  fail = true;
  await assert.rejects(botRuntime.sendReminder(booking), { code: 'send_failed' });
});

test('REMINDER_MINUTES config is parsed and validated', async () => {
  assert.deepEqual(loadConfig({}).reminderMinutes, [120, 10]);
  assert.deepEqual(loadConfig({ REMINDER_MINUTES: '1440, 120, 10' }).reminderMinutes, [1440, 120, 10]);
  assert.throws(() => loadConfig({ REMINDER_MINUTES: '120,abc' }), /REMINDER_MINUTES/);
  assert.throws(() => loadConfig({ REMINDER_MINUTES: '0' }), /REMINDER_MINUTES/);
});
