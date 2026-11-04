import { InlineKeyboard } from 'grammy';
import { minToHHMM, weekdayOf } from '../time.js';
import { humanDate, monthTitle, money } from './texts.js';

const BLANK = '⠀'; // Telegram не принимает пустой текст кнопки
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** webAppUrl — адрес мини-приложения: если задан, первой идёт кнопка календаря записи. */
export function mainMenu(webAppUrl = '') {
  const kb = new InlineKeyboard();
  if (webAppUrl) kb.webApp('📅 Календарь записи', webAppUrl).row();
  return kb
    .text(webAppUrl ? '💬 Записаться в чате' : '💅 Записаться', 'book').row()
    .text('📋 Мои записи', 'my').text('💰 Услуги и цены', 'prices').row()
    .text('📍 Контакты', 'info');
}

export function servicesKeyboard(services, currency) {
  const kb = new InlineKeyboard();
  for (const s of services) kb.text(`${s.name} · ${money(s.price, currency)}`, `s:${s.id}`).row();
  return kb.text('‹ В меню', 'menu');
}

export function mastersKeyboard(masters) {
  const kb = new InlineKeyboard().text('✨ Любой свободный мастер', 'mst:0').row();
  for (const m of masters) {
    const next = m.nextSlot ? ` · ${humanDate(m.nextSlot.date)} ${minToHHMM(m.nextSlot.start)}` : '';
    kb.text(`${m.name}${next}`, `mst:${m.id}`).row();
  }
  return kb.text('‹ Другая услуга', 'book');
}

/** Календарь месяца: дни со свободным временем — кнопки, остальные — точки. */
export function calendarKeyboard({ month, days, canPrev, canNext }) {
  const kb = new InlineKeyboard()
    .text(canPrev ? '‹' : BLANK, canPrev ? `cal:${shiftMonth(month, -1)}` : 'noop')
    .text(monthTitle(month), 'noop')
    .text(canNext ? '›' : BLANK, canNext ? `cal:${shiftMonth(month, 1)}` : 'noop').row();
  for (const label of WEEKDAYS) kb.text(label, 'noop');
  kb.row();

  const cells = [...Array(weekdayOf(days[0].date)).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  cells.forEach((cell, index) => {
    if (cell === null) kb.text(BLANK, 'noop');
    else if (cell.count > 0) kb.text(String(Number(cell.date.slice(8))), `day:${cell.date}`);
    else kb.text('·', 'noop');
    if (index % 7 === 6) kb.row();
  });
  return kb.text('‹ Другой мастер', 'b:mst');
}

export function slotsKeyboard(slots, month) {
  const kb = new InlineKeyboard();
  slots.forEach((slot, index) => {
    const label = minToHHMM(slot.start);
    kb.text(label, `t:${label.replace(':', '')}`);
    if (index % 4 === 3) kb.row();
  });
  if (slots.length % 4 !== 0) kb.row();
  return kb.text('‹ Другая дата', `cal:${month}`);
}

export const confirmKeyboard = () =>
  new InlineKeyboard()
    .text('✅ Подтвердить запись', 'ok').row()
    .text('✏️ Имя', 'edit:name').text('📞 Телефон', 'edit:phone').row()
    .text('‹ Другое время', 'b:slots');

export function myBookingsKeyboard(bookings) {
  const kb = new InlineKeyboard();
  for (const b of bookings) kb.text(`✖ Отменить ${humanDate(b.date)} ${minToHHMM(b.startMin)}`, `cx:${b.id}`).row();
  return kb.text('💅 Записаться ещё', 'book').text('‹ В меню', 'menu');
}

export const confirmCancelKeyboard = (id) =>
  new InlineKeyboard().text('Да, отменить', `cxy:${id}`).text('Нет, оставить', 'my');

export const backToMenu = () => new InlineKeyboard().text('‹ В меню', 'menu');
