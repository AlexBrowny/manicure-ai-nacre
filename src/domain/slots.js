// Чистые функции для расчёта свободного времени. Интервалы — [start, end) в минутах.

/** Рабочие интервалы мастера на день: смена минус обеденный перерыв. */
export function workingIntervals(row) {
  const { startMin: start, endMin: end, breakStartMin: bs, breakEndMin: be } = row;
  const hasBreak = bs != null && be != null && bs < be && bs > start && be < end;
  if (!hasBreak) return [{ start, end }];
  return [{ start, end: bs }, { start: be, end }];
}

/** Вычитает занятые интервалы из свободных. Порядок и пересечения busy не важны. */
export function subtractIntervals(free, busy) {
  const sortedBusy = [...busy].sort((a, b) => a.start - b.start);
  const result = [];
  for (const interval of free) {
    let cursor = interval.start;
    for (const b of sortedBusy) {
      if (b.end <= cursor) continue;
      if (b.start >= interval.end) break;
      if (b.start > cursor) result.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  }
  return result;
}

/** Времена начала услуги на сетке `step`, полностью помещающиеся в свободные интервалы. */
export function startsFor(free, duration, step, minStart = 0) {
  const starts = [];
  for (const { start, end } of free) {
    const first = Math.ceil(Math.max(start, minStart) / step) * step;
    for (let t = first; t + duration <= end; t += step) starts.push(t);
  }
  return starts;
}

/** Сколько минут из интервалов попадает в окно [from, to). */
export function overlapMinutes(intervals, from, to) {
  let total = 0;
  for (const { start, end } of intervals) {
    total += Math.max(0, Math.min(end, to) - Math.max(start, from));
  }
  return total;
}
