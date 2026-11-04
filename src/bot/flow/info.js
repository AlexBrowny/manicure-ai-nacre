// Меню, /start (в том числе привязка записи с сайта), цены и контакты.
import { InlineKeyboard } from 'grammy';
import { linkBookingToChat } from '../../domain/bookings.js';
import { listServices } from '../../domain/catalog.js';
import { backToMenu, mainMenu } from '../keyboards.js';
import { clearDraft } from '../store.js';
import { bookingCard, durationText, esc, money } from '../texts.js';
import { HTML, show } from './common.js';

export function createInfoFlow({ dctx }) {
  const { db, cfg } = dctx;
  const currency = cfg.currency;

  async function menu(ctx) {
    clearDraft(db, ctx.chat.id);
    await show(ctx, `Здравствуйте! Это <b>${esc(cfg.studio.name)}</b> — ${esc(cfg.studio.tagline)}.\nЧем могу помочь?`, mainMenu());
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

  async function prices(ctx) {
    const byCategory = Map.groupBy(listServices(dctx, { activeOnly: true }), (s) => s.category);
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

  return { menu, start, prices, info };
}
