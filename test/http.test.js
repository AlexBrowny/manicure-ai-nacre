import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createApp } from '../src/http/app.js';
import { seedDefaults } from '../src/seed.js';
import { makeCtx } from './helpers.js';

let server;
let base;
let ctx;
const events = new EventEmitter();
const emitted = [];
events.on('booking:created', (b) => emitted.push(['created', b.id]));
events.on('booking:status', (e) => emitted.push(['status', e.booking.id, e.booking.status]));

before(async () => {
  ctx = makeCtx();
  ctx.cfg.admin = { password: 'correct horse', sessionSecret: 'test-secret', sessionHours: 1, cookieSecure: false };
  ctx.cfg.telegram = { token: '', botUsername: 'nacre_test_bot', adminChatIds: [] };
  ctx.cfg.studio = { name: 'Nacré' };
  seedDefaults(ctx);
  const quiet = { error() {}, log() {} };
  const app = createApp({ ctx, events, logger: quiet });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

async function login() {
  const res = await call('/api/admin/login', { method: 'POST', body: { password: 'correct horse' } });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

const firstService = async () => (await call('/api/public/services')).json.data[0];

test('public catalog exposes active services and masters with next free slot', async () => {
  const services = (await call('/api/public/services')).json;
  assert.equal(services.success, true);
  assert.ok(services.data.length >= 8);
  const service = services.data[0];
  const masters = (await call(`/api/public/masters?serviceId=${service.id}`)).json.data;
  assert.ok(masters.length >= 1);
  assert.match(masters[0].nextSlot.time, /^\d\d:\d\d$/);
  assert.equal(masters[0].bio.length > 0, true);
});

test('public config reports studio info and today in the studio timezone', async () => {
  const { json } = await call('/api/public/config');
  assert.equal(json.data.today, '2026-11-02');
  assert.equal(json.data.botUsername, 'nacre_test_bot');
});

test('availability and slots endpoints validate input', async () => {
  const service = await firstService();
  const month = await call(`/api/public/availability?serviceId=${service.id}&month=2026-11`);
  assert.equal(month.json.data.days.length, 30);
  assert.equal((await call(`/api/public/availability?serviceId=${service.id}&month=2026-13`)).status, 400);
  assert.equal((await call('/api/public/slots?serviceId=abc&date=2026-11-03')).status, 400);
  const slots = await call(`/api/public/slots?serviceId=${service.id}&date=2026-11-03`);
  assert.ok(slots.json.data.slots.length > 0);
});

test('POST /bookings creates a booking, returns a Telegram deep link and blocks the slot', async () => {
  const service = await firstService();
  const slot = (await call(`/api/public/slots?serviceId=${service.id}&date=2026-11-04`)).json.data.slots[0];
  const payload = { serviceId: service.id, masterId: null, date: '2026-11-04', time: slot.time, name: 'Анна Смирнова', phone: '+998 90 123-45-67' };

  const created = await call('/api/public/bookings', { method: 'POST', body: payload });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.booking.start, slot.time);
  assert.match(created.json.data.telegramLink, /^https:\/\/t\.me\/nacre_test_bot\?start=b_[0-9a-f]{24}$/);
  assert.ok(emitted.some(([kind]) => kind === 'created'));

  const again = await call('/api/public/bookings', { method: 'POST', body: { ...payload, phone: '+998 90 765-43-21' } });
  // с «любым мастером» вторая запись на то же время уйдёт другому мастеру или получит 409 — но не задвоится
  assert.ok([201, 409].includes(again.status));
  const taken = (await call('/api/admin/bookings?from=2026-11-04&to=2026-11-04', { cookie: await login() })).json.data;
  const sameSlot = taken.filter((b) => b.start === slot.time && b.status === 'confirmed');
  assert.equal(new Set(sameSlot.map((b) => b.masterId)).size, sameSlot.length, 'один мастер не может быть записан дважды');
});

test('POST /bookings rejects invalid contact data, bad JSON and honeypot spam is not stored', async () => {
  const service = await firstService();
  const slot = (await call(`/api/public/slots?serviceId=${service.id}&date=2026-11-05`)).json.data.slots[0];
  const good = { serviceId: service.id, date: '2026-11-05', time: slot.time, name: 'Ольга', phone: '+79001110022' };

  const badPhone = await call('/api/public/bookings', { method: 'POST', body: { ...good, phone: '12' } });
  assert.equal(badPhone.status, 400);
  assert.equal(badPhone.json.code, 'invalid_phone');

  const raw = await fetch(`${base}/api/public/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(raw.status, 400);

  const before = (await call('/api/admin/bookings?from=2026-11-05&to=2026-11-05', { cookie: await login() })).json.data.length;
  const spam = await call('/api/public/bookings', { method: 'POST', body: { ...good, website: 'http://spam.example' } });
  assert.equal(spam.status, 201);
  const after = (await call('/api/admin/bookings?from=2026-11-05&to=2026-11-05', { cookie: await login() })).json.data.length;
  assert.equal(after, before);
});

test('admin API requires a session', async () => {
  for (const path of ['/api/admin/me', '/api/admin/bookings', '/api/admin/masters', '/api/admin/dashboard?from=2026-11-01&to=2026-11-07']) {
    const res = await call(path);
    assert.equal(res.status, 401, path);
  }
  const forged = await call('/api/admin/me', { cookie: 'nacre_admin=9999999999999.forged' });
  assert.equal(forged.status, 401);
});

test('login rejects a wrong password and sets a hardened cookie on success', async () => {
  const bad = await call('/api/admin/login', { method: 'POST', body: { password: 'nope' } });
  assert.equal(bad.status, 401);
  const res = await call('/api/admin/login', { method: 'POST', body: { password: 'correct horse' } });
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const me = await call('/api/admin/me', { cookie: cookie.split(';')[0] });
  assert.equal(me.json.data.authenticated, true);
});

test('state-changing admin requests from a foreign origin are refused', async () => {
  const cookie = await login();
  const res = await call('/api/admin/logout', { method: 'POST', cookie, headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  const sandboxed = await call('/api/admin/logout', { method: 'POST', cookie, headers: { Origin: 'null' } });
  assert.equal(sandboxed.status, 403, 'Origin: null (sandbox/iframe) тоже отклоняется');
});

test('admin can create a manual booking, change its status and the client is notified via events', async () => {
  const cookie = await login();
  const service = await firstService();
  const slot = (await call(`/api/admin/slots?serviceId=${service.id}&date=2026-11-06`, { cookie })).json.data.slots[0];
  const created = await call('/api/admin/bookings', {
    method: 'POST', cookie,
    body: { serviceId: service.id, masterId: null, date: '2026-11-06', time: slot.time, name: 'Клиент по телефону', phone: '90 555 00 11' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.source, 'admin');

  const patched = await call(`/api/admin/bookings/${created.json.data.id}`, { method: 'PATCH', cookie, body: { status: 'cancelled' } });
  assert.equal(patched.json.data.status, 'cancelled');
  assert.ok(emitted.some(([kind, id, status]) => kind === 'status' && id === created.json.data.id && status === 'cancelled'));
  assert.equal((await call('/api/admin/bookings/999999', { method: 'PATCH', cookie, body: { status: 'completed' } })).status, 404);
  assert.equal((await call(`/api/admin/bookings/${created.json.data.id}`, { method: 'PATCH', cookie, body: {} })).status, 400);
});

test('admin can add a master with schedule and days off, then the master becomes bookable', async () => {
  const cookie = await login();
  const services = (await call('/api/admin/services', { cookie })).json.data;
  const body = {
    name: 'Новая Мастерица', title: 'Нейл-мастер', color: '#336699', serviceIds: [services[0].id],
    schedule: [
      { weekday: 3, start: '12:00', end: '18:00', breakStart: '15:00', breakEnd: '15:30' },
      { weekday: 4, start: '09:30', end: '13:00', breakStart: '', breakEnd: '' },
    ],
    daysOff: [{ from: '2026-12-01', to: '2026-12-10', note: 'Отпуск' }],
  };
  const created = await call('/api/admin/masters', { method: 'POST', cookie, body });
  assert.equal(created.status, 201);
  const master = created.json.data;
  assert.deepEqual(master.schedule[0], { weekday: 3, start: '12:00', end: '18:00', breakStart: '15:00', breakEnd: '15:30' });
  assert.equal(master.schedule[1].breakStart, null);

  const slots = await call(`/api/public/slots?serviceId=${services[0].id}&masterId=${master.id}&date=2026-11-05`); // четверг
  assert.ok(slots.json.data.slots.length > 0);
  const vacation = await call(`/api/public/slots?serviceId=${services[0].id}&masterId=${master.id}&date=2026-12-03`);
  assert.equal(vacation.json.data.slots.length, 0);

  const updated = await call(`/api/admin/masters/${master.id}`, { method: 'PUT', cookie, body: { ...body, name: 'Переименована', active: false } });
  assert.equal(updated.json.data.name, 'Переименована');
  assert.equal((await call(`/api/public/masters`)).json.data.some((m) => m.id === master.id), false, 'отключённый мастер скрыт с сайта');

  assert.equal((await call(`/api/admin/masters/${master.id}`, { method: 'DELETE', cookie })).status, 200);
});

test('master validation rejects broken schedules and unknown services', async () => {
  const cookie = await login();
  const base0 = { name: 'Тест', serviceIds: [], schedule: [], daysOff: [] };
  const inverted = await call('/api/admin/masters', { method: 'POST', cookie, body: { ...base0, schedule: [{ weekday: 1, start: '18:00', end: '10:00' }] } });
  assert.equal(inverted.status, 400);
  const badBreak = await call('/api/admin/masters', { method: 'POST', cookie, body: { ...base0, schedule: [{ weekday: 1, start: '10:00', end: '18:00', breakStart: '09:00', breakEnd: '10:30' }] } });
  assert.equal(badBreak.status, 400);
  const dup = await call('/api/admin/masters', { method: 'POST', cookie, body: { ...base0, schedule: [{ weekday: 1, start: '10:00', end: '12:00' }, { weekday: 1, start: '13:00', end: '15:00' }] } });
  assert.equal(dup.status, 400);
  const unknown = await call('/api/admin/masters', { method: 'POST', cookie, body: { ...base0, serviceIds: [99999] } });
  assert.equal(unknown.status, 400);
  const badPhoto = await call('/api/admin/masters', { method: 'POST', cookie, body: { ...base0, photoUrl: 'javascript:alert(1)' } });
  assert.equal(badPhoto.status, 400);
});

test('admin can manage services; a used service can only be hidden', async () => {
  const cookie = await login();
  const created = await call('/api/admin/services', {
    method: 'POST', cookie, body: { name: 'Парафинотерапия', category: 'Уход', durationMin: 30, price: 700 },
  });
  assert.equal(created.status, 201);
  const svc = created.json.data;
  const renamed = await call(`/api/admin/services/${svc.id}`, {
    method: 'PUT', cookie, body: { name: 'Парафин', category: 'Уход', durationMin: 45, price: 800, active: true },
  });
  assert.equal(renamed.json.data.durationMin, 45);
  assert.equal((await call(`/api/admin/services/${svc.id}`, { method: 'DELETE', cookie })).status, 200);

  const used = (await call('/api/public/services')).json.data[0];
  const del = await call(`/api/admin/services/${used.id}`, { method: 'DELETE', cookie });
  assert.equal(del.status, 409);
  assert.equal(del.json.code, 'service_in_use');
});

test('dashboard and schedule endpoints return occupancy data', async () => {
  const cookie = await login();
  const dash = await call('/api/admin/dashboard?from=2026-11-02&to=2026-11-08', { cookie });
  assert.equal(dash.status, 200);
  assert.equal(dash.json.data.daily.length, 7);
  assert.ok(dash.json.data.masters.length >= 3);
  assert.ok(dash.json.data.totals.capacityMin > 0);
  assert.equal((await call('/api/admin/dashboard?from=2026-01-01&to=2026-12-31', { cookie })).status, 400);

  const day = await call('/api/admin/schedule?date=2026-11-04', { cookie });
  assert.equal(day.status, 200);
  assert.ok(day.json.data.masters.every((m) => 'shift' in m && Array.isArray(m.bookings)));
});

test('responses carry security headers; API is never cached; unknown API routes return JSON 404', async () => {
  const res = await fetch(`${base}/api/public/services`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com/, 'YouTube разрешён только для фонового видео');
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, 'инлайн-скрипты по-прежнему запрещены');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-powered-by'), null);
  const missing = await call('/api/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.success, false);
});

test('login is rate limited after repeated failures', async () => {
  let last;
  for (let i = 0; i < 12; i += 1) {
    last = await call('/api/admin/login', { method: 'POST', body: { password: 'wrong' } });
  }
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
});
