// Расчёт свободных слотов: расписание мастера − выходные − существующие записи − «прошлое».
import { addDays, eachDate, monthBounds, nowInTz, weekdayOf } from '../time.js';
import { listMasters, getService } from './catalog.js';
import { startsFor, subtractIntervals, workingIntervals } from './slots.js';

/** Мастера, которые активны, делают услугу и (если задан) совпадают с masterId. */
export async function eligibleMasters(ctx, serviceId, masterId = null) {
  const masters = await listMasters(ctx, { activeOnly: true, serviceId });
  return masterId == null ? masters : masters.filter((m) => m.id === masterId);
}

/** Занятые интервалы: Map<"masterId|date", [{start, end}]>. Отменённые записи не учитываются. */
export async function loadBusy(db, masterIds, from, to) {
  const busy = new Map();
  if (masterIds.length === 0) return busy;
  const rows = await db.all(
    `SELECT master_id, date, start_min, end_min FROM bookings
     WHERE master_id = ANY(?) AND date BETWEEN ? AND ? AND status != 'cancelled'`,
    [masterIds, from, to],
  );
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

/** Общие входные данные расчёта: услуга, подходящие мастера, «сейчас» в зоне студии. */
async function plan(ctx, serviceId, masterId) {
  const service = await getService(ctx, serviceId);
  const masters = await eligibleMasters(ctx, serviceId, masterId);
  const now = nowInTz(ctx.cfg.timeZone, ctx.now());
  return { service, masters, now, cfg: ctx.cfg, duration: service.durationMin };
}

const slotsFor = (p, busy, date, ignoreLead = false) =>
  slotsOnDay({ masters: p.masters, busy, date, duration: p.duration, cfg: p.cfg, now: p.now, ignoreLead });

/**
 * Слоты на дату. masterId = null — «любой мастер».
 * @returns {Promise<{ start: number, masterIds: number[] }[]>}
 */
export async function daySlots(ctx, { serviceId, masterId = null, date, ignoreLead = false }) {
  const p = await plan(ctx, serviceId, masterId);
  const busy = await loadBusy(ctx.db, p.masters.map((m) => m.id), date, date);
  return [...slotsFor(p, busy, date, ignoreLead).entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, masterIds]) => ({ start, masterIds }));
}

/** Количество свободных слотов по каждому дню месяца. */
export async function monthAvailability(ctx, { serviceId, masterId = null, month }) {
  const p = await plan(ctx, serviceId, masterId);
  const { from, to } = monthBounds(month);
  const busy = await loadBusy(ctx.db, p.masters.map((m) => m.id), from, to);
  return eachDate(from, to).map((date) => ({ date, count: slotsFor(p, busy, date).size }));
}

/**
 * Ближайший свободный слот каждого подходящего мастера в пределах горизонта записи.
 * Мастера и записи читаются из базы один раз на всех.
 * @returns {Promise<Map<number, { date: string, start: number } | null>>}
 */
export async function nextFreeSlots(ctx, { serviceId, masterId = null }) {
  const p = await plan(ctx, serviceId, masterId);
  const result = new Map(p.masters.map((m) => [m.id, null]));
  if (p.masters.length === 0) return result;
  const last = addDays(p.now.date, p.cfg.horizonDays);
  const busy = await loadBusy(ctx.db, p.masters.map((m) => m.id), p.now.date, last);
  for (const master of p.masters) {
    const single = { ...p, masters: [master] };
    for (const date of eachDate(p.now.date, last)) {
      const byStart = slotsFor(single, busy, date);
      if (byStart.size > 0) {
        result.set(master.id, { date, start: Math.min(...byStart.keys()) });
        break;
      }
    }
  }
  return result;
}

/** Ближайший свободный слот (у конкретного мастера или у любого). */
export async function nextFreeSlot(ctx, { serviceId, masterId = null }) {
  const slots = [...(await nextFreeSlots(ctx, { serviceId, masterId })).values()].filter(Boolean);
  if (slots.length === 0) return null;
  return slots.reduce((best, s) => (s.date < best.date || (s.date === best.date && s.start < best.start) ? s : best));
}
