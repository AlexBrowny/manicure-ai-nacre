import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySlots } from '../src/domain/availability.js';
import {
  assertCanRemind, cancelBooking, createBooking, dueReminders, getBooking, linkBookingToChat, listBookings,
  listUpcomingForChat, markManualReminder, markReminded, setStatus,
} from '../src/domain/bookings.js';
import { addMaster, addService, makeCtx, weekdays } from './helpers.js';

const TUE = '2026-11-03'; // «сегодня» в makeCtx — понедельник 2026-11-02 07:00 UTC

async function setup(opts) {
  const ctx = await makeCtx(opts);
  const service = await addService(ctx);
  const master = await addMaster(ctx, { serviceIds: [service.id] });
  const base = { serviceId: service.id, masterId: master.id, date: TUE, startMin: 600, name: 'Анна', phone: '8 90 111-22-33', source: 'web' };
  return { ctx, service, master, base };
}

test('createBooking stores a normalized booking and blocks the slot', async () => {
  const { ctx, service, master, base } = await setup();
  const b = await createBooking(ctx, base);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.clientPhone, '+998901112233');
  assert.equal(b.endMin, 660);
  assert.equal(b.price, 1500);
  assert.equal(b.masterId, master.id);
  assert.match(b.linkToken, /^[0-9a-f]{24}$/);
  const free = (await daySlots(ctx, { serviceId: service.id, masterId: master.id, date: TUE })).map((s) => s.start);
  assert.ok(!free.includes(600) && !free.includes(570) && free.includes(660));
});

test('createBooking rejects the same or overlapping slot', async () => {
  const { ctx, base } = await setup();
  await createBooking(ctx, base);
  await assert.rejects(async () => await createBooking(ctx, base), { code: 'slot_unavailable' });
  await assert.rejects(async () => await createBooking(ctx, { ...base, startMin: 630 }), { code: 'slot_unavailable' });
  await assert.doesNotReject(async () => createBooking(ctx, { ...base, startMin: 660, phone: '+79002223344' }));
});

test('createBooking rejects times outside the shift and during the break', async () => {
  const { ctx, base } = await setup();
  await assert.rejects(async () => await createBooking(ctx, { ...base, startMin: 540 }), { code: 'slot_unavailable' });
  await assert.rejects(async () => await createBooking(ctx, { ...base, startMin: 840 }), { code: 'slot_unavailable' });
  await assert.rejects(async () => await createBooking(ctx, { ...base, startMin: 1110 }), { code: 'slot_unavailable' });
});

test('createBooking validates contact data and the service', async () => {
  const { ctx, service, base } = await setup();
  await assert.rejects(async () => await createBooking(ctx, { ...base, name: 'А' }), { code: 'invalid_name' });
  await assert.rejects(async () => await createBooking(ctx, { ...base, phone: '123' }), { code: 'invalid_phone' });
  await assert.rejects(async () => await createBooking(ctx, { ...base, serviceId: 999 }), { code: 'not_found' });
  await ctx.db.run('UPDATE services SET active = FALSE WHERE id = ?', [service.id]);
  await assert.rejects(async () => await createBooking(ctx, base), { code: 'not_found' });
});

test('"any master" books the least loaded master and falls back when one is busy', async () => {
  const ctx = await makeCtx();
  const service = await addService(ctx);
  const a = await addMaster(ctx, { name: 'А', serviceIds: [service.id] });
  const b = await addMaster(ctx, { name: 'Б', serviceIds: [service.id] });
  const base = { serviceId: service.id, masterId: null, date: TUE, name: 'Анна', source: 'web' };

  const first = await createBooking(ctx, { ...base, startMin: 600, phone: '+79000000001' });
  assert.equal(first.masterId, a.id); // при равной загрузке — первый по порядку
  const second = await createBooking(ctx, { ...base, startMin: 600, phone: '+79000000002' });
  assert.equal(second.masterId, b.id); // у А занято в это время
  await assert.rejects(async () => await createBooking(ctx, { ...base, startMin: 600, phone: '+79000000003' }), { code: 'slot_unavailable' });

  const third = await createBooking(ctx, { ...base, startMin: 720, phone: '+79000000004' });
  assert.equal(third.masterId, a.id, 'у А и Б по 60 мин — снова первый'); // оба по 60 мин
  const fourth = await createBooking(ctx, { ...base, startMin: 780, phone: '+79000000005' });
  assert.equal(fourth.masterId, b.id, 'у А уже 120 мин, у Б 60');
});

