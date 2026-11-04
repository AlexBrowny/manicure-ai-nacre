export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what = 'Запись') => new AppError(404, 'not_found', `${what} не найдена`);
export const badRequest = (message, code = 'bad_request') => new AppError(400, code, message);
export const conflict = (message, code = 'conflict') => new AppError(409, code, message);
export const slotUnavailable = () => new AppError(409, 'slot_unavailable', 'Это время уже занято. Выберите другое.');
