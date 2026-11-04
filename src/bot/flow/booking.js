// Сценарий записи: услуга → мастер → дата → время → телефон/имя → подтверждение.
import { InlineKeyboard } from 'grammy';
import { daySlots, monthAvailability, nextFreeSlot, nextFreeSlots } from '../../domain/availability.js';
import { createBooking } from '../../domain/bookings.js';
import { getService, listMasters, listServices } from '../../domain/catalog.js';
import { cleanName, formatPhone, normalizePhone } from '../../domain/contact.js';
import { AppError } from '../../errors.js';
import { addDays, hhmmToMin, isMonth, nowInTz } from '../../time.js';
import {
  backToMenu, calendarKeyboard, confirmKeyboard, mainMenu, mastersKeyboard, servicesKeyboard, slotsKeyboard,
} from '../keyboards.js';
import { clearDraft, getProfile, saveProfile } from '../store.js';
import { bookingCard, durationText, esc, humanDate, money, timeRange } from '../texts.js';
import { describeOffsets, reminderOffsets } from '../../domain/reminderRules.js';
import { draftHelpers, show } from './common.js';

export function createBookingFlow({ dctx, events }) {
  const { db, cfg } = dctx;
  const currency = cfg.currency;
  const { draftOf, patchDraft } = draftHelpers(db);

  async function chooseService(ctx) {
    clearDraft(db, ctx.chat.id);
    const services = listServices(dctx, { activeOnly: true });
    if (services.length === 0) return show(ctx, 'Услуги пока не добавлены.', backToMenu());
    return show(ctx, '<b>Выберите услугу</b>', servicesKeyboard(services, currency));
  }

  async function chooseMaster(ctx, serviceId = draftOf(ctx)?.serviceId) {
    let service;
    try { service = getService(dctx, Number(serviceId)); } catch { return chooseService(ctx); }
    if (!service.active) return chooseService(ctx);
    patchDraft(ctx, { serviceId: service.id, masterId: null, date: null, startMin: null, step: null });

    const next = nextFreeSlots(dctx, { serviceId: service.id });
    const masters = listMasters(dctx, { activeOnly: true, serviceId: service.id })
      .map((m) => ({ ...m, nextSlot: next.get(m.id) ?? null }))
      .filter((m) => m.nextSlot);
    if (masters.length === 0) {
      return show(ctx, `На «${esc(service.name)}» сейчас нет свободного времени. Позвоните нам: ${esc(cfg.studio.phone)}`, servicesKeyboard(listServices(dctx, { activeOnly: true }), currency));
    }
    return show(
      ctx,
      `<b>${esc(service.name)}</b> · ${durationText(service.durationMin)} · ${money(service.price, currency)}\n\nВыберите мастера:`,
      mastersKeyboard(masters),
    );
  }

  async function pickMaster(ctx, masterId) {
    const d = draftOf(ctx);
    if (!d?.serviceId) return chooseService(ctx);
    const chosen = masterId === 0 ? null : masterId;
    patchDraft(ctx, { masterId: chosen });
    const next = nextFreeSlot(dctx, { serviceId: d.serviceId, masterId: chosen });
    if (!next) return show(ctx, 'У этого мастера нет свободного времени. Выберите другого.', backToMenu());
    return chooseDate(ctx, next.date.slice(0, 7));
  }

  async function chooseDate(ctx, month) {
    const d = draftOf(ctx);
    if (!d?.serviceId || !isMonth(month)) return chooseService(ctx);
    const today = nowInTz(cfg.timeZone, dctx.now()).date;
    const days = monthAvailability(dctx, { serviceId: d.serviceId, masterId: d.masterId ?? null, month });
    const keyboard = calendarKeyboard({
      month,
      days,
      canPrev: month > today.slice(0, 7),
      canNext: month < addDays(today, cfg.horizonDays).slice(0, 7),
    });
    return show(ctx, '<b>Выберите дату</b>\nТочкой отмечены дни без свободного времени.', keyboard);
  }

  async function chooseTime(ctx, date, note = '') {
    const d = draftOf(ctx);
    if (!d?.serviceId) return chooseService(ctx);
    const slots = daySlots(dctx, { serviceId: d.serviceId, masterId: d.masterId ?? null, date });
    if (slots.length === 0) {
      await ctx.answerCallbackQuery({ text: 'На этот день всё занято', show_alert: false }).catch(() => {});
      return chooseDate(ctx, date.slice(0, 7));
    }
    patchDraft(ctx, { date, startMin: null });
    return show(ctx, `${note}<b>${humanDate(date)}</b> — выберите время:`, slotsKeyboard(slots, date.slice(0, 7)));
  }

  async function pickTime(ctx, hhmm) {
    const d = draftOf(ctx);
    if (!d?.serviceId || !d.date) return chooseService(ctx);
    const startMin = hhmmToMin(`${hhmm.slice(0, 2)}:${hhmm.slice(2)}`);
    const stillFree = daySlots(dctx, { serviceId: d.serviceId, masterId: d.masterId ?? null, date: d.date })
      .some((s) => s.start === startMin);
    if (!stillFree) return chooseTime(ctx, d.date, '⚠️ Это время только что заняли.\n\n');

    const profile = getProfile(db, ctx.chat.id);
    const name = profile.name || [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
    patchDraft(ctx, { startMin, name: cleanSafe(name), phone: profile.phone || null, step: null });
    return profile.phone ? confirmScreen(ctx) : askPhone(ctx);
  }

  const cleanSafe = (name) => { try { return cleanName(name); } catch { return 'Гость'; } };

  async function askPhone(ctx) {
    patchDraft(ctx, { step: 'phone' });
    await ctx.reply('📞 Отправьте номер телефона кнопкой ниже или напишите его сообщением.', {
      reply_markup: { keyboard: [[{ text: '📱 Отправить мой номер', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
  }

  async function askName(ctx) {
    patchDraft(ctx, { step: 'name' });
    await ctx.reply('Как вас зовут? Напишите имя сообщением.');
  }

  async function confirmScreen(ctx) {
    const d = draftOf(ctx);
    if (!d?.serviceId || d.startMin == null) return chooseService(ctx);
    const service = getService(dctx, d.serviceId);
    const master = d.masterId ? listMasters(dctx).find((m) => m.id === d.masterId) : null;
    const text = [
      '<b>Проверьте запись</b>',
      `💅 ${esc(service.name)} · ${durationText(service.durationMin)}`,
      `🗓 ${humanDate(d.date)} · ${timeRange(d.startMin, d.startMin + service.durationMin)}`,
      `👩 Мастер: ${master ? esc(master.name) : 'любой свободный'}`,
      `💰 ${money(service.price, currency)}`,
      `👤 ${esc(d.name)} · ${esc(formatPhone(d.phone))}`,
    ].join('\n');
    return show(ctx, text, confirmKeyboard());
  }

  async function confirm(ctx) {
    const d = draftOf(ctx);
    if (!d?.serviceId || d.startMin == null || !d.phone) return chooseService(ctx);
    let booking;
    try {
      booking = createBooking(dctx, {
        serviceId: d.serviceId, masterId: d.masterId ?? null, date: d.date, startMin: d.startMin,
        name: d.name, phone: d.phone, source: 'telegram', tgChatId: ctx.chat.id,
      });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      if (err.code === 'slot_unavailable') return chooseTime(ctx, d.date, '⚠️ Это время только что заняли.\n\n');
      return show(ctx, `⚠️ ${esc(err.message)}`, backToMenu());
    }
    saveProfile(db, ctx.chat.id, { name: d.name, phone: d.phone });
    clearDraft(db, ctx.chat.id);
    events.emit('booking:created', booking);
    return show(
      ctx,
      `✅ <b>Вы записаны!</b>\n\n${bookingCard(booking, currency)}\n\n📍 ${esc(cfg.studio.address)}\nНапомним о визите ${describeOffsets(reminderOffsets(cfg))}.`,
      new InlineKeyboard().text('📋 Мои записи', 'my').text('‹ В меню', 'menu'),
    );
  }

  async function onContact(ctx) {
    const contact = ctx.message.contact;
    if (contact.user_id && contact.user_id !== ctx.from.id) {
      return ctx.reply('Пожалуйста, отправьте свой номер — кнопкой «Отправить мой номер».');
    }
    return acceptPhone(ctx, contact.phone_number);
  }

  async function acceptPhone(ctx, raw) {
    try {
      const phone = normalizePhone(raw);
      patchDraft(ctx, { phone, step: null });
    } catch (err) {
      return ctx.reply(`${err.message}`);
    }
    await ctx.reply('Номер сохранён.', { reply_markup: { remove_keyboard: true } });
    return confirmScreen(ctx);
  }

  async function onText(ctx) {
    const d = draftOf(ctx);
    const text = ctx.message.text ?? '';
    if (d?.step === 'phone' && !text.startsWith('/')) return acceptPhone(ctx, text);
    if (d?.step === 'name' && !text.startsWith('/')) {
      try {
        patchDraft(ctx, { name: cleanName(text), step: null });
      } catch (err) {
        return ctx.reply(err.message);
      }
      return confirmScreen(ctx);
    }
    return ctx.reply('Выберите действие в меню 👇', { reply_markup: mainMenu(cfg.telegram.webAppUrl) });
  }

  return {
    chooseService, chooseMaster, pickMaster, chooseDate, chooseTime, pickTime,
    askPhone, askName, confirm, confirmScreen, onContact, onText,
  };
}
