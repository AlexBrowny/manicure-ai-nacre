// Даты хранятся как 'YYYY-MM-DD', время — минутами от полуночи (0..1440).
// Неделя начинается с понедельника: 0 = Пн ... 6 = Вс.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');

export function minToHHMM(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function hhmmToMin(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!m) throw new RangeError(`Некорректное время: ${text}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new RangeError(`Некорректное время: ${text}`);
  return h * 60 + min;
}

function toUtcMs(iso) {
  const m = DATE_RE.exec(iso);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const fromUtcMs = (ms) => new Date(ms).toISOString().slice(0, 10);

export function isISODate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  return fromUtcMs(toUtcMs(value)) === value;
}

export function isMonth(value) {
  if (typeof value !== 'string') return false;
  const m = MONTH_RE.exec(value);
  return Boolean(m) && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export function addDays(iso, days) {
  return fromUtcMs(toUtcMs(iso) + days * 86_400_000);
}

export function weekdayOf(iso) {
  return (new Date(toUtcMs(iso)).getUTCDay() + 6) % 7;
}

export function eachDate(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

/** Текущая «настенная» дата и минуты в часовом поясе студии. */
export function nowInTz(timeZone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** «Абсолютные» минуты настенного времени — для сравнения моментов в одной зоне. */
export function localAbsMinutes(date, minutes) {
  return toUtcMs(date) / 60_000 + minutes;
}
