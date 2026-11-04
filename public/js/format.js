const numberFmt = new Intl.NumberFormat('ru-RU');
const longDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

export const money = (amount, currency) => `${numberFmt.format(amount)} ${currency}`;

export function duration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ');
}

/** 'YYYY-MM-DD' → локальная полночь (для форматирования дат без сдвига по часовому поясу). */
export const parseISO = (iso) => new Date(`${iso}T00:00:00`);
export const toISO = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const dateLong = (iso) => longDate.format(parseISO(iso));
export const dateShort = (iso) => shortDate.format(parseISO(iso));
export const monthTitle = (month) => monthFmt.format(parseISO(`${month}-01`)).replace(/\s*г\.$/, '');

/** Пн = 0 … Вс = 6 */
export const weekdayIndex = (iso) => (parseISO(iso).getDay() + 6) % 7;

export function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const initials = (name) => (name.trim()[0] ?? '·').toUpperCase();

/** «1 окно», «2 окна», «5 окон» */
export function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

const UZ_CODE = '998';

/**
 * Ввод телефона «на лету»: +998 (90) 123-45-67. Можно вводить без кода (90 123 45 67),
 * с «8» впереди или вставить номер целиком. Номер другой страны — начните с «+» и её кода.
 */
export function formatPhoneInput(raw) {
  const digits = raw.replace(/\D/g, '');
  const plus = raw.trimStart().startsWith('+');
  if (!digits) return plus ? '+' : '';
  const isUzPrefix = digits.startsWith(UZ_CODE) || UZ_CODE.startsWith(digits);
  if (plus && !isUzPrefix) return `+${digits.slice(0, 15)}`;
  if (plus && digits.length < UZ_CODE.length) return `+${digits}`; // человек ещё набирает «+998»

  const hasCode = digits.startsWith(UZ_CODE);
  let national = hasCode ? digits.slice(UZ_CODE.length) : digits;
  if (!hasCode && !plus && national.startsWith('8')) national = national.slice(1); // 8 90 … → 90 …
  const d = national.slice(0, 9);

  let out = `+${UZ_CODE}`;
  if (d.length > 0) out += ` (${d.slice(0, 2)}`;
  if (d.length >= 2) out += ')';
  if (d.length > 2) out += ` ${d.slice(2, 5)}`;
  if (d.length > 5) out += `-${d.slice(5, 7)}`;
  if (d.length > 7) out += `-${d.slice(7, 9)}`;
  return out;
}

/** Номер для показа: +998901234567 → «+998 90 123-45-67»; остальные номера — как есть. */
export function formatPhone(phone) {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+998 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}

export const digitsOf = (value) => value.replace(/\D/g, '');

/** Номер введён полностью: узбекский — 12 цифр с кодом, иностранный — от 10. */
export function isPhoneComplete(value) {
  const digits = digitsOf(value);
  return digits.startsWith(UZ_CODE) ? digits.length === UZ_CODE.length + 9 : digits.length >= 10;
}