test('createBooking caps active future bookings per phone for public sources', async () => {
  const { ctx, base } = await setup();
  for (const startMin of [600, 660, 720, 900, 960]) await createBooking(ctx, { ...base, startMin });
  await assert.rejects(async () => await createBooking(ctx, { ...base, date: '2026-11-04', startMin: 600 }), { code: 'too_many_bookings' });
  await assert.doesNotReject(async () => createBooking(ctx, { ...base, date: '2026-11-04', startMin: 600, source: 'admin' }));
});

test('cancelBooking by admin frees the slot', async () => {
  const { ctx, service, master, base } = await setup();
  const b = await createBooking(ctx, base);
  await cancelBooking(ctx, b.id, { by: 'admin' });
  assert.equal((await getBooking(ctx, b.id)).status, 'cancelled');
  const free = (await daySlots(ctx, { serviceId: service.id, masterId: master.id, date: TUE })).map((s) => s.start);
  assert.ok(free.includes(600));
  await assert.rejects(async () => await cancelBooking(ctx, b.id, { by: 'admin' }), { code: 'not_cancellable' });
});

test('cancelBooking by client requires the owning chat and enough notice', async () => {
  const { ctx, base } = await setup({ now: '2026-11-03T05:00:00Z' }); // за 5 ч до 10:00
  const b = await createBooking(ctx, { ...base, source: 'telegram', tgChatId: 777 });
  await assert.rejects(async () => await cancelBooking(ctx, b.id, { by: 'client', tgChatId: 888 }), { code: 'not_found' });
  ctx.clock.current = new Date('2026-11-03T08:00:00Z'); // за 2 ч < 3 ч
  await assert.rejects(async () => await cancelBooking(ctx, b.id, { by: 'client', tgChatId: 777 }), { code: 'too_late' });
  ctx.clock.current = new Date('2026-11-03T06:30:00Z'); // за 3.5 ч
  assert.equal((await cancelBooking(ctx, b.id, { by: 'client', tgChatId: 777 })).status, 'cancelled');
});

test('setStatus cannot revive a cancelled booking over a newly taken slot', async () => {
  const { ctx, base } = await setup();
  const old = await createBooking(ctx, base);
  await cancelBooking(ctx, old.id, { by: 'admin' });
  const fresh = await createBooking(ctx, { ...base, phone: '+79005556677' });
  await assert.rejects(async () => await setStatus(ctx, old.id, 'confirmed'), { code: 'slot_unavailable' });
  await assert.rejects(async () => await setStatus(ctx, old.id, 'no_show'), { code: 'slot_unavailable' });
  assert.equal((await setStatus(ctx, fresh.id, 'completed')).status, 'completed');
});

test('setStatus rejects unknown statuses', async () => {
  const { ctx, base } = await setup();
  const b = await createBooking(ctx, base);
  await assert.rejects(async () => await setStatus(ctx, b.id, 'banana'), { code: 'bad_request' });
});

test('linkBookingToChat attaches a web booking to a Telegram chat once', async () => {
  const { ctx, base } = await setup();
  const b = await createBooking(ctx, base);
  const linked = await linkBookingToChat(ctx, b.linkToken, 555);
  assert.equal(linked.id, b.id);
  assert.equal((await listUpcomingForChat(ctx, 555)).length, 1);
  assert.equal(await linkBookingToChat(ctx, b.linkToken, 999), null, 'токен одноразовый');
  assert.equal(await linkBookingToChat(ctx, 'nope', 555), null);
});

test('listUpcomingForChat hides cancelled and past bookings', async () => {
  const { ctx, base } = await setup();
  const keep = await createBooking(ctx, { ...base, source: 'telegram', tgChatId: 1 });
  const drop = await createBooking(ctx, { ...base, startMin: 660, source: 'telegram', tgChatId: 1 });
  await cancelBooking(ctx, drop.id, { by: 'admin' });
  await createBooking(ctx, { ...base, date: '2026-11-02', startMin: 600, source: 'telegram', tgChatId: 1, ignoreLead: true });
  ctx.clock.current = new Date('2026-11-02T12:00:00Z');
  assert.deepEqual((await listUpcomingForChat(ctx, 1)).map((b) => b.id), [keep.id]);
});

