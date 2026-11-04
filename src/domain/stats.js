// Загрузка и занятость: ёмкость (смены − перерывы − выходные) против забронированного времени.
import { eachDate, weekdayOf } from '../time.js';
import { shiftIntervals } from './availability.js';
import { listBookings } from './bookings.js';
import { listMasters } from './catalog.js';
import { overlapMinutes } from './slots.js';

const pct = (part, whole) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);
const sum = (items, fn) => items.reduce((total, item) => total + fn(item), 0);
const lengthOf = (intervals) => sum(intervals, (i) => i.end - i.start);
const minutesOf = (b) => b.endMin - b.startMin;
const revenueOf = (list) => sum(list.filter((b) => b.status === 'confirmed' || b.status === 'completed'), (b) => b.price);
const dayKey = (masterId, date) => `${masterId}|${date}`;
const emptyGrid = () => Array.from({ length: 7 }, () => Array(24).fill(0));

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) map.set(keyFn(row), (map.get(keyFn(row)) ?? 0) + 1);
  return map;
}

/** Прибавляет к строке дня недели минуты интервалов, попавшие в каждый час. */
function addByHour(row, intervals) {
  for (let h = 0; h < 24; h += 1) row[h] += overlapMinutes(intervals, h * 60, h * 60 + 60);
}

/** Ёмкость мастеров по дням (Map «мастер|дата» → минуты) и по ячейкам «день недели × час». */
function capacityOf(masters, dates) {
  const byMasterDay = new Map();
  const cells = emptyGrid();
  for (const master of masters) {
    for (const date of dates) {
      const shift = shiftIntervals(master, date);
      byMasterDay.set(dayKey(master.id, date), lengthOf(shift));
      addByHour(cells[weekdayOf(date)], shift);
    }
  }
  return { byMasterDay, cells };
}

function bookedCellsOf(bookings) {
  const cells = emptyGrid();
  for (const b of bookings) addByHour(cells[weekdayOf(b.date)], [{ start: b.startMin, end: b.endMin }]);
  return cells;
}

/** Тепловая карта «день недели × час»: % занятости или null, если никто не работает. */
function buildHeatmap(capacityCells, bookedCells) {
  return {
    cells: capacityCells.map((row, weekday) =>
      row.map((capacity, hour) => (capacity > 0 ? pct(bookedCells[weekday][hour], capacity) : null))),
  };
}

function masterRowsOf(masters, occupying, dates, capacity) {
  return masters.map((m) => {
    const mine = occupying.filter((b) => b.masterId === m.id);
    const capacityMin = sum(dates, (d) => capacity.get(dayKey(m.id, d)));
    const bookedMin = sum(mine, minutesOf);
    return {
      id: m.id, name: m.name, color: m.color, active: m.active,
      bookings: mine.length, bookedMin, capacityMin, freeMin: Math.max(0, capacityMin - bookedMin),
      loadPct: pct(bookedMin, capacityMin), revenue: revenueOf(mine),
    };
  });
}

function dailyRowsOf(dates, masters, occupying, capacity) {
  return dates.map((date) => {
    const dayBookings = occupying.filter((b) => b.date === date);
    const capacityMin = sum(masters, (m) => capacity.get(dayKey(m.id, date)));
    const bookedMin = sum(dayBookings, minutesOf);
    return {
      date, bookings: dayBookings.length, bookedMin, capacityMin,
      loadPct: pct(bookedMin, capacityMin), revenue: revenueOf(dayBookings),
    };
  });
}

function topServicesOf(occupying) {
  const byService = new Map();
  for (const b of occupying) {
    const entry = byService.get(b.serviceName) ?? { name: b.serviceName, count: 0, revenue: 0 };
    byService.set(b.serviceName, { ...entry, count: entry.count + 1, revenue: entry.revenue + revenueOf([b]) });
  }
  return [...byService.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue).slice(0, 5);
}

function totalsOf(bookings, occupying, masterRows) {
  const statusCount = countBy(bookings, (b) => b.status);
  const capacityMin = sum(masterRows, (m) => m.capacityMin);
  const bookedMin = sum(masterRows, (m) => m.bookedMin);
  return {
    bookings: occupying.length,
    cancelled: statusCount.get('cancelled') ?? 0,
    noShow: statusCount.get('no_show') ?? 0,
    completed: statusCount.get('completed') ?? 0,
    revenue: revenueOf(occupying),
    bookedMin, capacityMin, loadPct: pct(bookedMin, capacityMin),
    clients: new Set(occupying.map((b) => b.clientPhone)).size,
  };
}

export async function dashboardStats(ctx, { from, to }) {
  const dates = eachDate(from, to);
  const bookings = await listBookings(ctx, { from, to });
  const occupying = bookings.filter((b) => b.status !== 'cancelled');
  const masters = (await listMasters(ctx)).filter((m) => m.active || occupying.some((b) => b.masterId === m.id));
  const capacity = capacityOf(masters, dates);
  const masterRows = masterRowsOf(masters, occupying, dates, capacity.byMasterDay);
  const sourceCount = countBy(occupying, (b) => b.source);

  return {
    period: { from, to, days: dates.length },
    totals: totalsOf(bookings, occupying, masterRows),
    masters: masterRows,
    daily: dailyRowsOf(dates, masters, occupying, capacity.byMasterDay),
    heatmap: buildHeatmap(capacity.cells, bookedCellsOf(occupying)),
    sources: { web: sourceCount.get('web') ?? 0, telegram: sourceCount.get('telegram') ?? 0, admin: sourceCount.get('admin') ?? 0 },
    topServices: topServicesOf(occupying),
  };
}
