import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooking } from '../src/domain/bookings.js';
import {
  deleteMaster, deleteService, getMaster, listMasters, listServices, updateMaster, updateService,
} from '../src/domain/catalog.js';
import { clearDemo, seedDefaults, seedDemo } from '../src/seed.js';
import { addMaster, addService, makeCtx, weekdays } from './helpers.js';

test('updateMaster replaces schedule, services and days off atomically', async () => {
  const ctx = await makeCtx();
  const a = await addService(ctx);
  const b = await addService(ctx, { name: 'Педикюр' });
  const master = await addMaster(ctx, { serviceIds: [a.id] });

  const updated = await updateMaster(ctx, master.id, {
    ...master,
    name: 'Алина В.',
    serviceIds: [b.id],
    schedule: weekdays([5, 6], 660, 900),
    daysOff: [{ from: '2026-12-30', to: '2027-01-08', note: 'Каникулы' }],
  });
  assert.equal(updated.name, 'Алина В.');
  assert.deepEqual(updated.serviceIds, [b.id]);
  assert.deepEqual(updated.schedule.map((s) => s.weekday), [5, 6]);
  assert.equal(updated.daysOff[0].note, 'Каникулы');
  assert.equal((await listMasters(ctx, { serviceId: a.id })).length, 0);
  assert.equal((await listMasters(ctx, { serviceId: b.id })).length, 1);
});

test('updateMaster rolls back everything when a child row is invalid', async () => {
  const ctx = await makeCtx();
  const service = await addService(ctx);
  const master = await addMaster(ctx, { serviceIds: [service.id] });
  await assert.rejects(async () =>
    updateMaster(ctx, master.id, { ...master, name: 'Новое имя', schedule: [{ weekday: 1, startMin: 900, endMin: 600 }] }));
  const after = await getMaster(ctx, master.id);
  assert.equal(after.name, master.name);
  assert.equal(after.schedule.length, master.schedule.length);
});

test('services and masters with bookings cannot be deleted, only hidden', async () => {
  const ctx = await makeCtx();
  const service = await addService(ctx);
  const master = await addMaster(ctx, { serviceIds: [service.id] });
  await createBooking(ctx, {
    serviceId: service.id, masterId: master.id, date: '2026-11-03', startMin: 600,
    name: 'Анна', phone: '+79001112233', source: 'web',
  });
  await assert.rejects(async () => await deleteService(ctx, service.id), { code: 'service_in_use' });
  await assert.rejects(async () => await deleteMaster(ctx, master.id), { code: 'master_in_use' });
  assert.equal((await updateService(ctx, service.id, { ...service, active: false })).active, false);
});

test('unused services and masters are deleted for real', async () => {
  const ctx = await makeCtx();
  const service = await addService(ctx);
  const master = await addMaster(ctx, { serviceIds: [service.id] });
  await deleteMaster(ctx, master.id);
  await deleteService(ctx, service.id);
  assert.equal((await listServices(ctx)).length, 0);
  await assert.rejects(async () => await getMaster(ctx, master.id), { code: 'not_found' });
});

test('seedDefaults fills an empty database once', async () => {
  const ctx = await makeCtx();
  assert.equal(await seedDefaults(ctx), true);
  assert.equal(await seedDefaults(ctx), false);
  assert.ok((await listServices(ctx)).length >= 8);
  const masters = await listMasters(ctx);
  assert.equal(masters.length, 3);
  assert.ok(masters.every((m) => m.serviceIds.length > 0 && m.schedule.length > 0));
});

test('seedDemo creates bookings across the period and clearDemo removes only them', async () => {
  const ctx = await makeCtx();
  await seedDefaults(ctx);
  const created = await seedDemo(ctx);
  assert.ok(created > 40, `создано ${created}`);
  const real = await createBooking(ctx, {
    serviceId: (await listServices(ctx))[0].id, masterId: null, date: '2026-11-20', startMin: 720,
    name: 'Настоящая клиентка', phone: '+79998887766', source: 'web',
  });
  assert.equal(await clearDemo(ctx), created);
  const left = await ctx.db.all('SELECT id FROM bookings');
  assert.deepEqual(left.map((r) => r.id), [real.id]);
});
