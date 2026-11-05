// Фото мастеров в Neon Object Storage: в базе хранится ключ объекта, сами байты — в бакете.
import { randomUUID } from 'node:crypto';
import { AppError, badRequest } from '../errors.js';
import { getMaster } from './masters.js';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MEDIA_PREFIX = '/media/';
const KEY_PATTERN = /^masters\/\d+\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** Тип картинки определяем по первым байтам, а не по заголовку запроса. */
export function sniffImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

export const isMediaKey = (key) => KEY_PATTERN.test(key);

/** Публичный адрес фото: загруженное в бакет, иначе внешняя ссылка, иначе пусто. */
export const photoUrlOf = (master) => (master.photoKey ? `${MEDIA_PREFIX}${master.photoKey}` : master.photoUrl);

function requireStorage(storage) {
  if (!storage) throw new AppError(503, 'storage_off', 'Хранилище файлов не настроено: выполните `neon env pull`, чтобы получить ключи бакета.');
  return storage;
}

/** Сохраняет новое фото мастера и удаляет прежнее. Каждый файл получает новый ключ — кэш браузера не мешает. */
export async function setMasterPhoto({ db, storage }, id, bytes) {
  const store = requireStorage(storage);
  const master = await getMaster({ db }, id);
  if (!bytes?.length) throw badRequest('Файл пустой', 'bad_image');
  if (bytes.length > MAX_PHOTO_BYTES) throw new AppError(413, 'too_large', 'Фото больше 5 МБ');
  const image = sniffImage(bytes);
  if (!image) throw badRequest('Нужна картинка JPEG, PNG или WebP', 'bad_image');

  const key = `masters/${id}/${randomUUID()}.${image.ext}`;
  await store.put(key, bytes, image.type);
  await db.run('UPDATE masters SET photo_key = ? WHERE id = ?', [key, id]);
  if (master.photoKey) await store.remove(master.photoKey).catch(() => {});
  return getMaster({ db }, id);
}

export async function removeMasterPhoto({ db, storage }, id) {
  const master = await getMaster({ db }, id);
  if (!master.photoKey) return master;
  await db.run('UPDATE masters SET photo_key = NULL WHERE id = ?', [id]);
  await storage?.remove(master.photoKey).catch(() => {});
  return getMaster({ db }, id);
}

/** Файл для отдачи по /media/…; только ключи нашего формата. */
export async function readMedia({ storage }, key) {
  if (!storage || !isMediaKey(key)) return null;
  return storage.get(key);
}
