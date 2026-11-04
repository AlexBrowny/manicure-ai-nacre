// Экраны бота собраны из трёх сценариев: запись, «мои записи», меню и справка.
import { createBookingFlow } from './flow/booking.js';
import { createInfoFlow } from './flow/info.js';
import { createMyBookingsFlow } from './flow/myBookings.js';

export function createFlow({ dctx, events }) {
  return {
    ...createInfoFlow({ dctx }),
    ...createBookingFlow({ dctx, events }),
    ...createMyBookingsFlow({ dctx, events }),
  };
}
