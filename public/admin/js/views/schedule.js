// Расписание: колонки мастеров по времени, записи — блоки, перерывы и выходные заштрихованы.
import { api } from '/js/api.js';
import { h } from '/js/dom.js';
import { openBookingModal, openNewBooking } from '../bookingModal.js';
import { dateLong } from '/js/format.js';
import { handleError, hhmm, isoAdd, nowMinutes } from '../ui.js';

const HOUR_PX = 64;
const DEFAULT_RANGE = [9 * 60, 21 * 60];

function axisRange(masters) {
  const points = [];
  for (const m of masters) {
    if (m.shift) points.push(m.shift.startMin, m.shift.endMin);
    for (const b of m.bookings) points.push(b.startMin, b.endMin);
  }
  if (points.length === 0) return DEFAULT_RANGE;
  return [Math.floor(Math.min(...points) / 60) * 60, Math.ceil(Math.max(...points) / 60) * 60];
}

const px = (minutes, start) => ((minutes - start) / 60) * HOUR_PX;

function offBlock(top, bottom, extra = '') {
  return h('div', { class: `tl__off ${extra}`, style: { top: `${top}px`, height: `${Math.max(0, bottom - top)}px` } });
}

function column(master, [start, end], { onOpen, nowLine }) {
  const body = h('div', { class: 'tl__body' });
  if (!master.shift) {
    body.append(h('div', { class: 'tl__dayoff' }, 'Выходной'));
  } else {
    const { startMin, endMin, breakStartMin, breakEndMin } = master.shift;
    body.append(offBlock(0, px(startMin, start)), offBlock(px(endMin, start), px(end, start)));
    if (breakStartMin != null) body.append(offBlock(px(breakStartMin, start), px(breakEndMin, start), 'tl__off--break'));
  }
  for (const b of master.bookings) {
    body.append(h('button', {
      class: `bk is-${b.status}${b.endMin - b.startMin <= 30 ? ' is-short' : ''}`, type: 'button',
      style: { top: `${px(b.startMin, start) + 1}px`, height: `${px(b.endMin, start) - px(b.startMin, start) - 2}px`, '--c': master.color },
      title: `${b.start}–${b.end} · ${b.clientName} · ${b.serviceName}`,
      onclick: () => onOpen(b),
    }, h('b', {}, `${b.start} ${b.clientName}`), h('span', {}, b.serviceName)));
  }
  if (nowLine !== null && nowLine >= start && nowLine <= end) body.append(h('div', { class: 'tl__now', style: { top: `${px(nowLine, start)}px` } }));

  const count = master.bookings.length;
  const sub = master.shift ? `${hhmm(master.shift.startMin)}–${hhmm(master.shift.endMin)} · записей: ${count}` : `выходной${count ? ` · записей: ${count}` : ''}`;
  return h('div', { class: 'tl__col' },
    h('div', { class: 'tl__head' }, h('span', { class: 'dot', style: { '--c': master.color } }), h('div', {}, h('b', {}, master.name), h('small', {}, sub))),
    body);
}

export async function render({ root, session, setActions }) {
  let date = session.today;
  let data = null;
  let services = [];
  let masters = [];

  const label = h('div', { class: 'tl-date', 'aria-live': 'polite' });
  const picker = h('input', { type: 'date', value: date, style: { width: '160px' }, 'aria-label': 'Выбрать дату', onchange: (e) => go(e.target.value) });
  const go = (iso) => { if (!iso) return; date = iso; picker.value = iso; load(); };
  setActions(
    h('button', { class: 'btn btn--primary', type: 'button', onclick: () => openNewBooking({ date, services, masters, onCreated: load }) }, '+ Новая запись'));

  const bar = h('div', { class: 'tl-bar' },
    h('button', { class: 'btn', type: 'button', 'aria-label': 'Предыдущий день', onclick: () => go(isoAdd(date, -1)) }, '‹'),
    label,
    h('button', { class: 'btn', type: 'button', 'aria-label': 'Следующий день', onclick: () => go(isoAdd(date, 1)) }, '›'),
    h('button', { class: 'btn', type: 'button', onclick: () => go(session.today) }, 'Сегодня'),
    picker);
  const board = h('div');
  root.replaceChildren(bar, board);

  function paint() {
    label.textContent = dateLong(date);
    const list = data.masters;
    if (list.length === 0) {
      board.replaceChildren(h('div', { class: 'card empty-state' }, 'Нет мастеров. Добавьте их в разделе «Мастера».'));
      return;
    }
    const range = axisRange(list);
    const hours = (range[1] - range[0]) / 60;
    const axis = h('div', { class: 'tl__axis' }, Array.from({ length: hours + 1 }, (_, i) =>
      h('span', { style: { top: `${i * HOUR_PX}px` } }, hhmm(range[0] + i * 60))));
    const nowLine = date === session.today ? nowMinutes(session.timeZone) : null;
    const open = (booking) => openBookingModal(booking, { currency: session.currency, timeZone: session.timeZone, onChanged: load });
    board.replaceChildren(h('div', { class: 'tl', style: { '--n': list.length, '--h': `${hours * HOUR_PX}px`, '--hour': `${HOUR_PX}px` } },
      axis, ...list.map((m) => column(m, range, { onOpen: open, nowLine }))));
  }

  async function load() {
    try {
      data = await api.get('/api/admin/schedule', { date });
      paint();
    } catch (err) {
      handleError(err);
    }
  }

  [services, masters] = await Promise.all([api.get('/api/admin/services'), api.get('/api/admin/masters')]);
  await load();
  const timer = setInterval(() => { if (date === session.today && data) paint(); }, 60_000);
  return () => clearInterval(timer);
}
