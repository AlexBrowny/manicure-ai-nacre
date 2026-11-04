// Расписание дня для админки: смены мастеров и их записи (отменённые не показываем).
import { weekdayOf } from '../time.js';
import { listBookings } from './bookings.js';
import { listMasters } from './catalog.js';

/** Смена мастера на дату или null, если выходной (по графику или отпуск). */
function shiftOn(master, date) {
  const row = master.schedule.find((s) => s.weekday === weekdayOf(date)) ?? null;
  const dayOff = master.daysOff.some((d) => d.from <= date && date <= d.to);
  return { shift: row && !dayOff ? row : null, dayOff };
}

/**
 * Активные мастера плюс отключённые, у которых в этот день есть записи.
 * @returns {{ id, name, title, color, shift, dayOff, bookings }[]}
 */
export async function daySchedule(ctx, date) {
  const bookings = (await listBookings(ctx, { from: date, to: date })).filter((b) => b.status !== 'cancelled');
  return (await listMasters(ctx))
    .filter((m) => m.active || bookings.some((b) => b.masterId === m.id))
    .map((m) => ({
      id: m.id, name: m.name, title: m.title, color: m.color,
      ...shiftOn(m, date),
      bookings: bookings.filter((b) => b.masterId === m.id),
    }));
}
