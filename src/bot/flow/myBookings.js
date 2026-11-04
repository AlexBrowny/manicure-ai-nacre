// «Мои записи»: список предстоящих визитов и отмена клиентом.
import { InlineKeyboard } from 'grammy';
import { cancelBooking, getBooking, listUpcomingForChat } from '../../domain/bookings.js';
import { AppError } from '../../errors.js';
import { backToMenu, confirmCancelKeyboard, myBookingsKeyboard } from '../keyboards.js';
import { bookingCard, esc } from '../texts.js';
import { show } from './common.js';

const bookAgain = () => new InlineKeyboard().text('💅 Записаться', 'book').text('‹ В меню', 'menu');

export function createMyBookingsFlow({ dctx, events }) {
  const { cfg } = dctx;
  const currency = cfg.currency;

  async function myBookings(ctx) {
    const list = await listUpcomingForChat(dctx, ctx.chat.id);
    if (list.length === 0) return show(ctx, 'У вас нет предстоящих записей.', bookAgain());
    const body = list.map((b) => bookingCard(b, currency)).join('\n\n');
    return show(ctx, `<b>Ваши записи</b>\n\n${body}`, myBookingsKeyboard(list));
  }

  async function ownBooking(ctx, id) {
    const booking = await getBooking(dctx, id);
    if (booking.tgChatId !== ctx.chat.id) throw new AppError(404, 'not_found', 'Запись не найдена');
    return booking;
  }

  async function askCancel(ctx, id) {
    const booking = await ownBooking(ctx, id);
    return show(ctx, `Отменить запись?\n\n${bookingCard(booking, currency)}`, confirmCancelKeyboard(id));
  }

  async function doCancel(ctx, id) {
    try {
      const booking = await cancelBooking(dctx, id, { by: 'client', tgChatId: ctx.chat.id });
      events.emit('booking:status', { booking, previous: 'confirmed', by: 'client' });
      return show(ctx, 'Запись отменена. Будем рады видеть вас снова!', bookAgain());
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      return show(ctx, `⚠️ ${esc(err.message)}\n📞 ${esc(cfg.studio.phone)}`, backToMenu());
    }
  }

  return { myBookings, askCancel, doCancel };
}
