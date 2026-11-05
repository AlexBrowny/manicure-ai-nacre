import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBot } from '../src/bot/index.js';
import { createApp } from '../src/http/app.js';
import { vercelConfig } from '../scripts/vercel-config.js';
import { makeCtx } from './helpers.js';

const quiet = { error() {}, log() {}, info() {} };
const BOT_INFO = { id: 1, is_bot: true, first_name: 'Nacré', username: 'nacre_test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
let server;
let base;
let reminderRuns = 0;

before(async () => {
  const ctx = await makeCtx();
  ctx.cfg.admin = { password: 'pw', sessionSecret: 's', sessionHours: 1, cookieSecure: false };
  ctx.cfg.telegram = { token: '1:TEST', botUsername: 'nacre_test_bot', adminChatIds: [], webhookSecret: 'hook-secret' };
  ctx.cfg.cronSecret = 'cron-secret';
  const real = createBot({ ctx, token: '1:TEST', botInfo: BOT_INFO, events: new (await import('node:events')).EventEmitter(), logger: quiet });
  const telegram = { ...real, sendReminders: async () => { reminderRuns += 1; return 0; } };
  await new Promise((resolve) => { server = createApp({ ctx, telegram, logger: quiet }).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => server.close());

const post = (path, headers = {}, body = '{}') => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

test('the reminders cron endpoint needs the shared secret', async () => {
  assert.equal((await post('/api/cron/reminders')).status, 401);
  assert.equal((await post('/api/cron/reminders', { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal(reminderRuns, 0);
  const res = await post('/api/cron/reminders', { Authorization: 'Bearer cron-secret' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data, { sent: 0 });
  assert.equal(reminderRuns, 1);
});

test('the Telegram webhook rejects updates without the secret token', async () => {
  const update = JSON.stringify({ update_id: 1 });
  assert.equal((await post('/telegram/webhook', {}, update)).status, 401);
  assert.equal((await post('/telegram/webhook', { 'X-Telegram-Bot-Api-Secret-Token': 'nope' }, update)).status, 401);
  // update без сообщения бот просто пропускает — Telegram получает 200 и не повторяет доставку
  assert.equal((await post('/telegram/webhook', { 'X-Telegram-Bot-Api-Secret-Token': 'hook-secret' }, update)).status, 200);
});

test('vercel.json matches the generator (run npm run vercel:config after changing the CSP)', () => {
  const onDisk = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(onDisk, JSON.parse(JSON.stringify(vercelConfig)));
  for (const prefix of ['/api', '/media', '/telegram']) {
    assert.ok(onDisk.rewrites.some((r) => r.source.startsWith(prefix) && r.destination === '/api'), `${prefix} идёт в функцию`);
  }
});
