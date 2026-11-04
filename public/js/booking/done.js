// Экран «Вы записаны»: итог, .ics-файл, ссылка на напоминания в Telegram.
import { h, svg } from '../dom.js';
import { dateLong, money } from '../format.js';
import { downloadIcs } from '../ics.js';

const CHECK = '<svg class="done__check" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="42"/><path d="M26 43l11 11 21-23"/></svg>';

export function doneView({ booking, telegramLink, config, onAgain }) {
  const line = (label, value) => h('div', {}, h('span', {}, label), h('b', {}, value));
  const actions = [
    h('button', { class: 'btn btn-ics', type: 'button', onclick: () => downloadIcs(booking, config) }, 'Добавить в календарь'),
    telegramLink && h('a', { class: 'btn btn--primary', href: telegramLink, target: '_blank', rel: 'noopener' }, 'Напоминания в Telegram'),
    h('button', { class: 'btn', type: 'button', onclick: onAgain }, 'Записаться ещё'),
  ];
  return h('div', { class: 'panel done' },
    svg(CHECK),
    h('h3', {}, `Вы записаны, ${booking.clientName.split(' ')[0]}!`),
    h('div', { class: 'done__card' },
      line('Услуга', booking.serviceName), line('Мастер', booking.masterName),
      line('Когда', `${dateLong(booking.date)}, ${booking.start}–${booking.end}`),
      line('Стоимость', money(booking.price, config.currency)), line('Адрес', config.studio.address)),
    h('div', { class: 'done__actions' }, actions),
    h('p', { class: 'done__note' }, telegramLink
      ? `Нажмите «Напоминания в Telegram» — бот напомнит о визите ${config.reminders || 'заранее'} и позволит отменить запись.`
      : `Если планы изменятся, позвоните нам: ${config.studio.phone}`));
}
