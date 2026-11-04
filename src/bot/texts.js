// Форматирование сообщений бота (parse_mode: HTML — пользовательский текст всегда экранируем).
import { formatPhone } from '../domain/contact.js';
import { minToHHMM } from '../time.js';

export const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const dateFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const numberFmt = new Intl.NumberFormat('ru-RU');

/** «ср, 4 ноября» */
export const humanDate = (iso) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

/** «Ноябрь 2026» */
export function monthTitle(month) {
  const text = monthFmt.format(new Date(`${month}-01T00:00:00Z`)).replace(/\s*г\.$/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const money = (amount, currency) => `${numberFmt.format(amount)} ${currency}`;

export const timeRange = (startMin, endMin) => `${minToHHMM(startMin)}–${minToHHMM(endMin)}`;

/** Карточка записи для клиента и администратора. */
export function bookingCard(b, currency) {
  return [
    `💅 <b>${esc(b.serviceName)}</b>`,
    `🗓 ${humanDate(b.date)} · ${timeRange(b.startMin, b.endMin)}`,
    `👩 Мастер: ${esc(b.masterName)}`,
    `💰 ${money(b.price, currency)}`,
  ].join('\n');
}

const SOURCE_LABEL = { web: 'сайт', telegram: 'Telegram-бот', admin: 'администратор' };

export function adminNewBookingText(b, currency) {
  return [
    `🆕 <b>Новая запись</b> · ${SOURCE_LABEL[b.source] ?? b.source}`,
    bookingCard(b, currency),
    `👤 ${esc(b.clientName)}, ${esc(formatPhone(b.clientPhone))}`,
  ].join('\n');
}

export function adminCancelText(b, currency, by) {
  const who = by === 'client' ? 'клиент' : 'администратор';
  return [`❌ <b>Запись отменена</b> (${who})`, bookingCard(b, currency), `👤 ${esc(b.clientName)}, ${esc(formatPhone(b.clientPhone))}`].join('\n');
}

export function reminderText(b, currency, kind) {
  const lead = kind === '2h' ? '⏰ Ждём вас уже совсем скоро!' : '⏰ Напоминаем о записи на завтра.';
  return `${lead}\n\n${bookingCard(b, currency)}`;
}

/** 90 → «1 ч 30 мин» */
export function durationText(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ');
}
