// Сценарий записи и меню бота. Каждая функция принимает контекст grammY и показывает экран.
import { InlineKeyboard } from 'grammy';
import { daySlots, monthAvailability, nextFreeSlot } from '../domain/availability.js';
import {
  cancelBooking, createBooking, getBooking, linkBookingToChat, listUpcomingForChat,
} from '../domain/bookings.js';
import { listMasters, listServices, getService } from '../domain/catalog.js';
import { cleanName, formatPhone, normalizePhone } from '../domain/contact.js';
import { AppError } from '../errors.js';
import { addDays, hhmmToMin, isMonth, nowInTz } from '../time.js';
import {
  backToMenu, calendarKeyboard, confirmCancelKeyboard, confirmKeyboard, mainMenu, mastersKeyboard,
  myBookingsKeyboard, servicesKeyboard, slotsKeyboard,
} from './keyboards.js';
import { clearDraft, getDraft, getProfile, saveDraft, saveProfile } from './store.js';
import {
  bookingCard, durationText, esc, humanDate, money, timeRange,
} from './texts.js';

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

const isNotModified = (err) => String(err?.description ?? err?.message).includes('message is not modified');

export function createFlow({ dctx, events }) {
  const { db, cfg } = dctx;
  const currency = cfg.currency;

  /** Редактирует сообщение с кнопкой, а для обычных сообщений отправляет новое. */
  async function show(ctx, text, keyboard) {
    const options = { ...HTML, reply_markup: keyboard };
    if (ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText(text, options);
        return;
      } catch (err) {
        if (isNotModified(err)) return;
      }
    }
    await ctx.reply(text, options);
  }

  const draftOf = (ctx) => getDraft(db, ctx.chat.id);
  const patchDraft = (ctx, patch) => saveDraft(db, ctx.chat.id, { ...(draftOf(ctx) ?? {}), ...patch });

  async function menu(ctx) {
    clearDraft(db, ctx.chat.id);
    await show(ctx, `Здравствуйте! Это <b>${esc(cfg.studio.name)}</b> — ${esc(cfg.studio.tagline)}.\nЧем могу помочь?`, mainMenu());
  }

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

    const masters = listMasters(dctx, { activeOnly: true, serviceId: service.id })
      .map((m) => ({ ...m, nextSlot: nextFreeSlot(dctx, { serviceId: service.id, masterId: m.id }) }))
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
      `✅ <b>Вы записаны!</b>\n\n${bookingCard(booking, currency)}\n\n📍 ${esc(cfg.studio.address)}\nНапомним о визите за сутки и за 2 часа.`,
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
    return ctx.reply('Выберите действие в меню 👇', { reply_markup: mainMenu() });
  }

  async function myBookings(ctx) {
    const list = listUpcomingForChat(dctx, ctx.chat.id);
    if (list.length === 0) {
      return show(ctx, 'У вас нет предстоящих записей.', new InlineKeyboard().text('💅 Записаться', 'book').text('‹ В меню', 'menu'));
    }
    const body = list.map((b) => bookingCard(b, currency)).join('\n\n');
    return show(ctx, `<b>Ваши записи</b>\n\n${body}`, myBookingsKeyboard(list));
  }

  function ownBooking(ctx, id) {
    const booking = getBooking(dctx, id);
    if (booking.tgChatId !== ctx.chat.id) throw new AppError(404, 'not_found', 'Запись не найдена');
    return booking;
  }

  async function askCancel(ctx, id) {
    const booking = ownBooking(ctx, id);
    return show(ctx, `Отменить запись?\n\n${bookingCard(booking, currency)}`, confirmCancelKeyboard(id));
  }

  async function doCancel(ctx, id) {
    try {
      const booking = cancelBooking(dctx, id, { by: 'client', tgChatId: ctx.chat.id });
      events.emit('booking:status', { booking, previous: 'confirmed', by: 'client' });
      return show(ctx, 'Запись отменена. Будем рады видеть вас снова!', new InlineKeyboard().text('💅 Записаться', 'book').text('‹ В меню', 'menu'));
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      return show(ctx, `⚠️ ${esc(err.message)}\n📞 ${esc(cfg.studio.phone)}`, backToMenu());
    }
  }

  async function prices(ctx) {
    const byCategory = new Map();
    for (const s of listServices(dctx, { activeOnly: true })) {
      byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s]);
    }
    const blocks = [...byCategory].map(([category, items]) =>
      [`<b>${esc(category)}</b>`, ...items.map((s) => `• ${esc(s.name)} — ${money(s.price, currency)} · ${durationText(s.durationMin)}`)].join('\n'));
    return show(ctx, `💰 <b>Услуги и цены</b>\n\n${blocks.join('\n\n')}`, new InlineKeyboard().text('💅 Записаться', 'book').text('‹ В меню', 'menu'));
  }

  async function info(ctx) {
    const { studio } = cfg;
    const lines = [`📍 <b>${esc(studio.name)}</b>`, esc(studio.address), `🕒 ${esc(studio.hours)}`, `📞 ${esc(studio.phone)}`];
    if (studio.instagram) lines.push(`📷 ${esc(studio.instagram)}`);
    return show(ctx, lines.join('\n'), backToMenu());
  }

  async function start(ctx) {
    const payload = String(ctx.match ?? '');
    if (payload.startsWith('b_')) {
      const booking = linkBookingToChat(dctx, payload.slice(2), ctx.chat.id);
      if (booking) {
        return ctx.reply(
          `✅ Запись привязана к Telegram. Напомним о визите за сутки и за 2 часа.\n\n${bookingCard(booking, currency)}`,
          { ...HTML, reply_markup: mainMenu() },
        );
      }
    }
    return menu(ctx);
  }

  return {
    menu, start, chooseService, chooseMaster, pickMaster, chooseDate, chooseTime, pickTime,
    askPhone, askName, confirm, confirmScreen, onContact, onText, myBookings, askCancel, doCancel,
    prices, info,
  };
}
