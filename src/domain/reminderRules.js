// Правила автоматических напоминаний. «Смещение» — за сколько минут до визита напомнить.
// В записи хранится список уже отправленных (или ставших ненужными) смещений: "120,10".

export const DEFAULT_REMINDER_MINUTES = [120, 10];

export const reminderOffsets = (cfg) =>
  [...(cfg.reminderMinutes ?? DEFAULT_REMINDER_MINUTES)].sort((a, b) => b - a);

export const parseSent = (text) => new Set(String(text ?? '').split(',').filter(Boolean).map(Number));
export const serializeSent = (set) => [...set].sort((a, b) => b - a).join(',');

/** Смещения, время которых уже наступило: их отправлять не нужно (запись сделана или привязана поздно). */
export function alreadyPassed(offsets, minutesLeft) {
  return new Set(offsets.filter((offset) => minutesLeft <= offset));
}

/**
 * Какое напоминание отправить сейчас: самое «близкое к визиту» из наступивших и не отправленных.
 * Если пропущено несколько (сервер был выключен), отправляем одно — последнее по времени.
 * @returns {number | null}
 */
export function dueOffset(offsets, sent, minutesLeft) {
  if (minutesLeft <= 0) return null;
  const passed = offsets.filter((offset) => minutesLeft <= offset && !sent.has(offset));
  return passed.length > 0 ? Math.min(...passed) : null;
}

/** После отправки смещения `offset` более ранние напоминания уже не нужны. */
export function markSent(offsets, sent, offset) {
  return new Set([...sent, ...offsets.filter((o) => o >= offset)]);
}

function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** 10 → «10 минут», 120 → «2 часа», 90 → «1 ч 30 мин», 1440 → «сутки» */
export function durationPhrase(minutes) {
  if (minutes === 1440) return 'сутки';
  if (minutes < 60) return `${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])}`;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${plural(hours, ['час', 'часа', 'часов'])}`;
  }
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

/** [120, 10] → «за 2 часа и за 10 минут» */
export function describeOffsets(offsets) {
  const parts = offsets.map((o) => `за ${durationPhrase(o)}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} и ${parts.at(-1)}` : parts[0] ?? '';
}
