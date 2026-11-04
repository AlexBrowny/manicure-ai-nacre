// Записи клиентов: создание (атомарно, без двойного бронирования), статусы, отмена, напоминания.
import { randomBytes } from 'node:crypto';
import { tx } from '../db.js';
import { badRequest, conflict, notFound, slotUnavailable } from '../errors.js';
import { localAbsMinutes, nowInTz } from '../time.js';
import { daySlots, loadBusy } from './availability.js';
import { getService } from './catalog.js';
import { cleanName, normalizePhone } from './contact.js';
import {
  alreadyPassed, dueOffset, markSent, parseSent, reminderOffsets, serializeSent,
} from './reminderRules.js';

export const STATUSES = ['confirmed', 'completed', 'cancelled', 'no_show'];
const MAX_ACTIVE_PER_PHONE = 5;

const SELECT_BOOKING = `
  SELECT b.*, m.name AS master_name, m.color AS master_color
  FROM bookings b JOIN masters m ON m.id = b.master_id`;

function toBooking(r) {
  return {
    id: r.id,
    masterId: r.master_id,
    masterName: r.master_name,
    masterColor: r.master_color,
    serviceId: r.service_id,
    serviceName: r.service_name,
    price: r.price,
    date: r.date,
    startMin: r.start_min,
    endMin: r.end_min,
    clientName: r.client_name,
    clientPhone: r.client_phone,
    source: r.source,
    status: r.status,
    tgChatId: r.tg_chat_id,
    notes: r.notes,
    remindersSent: [...parseSent(r.reminders_sent)],
    lastRemindedAt: r.last_reminded_at ?? null,
    createdAt: r.created_at,
  };
}

export function getBooking({ db }, id) {
  const row = db.prepare(`${SELECT_BOOKING} WHERE b.id = ?`).get(id);
  if (!row) throw notFound('Запись');
  return toBooking(row);
}

/** Через сколько минут начнётся визит (отрицательное — уже началось). */
export function minutesUntil(ctx, date, startMin) {
  const now = nowInTz(ctx.cfg.timeZone, ctx.now());
  return localAbsMinutes(date, startMin) - localAbsMinutes(now.date, now.minutes);
}

/** Напоминания, время которых уже прошло к моменту записи/привязки, — их не отправляем. */
function skippedReminders(ctx, date, startMin) {
  return serializeSent(alreadyPassed(reminderOffsets(ctx.cfg), minutesUntil(ctx, date, startMin)));
}

/** Мастер с наименьшей загрузкой в этот день среди свободных. */
function pickMaster(ctx, masterIds, date) {
  if (masterIds.length === 1) return masterIds[0];
  const busy = loadBusy(ctx.db, masterIds, date, date);
  const load = (id) => (busy.get(`${id}|${date}`) ?? []).reduce((sum, b) => sum + (b.end - b.start), 0);
  return masterIds.reduce((best, id) => (load(id) < load(best) ? id : best));
}

function assertPhoneNotOverbooked(ctx, phone) {
  const today = nowInTz(ctx.cfg.timeZone, ctx.now()).date;
  const { n } = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM bookings WHERE client_phone = ? AND status = 'confirmed' AND date >= ?")
    .get(phone, today);
  if (n >= MAX_ACTIVE_PER_PHONE) {
    throw conflict('С этого номера уже оформлено максимум записей. Позвоните нам, чтобы изменить их.', 'too_many_bookings');
  }
}

/**
 * Создаёт запись. masterId = null — подобрать мастера автоматически.
 * @returns {object} запись + одноразовый linkToken для привязки к Telegram
 */
