import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http/app.js';
import { seedDefaults } from '../src/seed.js';
import { createMemoryStorage } from '../src/storage.js';
import { sniffImage } from '../src/domain/photos.js';
import { makeCtx } from './helpers.js';

const quiet = { error() {}, log() {} };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);
let server;
let base;
let ctx;
let cookie;

before(async () => {
  ctx = await makeCtx();
  ctx.storage = createMemoryStorage();
  ctx.cfg.admin = { password: 'pw', sessionSecret: 's', sessionHours: 1, cookieSecure: false };
  ctx.cfg.telegram = { token: '', botUsername: '', adminChatIds: [] };
  ctx.cfg.studio = { name: 'Nacré' };
  await seedDefaults(ctx);
  await new Promise((resolve) => { server = createApp({ ctx, logger: quiet }).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'pw' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});

after(async () => server.close());

const upload = (id, bytes, type = 'image/png', auth = cookie) => fetch(`${base}/api/admin/masters/${id}/photo`, {
  method: 'PUT', headers: { 'Content-Type': type, ...(auth ? { Cookie: auth } : {}) }, body: bytes,
});
const json = async (res) => ({ status: res.status, body: await res.json() });

test('sniffImage recognises JPEG, PNG and WebP by their bytes only', () => {
  assert.equal(sniffImage(JPEG).type, 'image/jpeg');
  assert.equal(sniffImage(PNG).type, 'image/png');
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')).type, 'image/webp');
  assert.equal(sniffImage(Buffer.from('<svg onload=alert(1)>')), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test('admin uploads a master photo; the site shows it from /media with long caching', async () => {
  const res = await json(await upload(1, PNG));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.hasUploadedPhoto, true);
  assert.match(res.body.data.photo, /^\/media\/masters\/1\/[0-9a-f-]{36}\.png$/);

  const masters = (await (await fetch(`${base}/api/public/masters`)).json()).data;
  assert.equal(masters.find((m) => m.id === 1).photoUrl, res.body.data.photo);

  const file = await fetch(`${base}${res.body.data.photo}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.match(file.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
});

test('replacing a photo stores a new key and deletes the old file; removing clears it', async () => {
  const first = (await json(await upload(2, PNG))).body.data.photo;
  const second = (await json(await upload(2, JPEG, 'image/jpeg'))).body.data.photo;
  assert.notEqual(first, second);
  assert.match(second, /\.jpg$/);
  assert.equal((await fetch(`${base}${first}`)).status, 404, 'старый файл удалён из бакета');

  const removed = await json(await fetch(`${base}/api/admin/masters/2/photo`, { method: 'DELETE', headers: { Cookie: cookie } }));
  assert.equal(removed.body.data.hasUploadedPhoto, false);
  assert.equal((await fetch(`${base}${second}`)).status, 404);
  assert.equal(ctx.storage.files.size, 1, 'остался только файл мастера №1');
});

test('uploads are refused for non-images, oversized files, unknown masters and without a session', async () => {
  assert.equal((await json(await upload(1, Buffer.from('<svg></svg>'), 'image/svg+xml'))).body.code, 'bad_image');
  assert.equal((await json(await upload(1, Buffer.alloc(0)))).body.code, 'bad_image');
  assert.equal((await upload(1, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]))).status, 413);
  assert.equal((await upload(999, PNG)).status, 404);
  assert.equal((await upload(1, PNG, 'image/png', null)).status, 401);
});

test('/media serves only keys of our format and nothing outside the bucket layout', async () => {
  for (const path of ['/media/../.env', '/media/masters/1/x.png', '/media/other/file.png', '/media/']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
});

test('without a bucket configured, upload explains how to enable it', async () => {
  const saved = ctx.storage;
  ctx.storage = null;
  try {
    const res = await json(await upload(1, PNG));
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'storage_off');
  } finally {
    ctx.storage = saved;
  }
});
