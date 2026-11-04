// Карточка записи (статусы, заметки) и форма новой записи — общие для «Расписания» и «Записей».
import { api } from '/js/api.js';
import { h, toast } from '/js/dom.js';
import { dateLong, formatPhoneInput, money } from '/js/format.js';
import {
  SOURCE, badge, confirmDialog, field, handleError, openModal, telLink,
} from './ui.js';

const dateTime = (b) => `${dateLong(b.date)}, ${b.start}–${b.end}`;

/** «2026-11-03 09:15:00» (UTC из базы) → «12:15» в часовом поясе студии. */
const clockTime = (utc, timeZone) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone })
  .format(new Date(`${utc.replace(' ', 'T')}Z`));

function remindersText(b, timeZone) {
  if (!b.telegram) return 'не отправляются — Telegram не подключён';
  const parts = [];
  if (b.remindersSent?.length) parts.push(`авто: ${b.remindersSent.map((m) => (m >= 60 ? `за ${m / 60} ч` : `за ${m} мин`)).join(', ')}`);
  if (b.lastRemindedAt) parts.push(`вручную в ${clockTime(b.lastRemindedAt, timeZone)}`);
  return parts.length ? parts.join(' · ') : 'ещё не отправлялись';
}

/** Кнопка «Напомнить в Telegram»: шлёт напоминание сейчас и обновляет строку статуса. */
function remindButton(booking, { timeZone, statusEl }) {
  const btn = h('button', {
    class: 'btn spacer', type: 'button', disabled: !booking.telegram,
    title: booking.telegram ? 'Отправить клиенту напоминание о записи прямо сейчас' : 'Клиент не подключил Telegram',
  }, '🔔 Напомнить в Telegram');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const updated = await api.post(`/api/admin/bookings/${booking.id}/remind`);
      statusEl.textContent = remindersText(updated, timeZone);
      toast('Напоминание отправлено');
    } catch (err) {
      handleError(err);
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

export function openBookingModal(booking, { currency, timeZone, onChanged }) {
  const remindersEl = h('dd', {}, remindersText(booking, timeZone));
  const notes = h('textarea', { maxlength: '500', placeholder: 'Заметка для мастеров (не видна клиенту)' }, booking.notes);
  const saveNotes = h('button', { class: 'btn btn--sm', type: 'button', onclick: () => patch({ notes: notes.value }, 'Заметка сохранена') }, 'Сохранить заметку');

  async function patch(body, message) {
    try {
      await api.patch(`/api/admin/bookings/${booking.id}`, body);
      toast(message);
      modal.close();
      onChanged();
    } catch (err) {
      handleError(err);
    }
  }

  async function changeStatus(status, { ask, message }) {
    if (ask && !(await confirmDialog(ask, { confirmText: 'Да, отменить' }))) return;
    await patch({ status }, message);
  }

  const button = (label, status, opts, cls = '') => h('button', { class: `btn ${cls}`, type: 'button', onclick: () => changeStatus(status, opts) }, label);
  const actions = {
    confirmed: [
      remindButton(booking, { timeZone, statusEl: remindersEl }),
      button('Выполнена', 'completed', { message: 'Отмечена как выполненная' }, 'btn--primary'),
      button('Не пришла', 'no_show', { message: 'Отмечена как неявка' }),
      button('Отменить запись', 'cancelled', { ask: 'Отменить запись? Клиент получит уведомление в Telegram, если он подключён.', message: 'Запись отменена' }, 'btn--danger'),
    ],
    completed: [button('Вернуть в «Подтверждена»', 'confirmed', { message: 'Статус изменён' })],
    no_show: [button('Вернуть в «Подтверждена»', 'confirmed', { message: 'Статус изменён' })],
    cancelled: [button('Восстановить запись', 'confirmed', { message: 'Запись восстановлена' })],
  }[booking.status];

  const row = (label, value) => [h('dt', {}, label), h('dd', {}, value)];
  const modal = openModal({
    title: `Запись № ${booking.id}`, width: 540,
    body: [
      h('div', {}, badge(booking.status)),
      h('dl', { class: 'kv' },
        row('Клиент', booking.clientName), row('Телефон', telLink(booking.clientPhone)),
        row('Услуга', booking.serviceName), row('Мастер', booking.masterName),
        row('Когда', dateTime(booking)), row('Стоимость', money(booking.price, currency)),
        row('Источник', SOURCE[booking.source] ?? booking.source),
        row('Telegram', booking.telegram ? 'подключён — получает напоминания' : 'не подключён'),
        h('dt', {}, 'Напоминания'), remindersEl),
      notes, h('div', {}, saveNotes),
    ],
    footer: actions,
  });
  return modal;
}

/** Форма записи по телефону/в студии. */
export async function openNewBooking({ date, onCreated, masters, services }) {
  const state = { time: null, slots: [] };
  const activeServices = services.filter((s) => s.active);

  const service = h('select', {}, activeServices.map((s) => h('option', { value: s.id }, `${s.name} — ${s.durationMin} мин`)));
  const master = h('select', {});
  const day = h('input', { type: 'date', value: date, required: true });
  const pills = h('div', { class: 'slot-pills' });
  const name = h('input', { maxlength: '60', placeholder: 'Имя клиента', autocomplete: 'off' });
  const phone = h('input', { type: 'tel', placeholder: '+998 (90) 123-45-67', autocomplete: 'off' });
  const notes = h('input', { maxlength: '500', placeholder: 'Комментарий (необязательно)' });
  const error = h('p', { class: 'form-err', role: 'alert' });
  phone.addEventListener('input', () => { phone.value = formatPhoneInput(phone.value); });

  const fillMasters = () => {
    const id = Number(service.value);
    const options = masters.filter((m) => m.active && m.serviceIds.includes(id));
    master.replaceChildren(h('option', { value: '' }, 'Любой свободный'), ...options.map((m) => h('option', { value: m.id }, m.name)));
  };

  async function loadSlots() {
    state.time = null;
    pills.replaceChildren(h('span', { class: 'faint' }, 'Загружаем…'));
    try {
      const data = await api.get('/api/admin/slots', { serviceId: service.value, masterId: master.value, date: day.value });
      state.slots = data.slots;
      pills.replaceChildren(...(data.slots.length === 0
        ? [h('span', { class: 'faint' }, 'Нет свободного времени — выберите другой день или мастера')]
        : data.slots.map((s) => h('button', {
          type: 'button', 'aria-pressed': 'false',
          onclick: (event) => {
            state.time = s.time;
            for (const b of pills.children) b.setAttribute('aria-pressed', String(b === event.currentTarget));
          },
        }, s.time))));
    } catch (err) {
      pills.replaceChildren(h('span', { class: 'form-err' }, err.message));
    }
  }

  async function create() {
    error.textContent = '';
    if (!state.time) { error.textContent = 'Выберите время'; return; }
    try {
      await api.post('/api/admin/bookings', {
        serviceId: Number(service.value), masterId: master.value ? Number(master.value) : null,
        date: day.value, time: state.time, name: name.value, phone: phone.value, notes: notes.value,
      });
      toast('Запись создана');
      modal.close();
      onCreated();
    } catch (err) {
      if (err.status === 401) { handleError(err); return; }
      error.textContent = err.message;
      if (err.code === 'slot_unavailable') loadSlots();
    }
  }

  service.addEventListener('change', () => { fillMasters(); loadSlots(); });
  master.addEventListener('change', loadSlots);
  day.addEventListener('change', loadSlots);
  fillMasters();

  const modal = openModal({
    title: 'Новая запись', width: 600,
    body: [
      field('Услуга', service),
      h('div', { class: 'form-row' }, field('Мастер', master), field('Дата', day)),
      h('div', {}, h('p', { class: 'muted', style: { fontSize: '13px', marginBottom: '8px' } }, 'Свободное время'), pills),
      h('div', { class: 'form-row' }, field('Клиент', name), field('Телефон', phone)),
      field('Комментарий', notes), error,
    ],
    footer: [
      h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Отмена'),
      h('button', { class: 'btn btn--primary', type: 'button', onclick: create }, 'Создать запись'),
    ],
  });
  loadSlots();
}
