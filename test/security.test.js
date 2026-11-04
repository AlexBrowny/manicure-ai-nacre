import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createSessionToken, passwordMatches, readCookie, verifySessionToken } from '../src/http/auth.js';
import { rateLimit } from '../src/http/rateLimit.js';

const SECRET = 'unit-test-secret';

test('a freshly issued session token is valid until it expires', async () => {
  const now = 1_000_000;
  const token = createSessionToken(SECRET, 60_000, now);
  assert.equal(verifySessionToken(SECRET, token, now + 59_000), true);
  assert.equal(verifySessionToken(SECRET, token, now + 61_000), false);
});

test('tampered, foreign-secret and malformed tokens are rejected', async () => {
  const now = 1_000_000;
  const token = createSessionToken(SECRET, 60_000, now);
  const [expires, signature] = token.split('.');
  assert.equal(verifySessionToken('another-secret', token, now), false);
  assert.equal(verifySessionToken(SECRET, `${Number(expires) + 999999}.${signature}`, now), false, 'нельзя продлить срок');
  assert.equal(verifySessionToken(SECRET, `${expires}.${signature}x`, now), false);
  assert.equal(verifySessionToken(SECRET, `${expires}.${signature}.extra`, now), false);
  for (const junk of [undefined, null, '', 'abc', '.', 'x.y', 42]) assert.equal(verifySessionToken(SECRET, junk, now), false);
});

test('passwordMatches compares exactly and tolerates missing input', async () => {
  assert.equal(passwordMatches('secret', 'secret'), true);
  assert.equal(passwordMatches('Secret', 'secret'), false);
  assert.equal(passwordMatches(undefined, 'secret'), false);
  assert.equal(passwordMatches('', 'secret'), false);
});

test('readCookie finds a cookie among several and decodes it', async () => {
  const req = { headers: { cookie: 'a=1; nacre_admin=abc%2Edef; b=2' } };
  assert.equal(readCookie(req, 'nacre_admin'), 'abc.def');
  assert.equal(readCookie(req, 'missing'), null);
  assert.equal(readCookie({ headers: {} }, 'a'), null);
});

function fakeRes() {
  const res = { headers: {}, statusCode: 200, body: null };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('rateLimit blocks after max hits, per IP, and reports Retry-After', async () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 2 });
  const hit = (ip) => { const res = fakeRes(); let passed = false; limiter({ ip }, res, () => { passed = true; }); return { res, passed }; };
  assert.equal(hit('1.1.1.1').passed, true);
  assert.equal(hit('1.1.1.1').passed, true);
  const blocked = hit('1.1.1.1');
  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.ok(Number(blocked.res.headers['Retry-After']) > 0);
  assert.equal(hit('2.2.2.2').passed, true, 'другой IP не затронут');
});

test('rateLimit refunds an attempt when the handler asks for it', async () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1 });
  const req = { ip: '3.3.3.3' };
  limiter(req, fakeRes(), () => {});
  req.refundRateLimit();
  let passed = false;
  limiter({ ip: '3.3.3.3' }, fakeRes(), () => { passed = true; });
  assert.equal(passed, true);
});

test('loadConfig applies defaults and generates temporary secrets with warnings', async () => {
  const cfg = loadConfig({});
  assert.equal(cfg.port, 3000);
  assert.equal(cfg.slotStepMin, 30);
  assert.equal(cfg.studio.name, 'Nacré');
  assert.equal(cfg.currency, 'сум');
  assert.equal(cfg.timeZone, 'Asia/Tashkent');
  assert.equal(cfg.admin.generatedPassword, true);
  assert.ok(cfg.admin.password.length >= 10);
  assert.equal(cfg.warnings.length, 2);
  assert.notEqual(loadConfig({}).admin.password, cfg.admin.password, 'пароль случайный');
});

test('loadConfig uses provided values and parses admin chat ids', async () => {
  const cfg = loadConfig({
    ADMIN_PASSWORD: 'p', SESSION_SECRET: 's', PORT: '8080', ADMIN_CHAT_IDS: '123, -456', TELEGRAM_BOT_USERNAME: '@nacre_bot', COOKIE_SECURE: '1',
  });
  assert.equal(cfg.port, 8080);
  assert.deepEqual(cfg.telegram.adminChatIds, ['123', '-456']);
  assert.equal(cfg.telegram.botUsername, 'nacre_bot');
  assert.equal(cfg.admin.cookieSecure, true);
  assert.equal(cfg.warnings.length, 0);
});

test('loadConfig rejects nonsense numbers and chat ids early', async () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ SLOT_STEP_MIN: '0' }), /SLOT_STEP_MIN/);
  assert.throws(() => loadConfig({ ADMIN_CHAT_IDS: '12,abc' }), /ADMIN_CHAT_IDS/);
});
