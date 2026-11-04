import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelBooking, createBooking, setStatus } from '../src/domain/bookings.js';
import { dashboardStats } from '../src/domain/stats.js';
import { addMaster, addService, makeCtx } from './helpers.js';

function setup() {
  const ctx = makeCtx();
  const service = addService(ctx, { price: 2000 });
  const alina = addMaster(ctx, { name: 'Алина', serviceIds: [service.id] }); // Пн–Пт 10–19, перерыв 14–15 → 480 мин/день
  const maria = addMaster(ctx, { name: 'Мария', serviceIds: [service.id] });
  let counter = 0;
  const book = (master, date, startMin, extra = {}) => {
    counter += 1;
    return createBooking(ctx, {
      serviceId: service.id, masterId: master.id, date, startMin, name: 'Клиент',
      phone: `+7900${String(counter).padStart(7, '0')}`, source: 'web', ...extra,
    });
  };
  return { ctx, service, alina, maria, book };
}

test('capacity is working time minus breaks, per master and day', () => {
  const { ctx } = setup();
  const stats = dashboardStats(ctx, { from: '2026-11-03', to: '2026-11-04' }); // Вт–Ср
  assert.equal(stats.masters[0].capacityMin, 960);
  assert.equal(stats.totals.capacityMin, 1920);
  assert.equal(stats.daily.length, 2);
});

test('weekends and days off add no capacity', () => {
  const { ctx } = setup();
  const stats = dashboardStats(ctx, { from: '2026-11-07', to: '2026-11-08' }); // Сб–Вс
  assert.equal(stats.totals.capacityMin, 0);
  assert.equal(stats.totals.loadPct, 0);
});

test('load is booked minutes over capacity; cancelled bookings do not count', () => {
  const { ctx, alina, book } = setup();
  book(alina, '2026-11-03', 600);
  book(alina, '2026-11-03', 660);
  const cancelled = book(alina, '2026-11-03', 720);
  cancelBooking(ctx, cancelled.id, { by: 'admin' });
  book(alina, '2026-11-04', 600);
  book(alina, '2026-11-04', 660);

  const stats = dashboardStats(ctx, { from: '2026-11-03', to: '2026-11-04' });
  const row = stats.masters.find((m) => m.id === alina.id);
  assert.equal(row.bookings, 4);
  assert.equal(row.bookedMin, 240);
  assert.equal(row.loadPct, 25); // 240 / 960
  assert.equal(stats.totals.bookings, 4);
  assert.equal(stats.totals.cancelled, 1);
  assert.equal(stats.totals.loadPct, 13); // 240 / 1920 = 12.5 → 13
});

test('revenue counts confirmed and completed only', () => {
  const { ctx, alina, book } = setup();
  const done = book(alina, '2026-11-03', 600);
  const missed = book(alina, '2026-11-03', 660);
  book(alina, '2026-11-03', 720);
  setStatus(ctx, done.id, 'completed');
  setStatus(ctx, missed.id, 'no_show');
  const stats = dashboardStats(ctx, { from: '2026-11-03', to: '2026-11-03' });
  assert.equal(stats.totals.revenue, 4000);
  assert.equal(stats.totals.noShow, 1);
  assert.equal(stats.totals.completed, 1);
});

test('daily series and heatmap reflect per-hour occupancy', () => {
  const { ctx, alina, maria, book } = setup();
  book(alina, '2026-11-03', 600); // Вт 10:00
  book(maria, '2026-11-03', 600);
  const stats = dashboardStats(ctx, { from: '2026-11-03', to: '2026-11-03' });
  assert.equal(stats.daily[0].bookings, 2);
  assert.equal(stats.daily[0].bookedMin, 120);
  assert.equal(stats.heatmap.cells[1][10], 100); // оба мастера заняты весь час
  assert.equal(stats.heatmap.cells[1][11], 0);
  assert.equal(stats.heatmap.cells[1][14], null, 'в перерыв мощности нет');
  assert.equal(stats.heatmap.cells[6][10], null, 'в воскресенье не работают');
});

test('sources and top services are aggregated', () => {
  const { ctx, alina, book } = setup();
  book(alina, '2026-11-03', 600, { source: 'web' });
  book(alina, '2026-11-03', 660, { source: 'telegram', tgChatId: 5 });
  book(alina, '2026-11-03', 720, { source: 'telegram', tgChatId: 6 });
  const stats = dashboardStats(ctx, { from: '2026-11-03', to: '2026-11-03' });
  assert.deepEqual(stats.sources, { web: 1, telegram: 2, admin: 0 });
  assert.equal(stats.topServices[0].count, 3);
});

test('inactive masters without bookings are left out of the report', () => {
  const { ctx } = setup();
  addMaster(ctx, { name: 'Архив', active: false });
  const stats = dashboardStats(ctx, { from: '2026-11-03', to: '2026-11-03' });
  assert.deepEqual(stats.masters.map((m) => m.name), ['Алина', 'Мария']);
});
