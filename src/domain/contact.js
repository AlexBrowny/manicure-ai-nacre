import { badRequest } from '../errors.js';

const UZ_CODE = '998';
const UZ_LENGTH = UZ_CODE.length + 9; // +998 XX XXX-XX-XX → 12 цифр

/**
 * Приводит телефон к виду +XXXXXXXXXXXX. Основной формат — Узбекистан (+998 90 123-45-67);
 * принимаются также «9 цифр без кода» (90 123 45 67) и «8 90 123 45 67».
 * Номера других стран допускаются в международном виде (10–15 цифр).
 */
export function normalizePhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 9) digits = UZ_CODE + digits;
  else if (digits.length === 10 && digits.startsWith('8')) digits = UZ_CODE + digits.slice(1);

  const valid = digits.startsWith(UZ_CODE)
    ? digits.length === UZ_LENGTH
    : digits.length >= 10 && digits.length <= 15;
  if (!valid) throw badRequest('Укажите телефон в формате +998 90 123-45-67', 'invalid_phone');
  return `+${digits}`;
}

/** Убирает управляющие символы, угловые скобки и лишние пробелы; проверяет длину. */
export function cleanName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60) {
    throw badRequest('Имя должно быть от 2 до 60 символов', 'invalid_name');
  }
  return name;
}

export function formatPhone(phone) {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+998 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}
