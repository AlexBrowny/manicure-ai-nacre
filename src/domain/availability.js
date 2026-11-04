// Расчёт свободных слотов: расписание мастера − выходные − существующие записи − «прошлое».
import { addDays, eachDate, monthBounds, nowInTz, weekdayOf } from '../time.js';
import { listMasters, getService } from './catalog.js';
import { startsFor, subtractIntervals, workingIntervals } from './slots.js';

/** Мастера, которые активны, делают услугу и (если задан) совпадают с masterId. */
export function eligibleMasters(ctx, serviceId, masterId = null) {
  const masters = listMasters(ctx, { activeOnly: true, serviceId });
  return masterId == null ? masters : masters.filter((m) => m.id === masterId);
}

/** Занятые интервалы: Map<"masterId|date", [{start, end}]>. Отменённые записи не учитываются. */
export function loadBusy(db, masterIds, from, to) {
  const busy = new Map();
  if (masterIds.length === 0) return busy;
  const marks = masterIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT master_id, date, start_min, end_min FROM bookings
       WHERE master_id IN (${marks}) AND date BETWEEN ? AND ? AND status != 'cancelled'`,
    )
    .all(...masterIds, from, to);
  for (const r of rows) {
    const key = `${r.master_id}|${r.date}`;
    const list = busy.get(key) ?? [];
    list.push({ start: r.start_min, end: r.end_min });
    busy.set(key, list);
  }
  return busy;
}

/** Смена мастера на дату (без учёта записей). [] — выходной. */
export function shiftIntervals(master, date) {
  const row = master.schedule.find((s) => s.weekday === weekdayOf(date));
  if (!row) return [];
  if (master.daysOff.some((d) => d.from <= date && date <= d.to)) return [];
  return workingIntervals(row);
}

/** Минимально допустимое начало (в минутах) или null, если дата вне окна записи. */
function earliestStart(date, now, cfg, ignoreLead) {
  if (ignoreLead) return 0;
  if (date < now.date || date > addDays(now.date, cfg.horizonDays)) return null;
  return date === now.date ? now.minutes + cfg.leadMin : 0;
}

/** Map<start, masterIds[]> на одну дату. */
function slotsOnDay({ masters, busy, date, duration, cfg, now, ignoreLead }) {
  const minStart = earliestStart(date, now, cfg, ignoreLead);
  const byStart = new Map();
  if (minStart === null) return byStart;
  for (const master of masters) {
    const free = subtractIntervals(shiftIntervals(master, date), busy.get(`${master.id}|${date}`) ?? []);
    for (const start of startsFor(free, duration, cfg.slotStepMin, minStart)) {
      const list = byStart.get(start) ?? [];
      list.push(master.id);
      byStart.set(start, list);
    }
  }
  return byStart;
}

/**
 * Слоты на дату. masterId = null — «любой мастер».
 * @returns {{ start: number, masterIds: number[] }[]}
 */
export function daySlots(ctx, { serviceId, masterId = null, date, ignoreLead = false }) {
  const service = getService(ctx, serviceId);
  const masters = eligibleMasters(ctx, serviceId, masterId);
  const busy = loadBusy(ctx.db, masters.map((m) => m.id), date, date);
  const now = nowInTz(ctx.cfg.timeZone, ctx.now());
  const byStart = slotsOnDay({
    masters, busy, date, duration: service.durationMin, cfg: ctx.cfg, now, ignoreLead,
  });
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([start, masterIds]) => ({ start, masterIds }));
}

/** Количество свободных слотов по каждому дню месяца. */
export function monthAvailability(ctx, { serviceId, masterId = null, month }) {
  const service = getService(ctx, serviceId);
  const masters = eligibleMasters(ctx, serviceId, masterId);
  const { from, to } = monthBounds(month);
  const busy = loadBusy(ctx.db, masters.map((m) => m.id), from, to);
  const now = nowInTz(ctx.cfg.timeZone, ctx.now());
  return eachDate(from, to).map((date) => ({
    date,
    count: slotsOnDay({ masters, busy, date, duration: service.durationMin, cfg: ctx.cfg, now, ignoreLead: false }).size,
  }));
}

/** Ближайший свободный слот в пределах горизонта записи. */
export function nextFreeSlot(ctx, { serviceId, masterId = null }) {
  const service = getService(ctx, serviceId);
  const masters = eligibleMasters(ctx, serviceId, masterId);
  if (masters.length === 0) return null;
  const now = nowInTz(ctx.cfg.timeZone, ctx.now());
  const last = addDays(now.date, ctx.cfg.horizonDays);
  const busy = loadBusy(ctx.db, masters.map((m) => m.id), now.date, last);
  for (const date of eachDate(now.date, last)) {
    const byStart = slotsOnDay({
      masters, busy, date, duration: service.durationMin, cfg: ctx.cfg, now, ignoreLead: false,
    });
    if (byStart.size > 0) return { date, start: Math.min(...byStart.keys()) };
  }
  return null;
}
