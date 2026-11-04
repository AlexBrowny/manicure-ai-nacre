import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySlots } from '../src/domain/availability.js';
import {
  cancelBooking, createBooking, dueReminders, getBooking, linkBookingToChat, listBookings,
  listUpcomingForChat, markReminded, setStatus,
} from '../src/domain/bookings.js';
import { addMaster, addService, makeCtx, weekdays } from './helpers.js';

const TUE = '2026-11-03'; // «сегодня» в makeCtx — понедельник 2026-11-02 07:00 UTC

function setup(opts) {
  const ctx = makeCtx(opts);
  const service = addService(ctx);
  const master = addMaster(ctx, { serviceIds: [service.id] });
  const base = { serviceId: service.id, masterId: master.id, date: TUE, startMin: 600, name: 'Анна', phone: '8 90 111-22-33', source: 'web' };
  return { ctx, service, master, base };
}

test('createBooking stores a normalized booking and blocks the slot', () => {
  const { ctx, service, master, base } = setup();
  const b = createBooking(ctx, base);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.clientPhone, '+998901112233');
  assert.equal(b.endMin, 660);
  assert.equal(b.price, 1500);
  assert.equal(b.masterId, master.id);
  assert.match(b.linkToken, /^[0-9a-f]{24}$/);
  const free = daySlots(ctx, { serviceId: service.id, masterId: master.id, date: TUE }).map((s) => s.start);
  assert.ok(!free.includes(600) && !free.includes(570) && free.includes(660));
});

test('createBooking rejects the same or overlapping slot', () => {
  const { ctx, base } = setup();
  createBooking(ctx, base);
  assert.throws(() => createBooking(ctx, base), { code: 'slot_unavailable' });
  assert.throws(() => createBooking(ctx, { ...base, startMin: 630 }), { code: 'slot_unavailable' });
  assert.doesNotThrow(() => createBooking(ctx, { ...base, startMin: 660, phone: '+79002223344' }));
});

test('createBooking rejects times outside the shift and during the break', () => {
  const { ctx, base } = setup();
  assert.throws(() => createBooking(ctx, { ...base, startMin: 540 }), { code: 'slot_unavailable' });
  assert.throws(() => createBooking(ctx, { ...base, startMin: 840 }), { code: 'slot_unavailable' });
  assert.throws(() => createBooking(ctx, { ...base, startMin: 1110 }), { code: 'slot_unavailable' });
});

test('createBooking validates contact data and the service', () => {
  const { ctx, service, base } = setup();
  assert.throws(() => createBooking(ctx, { ...base, name: 'А' }), { code: 'invalid_name' });
  assert.throws(() => createBooking(ctx, { ...base, phone: '123' }), { code: 'invalid_phone' });
  assert.throws(() => createBooking(ctx, { ...base, serviceId: 999 }), { code: 'not_found' });
  ctx.db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(service.id);
  assert.throws(() => createBooking(ctx, base), { code: 'not_found' });
});

test('"any master" books the least loaded master and falls back when one is busy', () => {
  const ctx = makeCtx();
  const service = addService(ctx);
  const a = addMaster(ctx, { name: 'А', serviceIds: [service.id] });
  const b = addMaster(ctx, { name: 'Б', serviceIds: [service.id] });
  const base = { serviceId: service.id, masterId: null, date: TUE, name: 'Анна', source: 'web' };

  const first = createBooking(ctx, { ...base, startMin: 600, phone: '+79000000001' });
  assert.equal(first.masterId, a.id); // при равной загрузке — первый по порядку
  const second = createBooking(ctx, { ...base, startMin: 600, phone: '+79000000002' });
  assert.equal(second.masterId, b.id); // у А занято в это время
  assert.throws(() => createBooking(ctx, { ...base, startMin: 600, phone: '+79000000003' }), { code: 'slot_unavailable' });

  const third = createBooking(ctx, { ...base, startMin: 720, phone: '+79000000004' });
  assert.equal(third.masterId, a.id, 'у А и Б по 60 мин — снова первый'); // оба по 60 мин
  const fourth = createBooking(ctx, { ...base, startMin: 780, phone: '+79000000005' });
  assert.equal(fourth.masterId, b.id, 'у А уже 120 мин, у Б 60');
});

test('createBooking caps active future bookings per phone for public sources', () => {
  const { ctx, base } = setup();
  for (const startMin of [600, 660, 720, 900, 960]) createBooking(ctx, { ...base, startMin });
  assert.throws(() => createBooking(ctx, { ...base, date: '2026-11-04', startMin: 600 }), { code: 'too_many_bookings' });
  assert.doesNotThrow(() => createBooking(ctx, { ...base, date: '2026-11-04', startMin: 600, source: 'admin' }));
});

test('cancelBooking by admin frees the slot', () => {
  const { ctx, service, master, base } = setup();
  const b = createBooking(ctx, base);
  cancelBooking(ctx, b.id, { by: 'admin' });
  assert.equal(getBooking(ctx, b.id).status, 'cancelled');
  const free = daySlots(ctx, { serviceId: service.id, masterId: master.id, date: TUE }).map((s) => s.start);
  assert.ok(free.includes(600));
  assert.throws(() => cancelBooking(ctx, b.id, { by: 'admin' }), { code: 'not_cancellable' });
});