export function createBooking(ctx, input) {
  const name = cleanName(input.name);
  const phone = normalizePhone(input.phone);
  const source = input.source;

  return tx(ctx.db, () => {
    const service = getService(ctx, input.serviceId);
    if (!service.active) throw notFound('Услуга');
    if (source !== 'admin') assertPhoneNotOverbooked(ctx, phone);

    const slot = daySlots(ctx, {
      serviceId: service.id, masterId: input.masterId ?? null, date: input.date, ignoreLead: Boolean(input.ignoreLead),
    }).find((s) => s.start === input.startMin);
    if (!slot) throw slotUnavailable();

    const masterId = pickMaster(ctx, slot.masterIds, input.date);
    const tgChatId = input.tgChatId ?? null;
    const sent = tgChatId == null ? '' : skippedReminders(ctx, input.date, input.startMin);
    const linkToken = randomBytes(12).toString('hex');
    const { lastInsertRowid } = ctx.db
      .prepare(
        `INSERT INTO bookings (master_id, service_id, service_name, price, date, start_min, end_min,
                               client_name, client_phone, source, tg_chat_id, link_token, notes,
                               reminders_sent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        masterId, service.id, service.name, service.price, input.date, input.startMin,
        input.startMin + service.durationMin, name, phone, source, tgChatId, linkToken,
        String(input.notes ?? '').slice(0, 500), sent,
      );
    return { ...getBooking(ctx, Number(lastInsertRowid)), linkToken };
  });
}

export function setStatus(ctx, id, status) {
  if (!STATUSES.includes(status)) throw badRequest('Неизвестный статус');
  const booking = getBooking(ctx, id);
  if (booking.status === 'cancelled' && status !== 'cancelled') assertSlotStillFree(ctx, booking);
  ctx.db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, id);
  return getBooking(ctx, id);
}

function assertSlotStillFree({ db }, booking) {
  const clash = db
    .prepare(
      `SELECT 1 FROM bookings
       WHERE master_id = ? AND date = ? AND id != ? AND status != 'cancelled'
         AND start_min < ? AND end_min > ?`,
    )
    .get(booking.masterId, booking.date, booking.id, booking.endMin, booking.startMin);
  if (clash) throw slotUnavailable();
}

export function updateNotes({ db }, id, notes) {
  getBooking({ db }, id);
  db.prepare('UPDATE bookings SET notes = ? WHERE id = ?').run(String(notes).slice(0, 500), id);
  return getBooking({ db }, id);
}

/** by: 'admin' — без ограничений; 'client' — только свой чат и не позже cancelMinHours до визита. */
export function cancelBooking(ctx, id, { by, tgChatId = null }) {
  const booking = getBooking(ctx, id);
  if (by === 'client' && booking.tgChatId !== tgChatId) throw notFound('Запись');
  if (booking.status !== 'confirmed') throw conflict('Эту запись уже нельзя отменить.', 'not_cancellable');
  if (by === 'client' && minutesUntil(ctx, booking.date, booking.startMin) < ctx.cfg.cancelMinHours * 60) {
    throw conflict(
      `Онлайн-отмена возможна не позднее чем за ${ctx.cfg.cancelMinHours} ч до визита. Позвоните нам.`,
      'too_late',
    );
  }
  return setStatus(ctx, id, 'cancelled');
}

/** Привязывает запись с сайта к Telegram-чату по одноразовому токену. */
export function linkBookingToChat(ctx, token, chatId) {
  if (!/^[0-9a-f]{24}$/.test(String(token))) return null;
  const row = ctx.db
    .prepare("SELECT id, date, start_min FROM bookings WHERE link_token = ? AND tg_chat_id IS NULL AND status = 'confirmed'")
    .get(token);
  if (!row) return null;
  ctx.db
    .prepare('UPDATE bookings SET tg_chat_id = ?, reminders_sent = ? WHERE id = ?')
    .run(chatId, skippedReminders(ctx, row.date, row.start_min), row.id);
  return getBooking(ctx, row.id);
}

/** Предстоящие подтверждённые записи чата. */
export function listUpcomingForChat(ctx, chatId) {
  const rows = ctx.db
    .prepare(`${SELECT_BOOKING} WHERE b.tg_chat_id = ? AND b.status = 'confirmed' ORDER BY b.date, b.start_min`)
    .all(chatId)
    .map(toBooking);
  return rows.filter((b) => minutesUntil(ctx, b.date, b.endMin) > 0);
}

/**
 * Фильтры: from/to (даты), masterId, status, q (имя/телефон).
 * Поиск делается в JS: LIKE в SQLite не различает регистр кириллицы.
 */
export function listBookings({ db }, { from, to, masterId, status, q, limit = 1000 } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('b.date >= ?'); params.push(from); }
  if (to) { where.push('b.date <= ?'); params.push(to); }
  if (masterId) { where.push('b.master_id = ?'); params.push(masterId); }
  if (status) { where.push('b.status = ?'); params.push(status); }
  const sql = `${SELECT_BOOKING} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY b.date, b.start_min, b.id LIMIT ?`;
  let rows = db.prepare(sql).all(...params, limit).map(toBooking);

  const needle = String(q ?? '').trim().toLowerCase();
  if (needle) {
    const digits = needle.replace(/\D/g, '');
    rows = rows.filter(
      (b) => b.clientName.toLowerCase().includes(needle)
        || (digits.length >= 3 && b.clientPhone.includes(digits))
        || String(b.id) === needle,
    );
  }
  return rows;
}

/** Автоматические напоминания, которые пора отправить: [{ booking, offset }] (offset — минуты до визита). */
export function dueReminders(ctx) {
  const offsets = reminderOffsets(ctx.cfg);
  const rows = ctx.db
    .prepare(`${SELECT_BOOKING} WHERE b.status = 'confirmed' AND b.tg_chat_id IS NOT NULL AND b.date >= ?`)
    .all(nowInTz(ctx.cfg.timeZone, ctx.now()).date);
  const due = [];
  for (const row of rows) {
    const offset = dueOffset(offsets, parseSent(row.reminders_sent), minutesUntil(ctx, row.date, row.start_min));
    if (offset !== null) due.push({ booking: toBooking(row), offset });
  }
  return due;
}

/** Отмечает напоминание отправленным (и все более ранние — ненужными). */
export function markReminded(ctx, id, offset) {
  const row = ctx.db.prepare('SELECT reminders_sent FROM bookings WHERE id = ?').get(id);
  if (!row) throw notFound('Запись');
  const sent = markSent(reminderOffsets(ctx.cfg), parseSent(row.reminders_sent), offset);
  ctx.db.prepare('UPDATE bookings SET reminders_sent = ? WHERE id = ?').run(serializeSent(sent), id);
}

const MANUAL_REMINDER_COOLDOWN_SEC = 60;

/** Можно ли сейчас вручную напомнить клиенту из админки. Бросает понятную ошибку, если нельзя. */
export function assertCanRemind(ctx, booking) {
  if (booking.status !== 'confirmed') throw conflict('Напомнить можно только о подтверждённой записи.', 'not_remindable');
  if (booking.tgChatId == null) {
    throw conflict('Клиент не подключил Telegram — напоминание отправить некуда. Позвоните ему.', 'no_telegram');
  }
  if (minutesUntil(ctx, booking.date, booking.startMin) <= 0) throw conflict('Визит уже начался.', 'not_remindable');
  if (booking.lastRemindedAt) {
    const sentAgoSec = (ctx.now().getTime() - Date.parse(`${booking.lastRemindedAt.replace(' ', 'T')}Z`)) / 1000;
    if (sentAgoSec < MANUAL_REMINDER_COOLDOWN_SEC) throw conflict('Напоминание только что отправлено. Подождите минуту.', 'too_soon');
  }
}

export function markManualReminder(ctx, id) {
  ctx.db.prepare('UPDATE bookings SET last_reminded_at = ? WHERE id = ?')
    .run(ctx.now().toISOString().slice(0, 19).replace('T', ' '), id);
}