test('reminders: 2 h then 10 min, only for linked, confirmed bookings in the future', async () => {
  const { ctx, base } = await setup({ now: '2026-11-03T05:00:00Z' }); // визит в 10:00, сейчас 05:00
  const b = await createBooking(ctx, { ...base, source: 'telegram', tgChatId: 42 });
  await createBooking(ctx, { ...base, startMin: 660, phone: '+998903334455' }); // без Telegram
  const due = async () => (await dueReminders(ctx)).map((r) => [r.booking.id, r.offset]);

  assert.deepEqual(await due(), []);
  ctx.clock.current = new Date('2026-11-03T08:05:00Z'); // за 1 ч 55 мин
  assert.deepEqual(await due(), [[b.id, 120]]);
  await markReminded(ctx, b.id, 120);
  assert.deepEqual(await due(), []);
  ctx.clock.current = new Date('2026-11-03T09:52:00Z'); // за 8 мин
  assert.deepEqual(await due(), [[b.id, 10]]);
  await markReminded(ctx, b.id, 10);
  assert.deepEqual(await due(), []);
  ctx.clock.current = new Date('2026-11-03T10:05:00Z'); // уже началась
  assert.deepEqual(await due(), []);
});

test('a booking made shortly before the visit skips reminders whose time has passed', async () => {
  const { ctx, base } = await setup({ now: '2026-11-03T08:30:00Z' }); // за 1,5 ч — «за 2 часа» уже поздно
  const b = await createBooking(ctx, { ...base, source: 'telegram', tgChatId: 42 });
  assert.deepEqual(b.remindersSent, [120]);
  assert.deepEqual(await dueReminders(ctx), []);
  ctx.clock.current = new Date('2026-11-03T09:51:00Z');
  assert.deepEqual((await dueReminders(ctx)).map((r) => r.offset), [10]);
});

test('if the server was down, only the latest missed reminder is sent', async () => {
  const { ctx, base } = await setup({ now: '2026-11-03T05:00:00Z' });
  const b = await createBooking(ctx, { ...base, source: 'telegram', tgChatId: 42 });
  ctx.clock.current = new Date('2026-11-03T09:55:00Z'); // проспали «за 2 часа»
  assert.deepEqual((await dueReminders(ctx)).map((r) => r.offset), [10]);
  await markReminded(ctx, b.id, 10);
  assert.deepEqual(await dueReminders(ctx), [], '«за 2 часа» уже не отправляем');
});

test('reminder schedule follows the config', async () => {
  const { ctx, base } = await setup({ now: '2026-11-02T05:00:00Z', overrides: { reminderMinutes: [1440, 30] } });
  await createBooking(ctx, { ...base, source: 'telegram', tgChatId: 42 });
  ctx.clock.current = new Date('2026-11-02T10:30:00Z'); // за 23,5 ч
  assert.deepEqual((await dueReminders(ctx)).map((r) => r.offset), [1440]);
});

test('assertCanRemind allows a manual reminder only for upcoming Telegram-linked bookings, once a minute', async () => {
  const { ctx, base } = await setup({ now: '2026-11-03T05:00:00Z' });
  const linked = await createBooking(ctx, { ...base, source: 'telegram', tgChatId: 42 });
  const web = await createBooking(ctx, { ...base, startMin: 660, phone: '+998903334455' });
  { const fresh = await getBooking(ctx, linked.id); assert.doesNotThrow(() => assertCanRemind(ctx, fresh)); }
  await assert.rejects(async () => assertCanRemind(ctx, await getBooking(ctx, web.id)), { code: 'no_telegram' });

  await markManualReminder(ctx, linked.id);
  await assert.rejects(async () => assertCanRemind(ctx, await getBooking(ctx, linked.id)), { code: 'too_soon' });
  ctx.clock.current = new Date('2026-11-03T05:02:00Z');
  { const fresh = await getBooking(ctx, linked.id); assert.doesNotThrow(() => assertCanRemind(ctx, fresh)); }

  await cancelBooking(ctx, linked.id, { by: 'admin' });
  await assert.rejects(async () => assertCanRemind(ctx, await getBooking(ctx, linked.id)), { code: 'not_remindable' });
});

test('listBookings filters by range, master, status and free-text search', async () => {
  const { ctx, master, base } = await setup();
  await createBooking(ctx, base);
  const other = await createBooking(ctx, { ...base, startMin: 660, name: 'Борис Петров', phone: '+79007778899' });
  await cancelBooking(ctx, other.id, { by: 'admin' });

  assert.equal((await listBookings(ctx, { from: TUE, to: TUE })).length, 2);
  assert.equal((await listBookings(ctx, { from: '2026-11-04', to: '2026-11-05' })).length, 0);
  assert.equal((await listBookings(ctx, { masterId: master.id + 1 })).length, 0);
  assert.equal((await listBookings(ctx, { status: 'cancelled' })).length, 1);
  assert.equal((await listBookings(ctx, { q: 'борис' })).length, 1);
  assert.equal((await listBookings(ctx, { q: '7778899' })).length, 1);
  assert.equal((await listBookings(ctx, { q: '100%' })).length, 0, 'поисковая строка не работает как шаблон');
});