test('cancelBooking by client requires the owning chat and enough notice', () => {
  const { ctx, base } = setup({ now: '2026-11-03T05:00:00Z' }); // за 5 ч до 10:00
  const b = createBooking(ctx, { ...base, source: 'telegram', tgChatId: 777 });
  assert.throws(() => cancelBooking(ctx, b.id, { by: 'client', tgChatId: 888 }), { code: 'not_found' });
  ctx.clock.current = new Date('2026-11-03T08:00:00Z'); // за 2 ч < 3 ч
  assert.throws(() => cancelBooking(ctx, b.id, { by: 'client', tgChatId: 777 }), { code: 'too_late' });
  ctx.clock.current = new Date('2026-11-03T06:30:00Z'); // за 3.5 ч
  assert.equal(cancelBooking(ctx, b.id, { by: 'client', tgChatId: 777 }).status, 'cancelled');
});

test('setStatus cannot revive a cancelled booking over a newly taken slot', () => {
  const { ctx, base } = setup();
  const old = createBooking(ctx, base);
  cancelBooking(ctx, old.id, { by: 'admin' });
  const fresh = createBooking(ctx, { ...base, phone: '+79005556677' });
  assert.throws(() => setStatus(ctx, old.id, 'confirmed'), { code: 'slot_unavailable' });
  assert.throws(() => setStatus(ctx, old.id, 'no_show'), { code: 'slot_unavailable' });
  assert.equal(setStatus(ctx, fresh.id, 'completed').status, 'completed');
});

test('setStatus rejects unknown statuses', () => {
  const { ctx, base } = setup();
  const b = createBooking(ctx, base);
  assert.throws(() => setStatus(ctx, b.id, 'banana'), { code: 'bad_request' });
});

test('linkBookingToChat attaches a web booking to a Telegram chat once', () => {
  const { ctx, base } = setup();
  const b = createBooking(ctx, base);
  const linked = linkBookingToChat(ctx, b.linkToken, 555);
  assert.equal(linked.id, b.id);
  assert.equal(listUpcomingForChat(ctx, 555).length, 1);
  assert.equal(linkBookingToChat(ctx, b.linkToken, 999), null, 'токен одноразовый');
  assert.equal(linkBookingToChat(ctx, 'nope', 555), null);
});

test('listUpcomingForChat hides cancelled and past bookings', () => {
  const { ctx, base } = setup();
  const keep = createBooking(ctx, { ...base, source: 'telegram', tgChatId: 1 });
  const drop = createBooking(ctx, { ...base, startMin: 660, source: 'telegram', tgChatId: 1 });
  cancelBooking(ctx, drop.id, { by: 'admin' });
  createBooking(ctx, { ...base, date: '2026-11-02', startMin: 600, source: 'telegram', tgChatId: 1, ignoreLead: true });
  ctx.clock.current = new Date('2026-11-02T12:00:00Z');
  assert.deepEqual(listUpcomingForChat(ctx, 1).map((b) => b.id), [keep.id]);
});

test('reminders: 24h then 2h, only for linked, confirmed bookings in the future', () => {
  const { ctx, base } = setup({ now: '2026-11-01T06:00:00Z' }); // за 52 ч до визита
  const b = createBooking(ctx, { ...base, source: 'telegram', tgChatId: 42 });
  createBooking(ctx, { ...base, startMin: 660, phone: '+79003334455' }); // без Telegram

  assert.deepEqual(dueReminders(ctx), []);
  ctx.clock.current = new Date('2026-11-02T11:00:00Z'); // за 23 ч
  assert.deepEqual(dueReminders(ctx).map((r) => [r.booking.id, r.kind]), [[b.id, '24h']]);
  markReminded(ctx, b.id, '24h');
  assert.deepEqual(dueReminders(ctx), []);
  ctx.clock.current = new Date('2026-11-03T08:30:00Z'); // за 1.5 ч
  assert.deepEqual(dueReminders(ctx).map((r) => [r.booking.id, r.kind]), [[b.id, '2h']]);
  markReminded(ctx, b.id, '2h');
  assert.deepEqual(dueReminders(ctx), []);
  ctx.clock.current = new Date('2026-11-03T11:00:00Z'); // уже началась
  assert.deepEqual(dueReminders(ctx), []);
});

test('a booking made close to the visit does not trigger an immediate 24h reminder', () => {
  const { ctx, base } = setup({ now: '2026-11-03T05:00:00Z' }); // за 5 ч
  const b = createBooking(ctx, { ...base, source: 'telegram', tgChatId: 42 });
  assert.deepEqual(dueReminders(ctx), []);
  ctx.clock.current = new Date('2026-11-03T08:30:00Z');
  assert.deepEqual(dueReminders(ctx).map((r) => [r.booking.id, r.kind]), [[b.id, '2h']]);
});

test('listBookings filters by range, master, status and free-text search', () => {
  const { ctx, master, base } = setup();
  createBooking(ctx, base);
  const other = createBooking(ctx, { ...base, startMin: 660, name: 'Борис Петров', phone: '+79007778899' });
  cancelBooking(ctx, other.id, { by: 'admin' });

  assert.equal(listBookings(ctx, { from: TUE, to: TUE }).length, 2);
  assert.equal(listBookings(ctx, { from: '2026-11-04', to: '2026-11-05' }).length, 0);
  assert.equal(listBookings(ctx, { masterId: master.id + 1 }).length, 0);
  assert.equal(listBookings(ctx, { status: 'cancelled' }).length, 1);
  assert.equal(listBookings(ctx, { q: 'борис' }).length, 1);
  assert.equal(listBookings(ctx, { q: '7778899' }).length, 1);
  assert.equal(listBookings(ctx, { q: '100%' }).length, 0, 'поисковая строка не работает как шаблон');
});
