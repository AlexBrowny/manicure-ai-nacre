// Состояние виджета записи и чистые вычисления над ним.

export function createState({ minMonth, preferMasterId = null }) {
  return {
    category: 'all', service: null, masterId: null, preferMasterId,
    masters: [], month: minMonth, date: null, slots: [], time: null, submitting: false,
  };
}

/** Самый ранний nextSlot среди мастеров (или null). */
export const earliest = (masters) => masters.map((m) => m.nextSlot).filter(Boolean)
  .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0] ?? null;

/** Ближайшее окно выбранного мастера или, при «любом мастере», всех. */
export const nextSlotFor = (state) =>
  earliest(state.masterId == null ? state.masters : state.masters.filter((m) => m.id === state.masterId));

export const selectedMaster = (state) =>
  (state.masterId == null ? null : state.masters.find((m) => m.id === state.masterId) ?? null);

/** «10:00» + 90 мин → «11:30» */
export function endTime(time, minutes) {
  const [hh, mm] = time.split(':').map(Number);
  const total = hh * 60 + mm + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Все дни месяца без свободного времени — заглушка, пока услуга не выбрана. */
export function emptyMonth(month) {
  const count = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  return Array.from({ length: count }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, '0')}`, count: 0 }));
}
