// Общие элементы админки: модальные окна, бейджи, хелперы дат.
import { h, toast } from '/js/dom.js';
import { formatPhone } from '/js/format.js';

export const STATUS = { confirmed: 'Подтверждена', completed: 'Выполнена', cancelled: 'Отменена', no_show: 'Не пришла' };
export const SOURCE = { web: 'Сайт', telegram: 'Telegram', admin: 'Администратор' };
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const WEEKDAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

export const badge = (status) => h('span', { class: `badge badge--${status}` }, STATUS[status] ?? status);

/** Сообщение об ошибке; при истёкшей сессии — обратно на экран входа. */
export function handleError(err) {
  if (err?.status === 401) {
    window.location.reload();
    return;
  }
  toast(err?.message ?? 'Что-то пошло не так', { error: true, ms: 6000 });
}

export function openModal({ title, width = 560, body, footer = [], onClose }) {
  const previous = document.activeElement;
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  function close() {
    back.remove();
    document.removeEventListener('keydown', onKey);
    previous?.focus?.();
    onClose?.();
  }
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { '--w': `${width}px` } },
    h('div', { class: 'modal__head' },
      h('h2', {}, title),
      h('button', { class: 'modal__x', type: 'button', 'aria-label': 'Закрыть', onclick: close }, '×')),
    h('div', { class: 'modal__body' }, body),
    footer.length > 0 && h('div', { class: 'modal__foot' }, footer));
  const back = h('div', { class: 'modal-back', onmousedown: (event) => { if (event.target === back) close(); } }, modal);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  modal.querySelector('input:not([type=checkbox]), select, textarea')?.focus({ preventScroll: true });
  return { close, el: modal };
}

export function confirmDialog(message, { confirmText = 'Да', danger = true } = {}) {
  return new Promise((resolve) => {
    const finish = (value) => { dialog.close(); resolve(value); };
    const dialog = openModal({
      title: 'Подтвердите', width: 420,
      body: h('p', {}, message),
      footer: [
        h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, 'Нет'),
        h('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button', onclick: () => finish(true) }, confirmText),
      ],
    });
  });
}

// ---- Даты и числа ----
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const fmtISO = (date) => date.toISOString().slice(0, 10);
export const isoAdd = (iso, days) => fmtISO(new Date(utc(iso).getTime() + days * 86400000));
export const weekdayIdx = (iso) => (utc(iso).getUTCDay() + 6) % 7;
export const startOfWeek = (iso) => isoAdd(iso, -weekdayIdx(iso));
export const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
export const endOfMonth = (iso) => fmtISO(new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)));

export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const toMin = (text) => { const [a, b] = text.split(':').map(Number); return a * 60 + b; };

/** 90 → «1,5 ч», 600 → «10 ч» */
export const hoursText = (min) => `${String(Math.round((min / 60) * 10) / 10).replace('.', ',')} ч`;

export const telLink = (phone) => h('a', { href: `tel:${phone}`, style: { textDecoration: 'underline', textUnderlineOffset: '3px' } }, formatPhone(phone));

/** Текущие минуты от полуночи в часовом поясе студии. */
export function nowMinutes(timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
}

export const field = (label, control, attrs = {}) => h('label', { class: 'field-label', ...attrs }, label, control);
