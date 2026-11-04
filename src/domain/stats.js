// Загрузка и занятость: ёмкость (смены − перерывы − выходные) против забронированного времени.
import { eachDate, weekdayOf } from '../time.js';
import { shiftIntervals } from './availability.js';
import { listBookings } from './bookings.js';
import { listMasters } from './catalog.js';
import { overlapMinutes } from './slots.js';

const pct = (part, whole) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);
const sum = (items, fn) => items.reduce((total, item) => total + fn(item), 0);
const lengthOf = (intervals) => sum(intervals, (i) => i.end - i.start);

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) map.set(keyFn(row), (map.get(keyFn(row)) ?? 0) + 1);
  return map;
}

/** Тепловая карта «день недели × час»: % занятости или null, если никто не работает. */
function buildHeatmap(capacityCells, bookedCells) {
  return {
    cells: capacityCells.map((row, weekday) =>
      row.map((capacity, hour) => (capacity > 0 ? pct(bookedCells[weekday][hour], capacity) : null))),
  };
}

export function dashboardStats(ctx, { from, to }) {
  const dates = eachDate(from, to);
  const bookings = listBookings(ctx, { from, to });
  const occupying = bookings.filter((b) => b.status !== 'cancelled');
  const masters = listMasters(ctx).filter((m) => m.active || occupying.some((b) => b.masterId === m.id));

  const grid = () => Array.from({ length: 7 }, () => Array(24).fill(0));
  const capacityCells = grid();
  const bookedCells = grid();
  const capacityByMasterDay = new Map(); // `${masterId}|${date}` → минуты

  for (const master of masters) {
    for (const date of dates) {
      const shift = shiftIntervals(master, date);
      capacityByMasterDay.set(`${master.id}|${date}`, lengthOf(shift));
      const weekday = weekdayOf(date);
      for (let h = 0; h < 24; h += 1) capacityCells[weekday][h] += overlapMinutes(shift, h * 60, h * 60 + 60);
    }
  }
  for (const b of occupying) {
    const weekday = weekdayOf(b.date);
    for (let h = 0; h < 24; h += 1) {
      bookedCells[weekday][h] += overlapMinutes([{ start: b.startMin, end: b.endMin }], h * 60, h * 60 + 60);
    }
  }

  const minutesOf = (b) => b.endMin - b.startMin;
  const revenueOf = (list) => sum(list.filter((b) => b.status === 'confirmed' || b.status === 'completed'), (b) => b.price);

  const masterRows = masters.map((m) => {
    const mine = occupying.filter((b) => b.masterId === m.id);
    const capacityMin = sum(dates, (d) => capacityByMasterDay.get(`${m.id}|${d}`));
    const bookedMin = sum(mine, minutesOf);
    return {
      id: m.id, name: m.name, color: m.color, active: m.active,
      bookings: mine.length, bookedMin, capacityMin, freeMin: Math.max(0, capacityMin - bookedMin),
      loadPct: pct(bookedMin, capacityMin), revenue: revenueOf(mine),
    };
  });

  const daily = dates.map((date) => {
    const dayBookings = occupying.filter((b) => b.date === date);
    const capacityMin = sum(masters, (m) => capacityByMasterDay.get(`${m.id}|${date}`));
    const bookedMin = sum(dayBookings, minutesOf);
    return {
      date, bookings: dayBookings.length, bookedMin, capacityMin,
      loadPct: pct(bookedMin, capacityMin), revenue: revenueOf(dayBookings),
    };
  });

  const capacityMin = sum(masterRows, (m) => m.capacityMin);
  const bookedMin = sum(masterRows, (m) => m.bookedMin);
  const statusCount = countBy(bookings, (b) => b.status);
  const sourceCount = countBy(occupying, (b) => b.source);

  const byService = new Map();
  for (const b of occupying) {
    const entry = byService.get(b.serviceName) ?? { name: b.serviceName, count: 0, revenue: 0 };
    entry.count += 1;
    entry.revenue += revenueOf([b]);
    byService.set(b.serviceName, entry);
  }

  return {
    period: { from, to, days: dates.length },
    totals: {
      bookings: occupying.length,
      cancelled: statusCount.get('cancelled') ?? 0,
      noShow: statusCount.get('no_show') ?? 0,
      completed: statusCount.get('completed') ?? 0,
      revenue: revenueOf(occupying),
      bookedMin, capacityMin, loadPct: pct(bookedMin, capacityMin),
      clients: new Set(occupying.map((b) => b.clientPhone)).size,
    },
    masters: masterRows,
    daily,
    heatmap: buildHeatmap(capacityCells, bookedCells),
    sources: { web: sourceCount.get('web') ?? 0, telegram: sourceCount.get('telegram') ?? 0, admin: sourceCount.get('admin') ?? 0 },
    topServices: [...byService.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue).slice(0, 5),
  };
}
