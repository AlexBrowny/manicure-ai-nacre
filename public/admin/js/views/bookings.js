// Список записей с фильтрами: период, мастер, статус, поиск по имени/телефону.
import { api } from '/js/api.js';
import { h } from '/js/dom.js';
import { money } from '/js/format.js';
import { openBookingModal, openNewBooking } from '../bookingModal.js';
import { SOURCE, STATUS, badge, dateShort, field, formatPhone, handleError, isoAdd } from '../ui.js';

export async function render({ root, session, setActions }) {
  const [masters, services] = await Promise.all([api.get('/api/admin/masters'), api.get('/api/admin/services')]);

  const from = h('input', { type: 'date', value: session.today });
  const to = h('input', { type: 'date', value: isoAdd(session.today, 13) });
  const master = h('select', {}, h('option', { value: '' }, 'Все мастера'), masters.map((m) => h('option', { value: m.id }, m.name)));
  const status = h('select', {}, h('option', { value: '' }, 'Любой статус'), Object.entries(STATUS).map(([v, l]) => h('option', { value: v }, l)));
  const search = h('input', { type: 'search', placeholder: 'Имя или телефон', autocomplete: 'off' });
  const summary = h('p', { class: 'muted', style: { margin: '0 0 12px' }, 'aria-live': 'polite' });
  const table = h('div', { class: 'table-wrap' });

  setActions(h('button', {
    class: 'btn btn--primary', type: 'button',
    onclick: () => openNewBooking({ date: session.today, services, masters, onCreated: load }),
  }, '+ Новая запись'));

  root.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'filters' },
      field('С', from), field('По', to), field('Мастер', master), field('Статус', status),
      field('Поиск', search, { class: 'field-label grow' })),
    summary, table));

  const open = (booking) => openBookingModal(booking, { currency: session.currency, onChanged: load });

  function paint(list) {
    const live = list.filter((b) => b.status !== 'cancelled');
    summary.textContent = `Найдено: ${list.length}${live.length !== list.length ? ` · активных: ${live.length}` : ''} · на сумму ${money(live.filter((b) => b.status !== 'no_show').reduce((s, b) => s + b.price, 0), session.currency)}`;
    if (list.length === 0) {
      table.replaceChildren(h('p', { class: 'empty-state' }, 'Записей не найдено. Измените фильтры.'));
      return;
    }
    table.replaceChildren(h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Дата', 'Клиент', 'Услуга', 'Мастер', 'Источник', 'Статус', 'Сумма'].map((t, i) => h('th', { class: i === 6 ? 'num' : '' }, t)))),
      h('tbody', {}, list.map((b) => h('tr', {
        class: `is-click${b.status === 'cancelled' ? ' is-cancelled' : ''}`, tabindex: '0',
        onclick: () => open(b), onkeydown: (e) => { if (e.key === 'Enter') open(b); },
      },
      h('td', {}, h('b', {}, dateShort(b.date)), h('span', { class: 'sub' }, `${b.start}–${b.end}`)),
      h('td', {}, b.clientName, h('span', { class: 'sub' }, formatPhone(b.clientPhone))),
      h('td', {}, b.serviceName),
      h('td', {}, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }, h('span', { class: 'dot', style: { '--c': b.masterColor } }), b.masterName)),
      h('td', {}, SOURCE[b.source], b.telegram && h('span', { class: 'sub' }, 'Telegram подключён')),
      h('td', {}, badge(b.status)),
      h('td', { class: 'num' }, money(b.price, session.currency)))))));
  }

  async function load() {
    try {
      paint(await api.get('/api/admin/bookings', {
        from: from.value, to: to.value, masterId: master.value, status: status.value, q: search.value.trim(),
      }));
    } catch (err) {
      handleError(err);
    }
  }

  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  for (const el of [from, to, master, status]) el.addEventListener('change', load);
  await load();
  return () => clearTimeout(timer);
}
