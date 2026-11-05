// Фото мастера: выбор файла, уменьшение в браузере до 800 px и загрузка в бакет Neon через API.
import { api } from '/js/api.js';
import { h, toast } from '/js/dom.js';
import { initials } from '/js/format.js';

const MAX_SIDE = 800;
const QUALITY = 0.86;

/** Уменьшает снимок с телефона (часто 4000 px и 5+ МБ) до аккуратного WebP/JPEG в пару сотен КБ. */
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale),
  });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
  const webp = await toBlob('image/webp');
  return webp?.type === 'image/webp' ? webp : toBlob('image/jpeg'); // старый Safari не умеет WebP
}

/**
 * @param {{ master: object|null, name: () => string, color: () => string, onError: (msg: string) => void }} options
 * Для нового мастера файл ждёт сохранения: uploadPending(id) вызывается после создания.
 */
export function photoPicker({ master, name, color, onError, onChange = () => {} }) {
  let current = master?.hasUploadedPhoto ? master.photo : '';
  let pending = null; // Blob для ещё не созданного мастера
  let pendingUrl = '';

  const preview = h('div', { class: 'mcard__ava photo-pick__ava' });
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  const choose = h('button', { class: 'btn btn--sm', type: 'button', onclick: () => input.click() });
  const remove = h('button', { class: 'btn btn--sm', type: 'button' }, 'Убрать фото');
  const status = h('span', { class: 'muted photo-pick__status', 'aria-live': 'polite' });

  const paint = () => {
    const src = pendingUrl || current;
    preview.style.setProperty('--c', color());
    preview.replaceChildren(src ? h('img', { src, alt: '' }) : initials(name() || '?'));
    choose.textContent = src ? 'Заменить фото' : 'Загрузить фото';
    remove.hidden = !src;
  };

  const busy = (text) => { status.textContent = text; choose.disabled = Boolean(text); remove.disabled = Boolean(text); };

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    onError('');
    try {
      busy('Готовлю фото…');
      const blob = await shrink(file);
      if (!master) {
        pending = blob;
        URL.revokeObjectURL(pendingUrl);
        pendingUrl = URL.createObjectURL(blob);
        busy('');
        status.textContent = 'Загрузится после сохранения';
      } else {
        busy('Загружаю…');
        const saved = await api.upload(`/api/admin/masters/${master.id}/photo`, blob);
        current = saved.photo;
        onChange();
        busy('');
        toast('Фото обновлено');
      }
    } catch (err) {
      busy('');
      onError(err.message || 'Не удалось обработать фото');
    }
    paint();
  });

  remove.addEventListener('click', async () => {
    onError('');
    if (pending) {
      pending = null;
      URL.revokeObjectURL(pendingUrl);
      pendingUrl = '';
      status.textContent = '';
    } else if (master && current) {
      try {
        busy('Удаляю…');
        await api.delete(`/api/admin/masters/${master.id}/photo`);
        current = '';
        onChange();
        busy('');
        toast('Фото убрано');
      } catch (err) {
        busy('');
        onError(err.message);
      }
    }
    paint();
  });

  paint();
  return {
    el: h('div', { class: 'photo-pick' }, preview, h('div', { class: 'photo-pick__actions' }, h('div', { class: 'photo-pick__btns' }, choose, remove), status), input),
    refresh: paint,
    /** Загружает фото, выбранное до создания мастера. */
    async uploadPending(id) {
      if (!pending) return;
      await api.upload(`/api/admin/masters/${id}/photo`, pending);
      pending = null;
    },
  };
}
