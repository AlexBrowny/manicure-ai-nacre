// Обзор: загрузка студии и мастеров, динамика по дням, тепловая карта, источники и услуги.
import { api } from '/js/api.js';
import { h, svg } from '/js/dom.js';
import { money } from '/js/format.js';
import {
  WEEKDAYS, dateShort, endOfMonth, handleError, hoursText, isoAdd, startOfMonth, startOfWeek,
} from '../ui.js';

const RANGES = [
  ['today', 'Сегодня', (t) => [t, t]],
  ['week', 'Эта неделя', (t) => [startOfWeek(t), isoAdd(startOfWeek(t), 6)]],
  ['next7', 'Ближайшие 7 дней', (t) => [t, isoAdd(t, 6)]],
  ['month', 'Этот месяц', (t) => [startOfMonth(t), endOfMonth(t)]],
  ['last30', 'Последние 30 дней', (t) => [isoAdd(t, -29), t]],
];

const RING_LENGTH = 2 * Math.PI * 38;

function kpiRing(pct, bookedMin, capacityMin) {
  const dash = `${(pct / 100) * RING_LENGTH} ${RING_LENGTH}`;
  const ring = svg(`<svg class="ring" viewBox="0 0 88 88" aria-hidden="true">
    <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8e7cc3"/><stop offset="1" stop-color="#f4b8a2"/></linearGradient></defs>
    <circle class="track" cx="44" cy="44" r="38"/><circle class="value" cx="44" cy="44" r="38" stroke-dasharray="0 ${RING_LENGTH}"/></svg>`);
  requestAnimationFrame(() => requestAnimationFrame(() => ring.querySelector('.value').setAttribute('stroke-dasharray', dash)));
  return h('div', { class: 'card kpi kpi--ring' },
    h('div', { class: 'ring-label' }, ring, h('span', {}, `${pct}%`)),
    h('p', { class: 'kpi__label' }, 'Загрузка студии'),
    h('p', { class: 'kpi__value' }, hoursText(bookedMin)),
    h('p', { class: 'kpi__hint' }, `из ${hoursText(capacityMin)} рабочего времени`));
}

const kpi = (label, value, hint) => h('div', { class: 'card kpi' },
  h('p', { class: 'kpi__label' }, label), h('p', { class: 'kpi__value' }, value), h('p', { class: 'kpi__hint' }, hint));

function mastersCard(stats, currency) {
  const rows = stats.masters.map((m) => h('div', { class: 'mload__row' },
    h('div', { class: 'mload__head' },
      h('span', { class: 'dot', style: { '--c': m.color } }),
      h('span', { class: 'mload__name' }, m.name, !m.active && h('span', { class: 'faint' }, ' (отключён)')),
      h('span', { class: 'mload__pct' }, `${m.loadPct}%`)),
    h('div', { class: 'bar', role: 'img', 'aria-label': `Загрузка ${m.name}: ${m.loadPct}%` }, h('i', { style: { '--w': `${m.loadPct}%`, '--c': m.color } })),
    h('div', { class: 'mload__meta' },
      h('span', {}, `${hoursText(m.bookedMin)} из ${hoursText(m.capacityMin)}`),
      h('span', {}, `записей: ${m.bookings}`),
      h('span', {}, `свободно: ${hoursText(m.freeMin)}`),
      h('span', {}, money(m.revenue, currency)))));
  return h('section', { class: 'card' },
    h('h2', { class: 'card__title' }, 'Загрузка мастеров', h('small', {}, 'занято / рабочее время')),
    stats.masters.length ? h('div', { class: 'mload' }, rows) : h('p', { class: 'empty-state' }, 'Нет мастеров'));
}

function dailyCard(stats, today) {
  const many = stats.daily.length > 14;
  const cols = stats.daily.map((d) => h('div', {
    class: ['chart__col', d.date === today && 'is-today', d.capacityMin === 0 && 'is-off'].filter(Boolean).join(' '),
    style: { '--h': `${d.loadPct}%` },
  },
  h('div', { class: 'chart__tip' }, d.capacityMin === 0 ? `${dateShort(d.date)}: выходной` : `${dateShort(d.date)}: ${d.loadPct}% · записей ${d.bookings}`),
  h('div', { class: 'chart__bar' }),
  h('div', { class: 'chart__label' }, many ? String(Number(d.date.slice(8))) : [h('b', {}, String(Number(d.date.slice(8)))), WEEKDAYS[(new Date(`${d.date}T00:00:00Z`).getUTCDay() + 6) % 7]])));
  return h('section', { class: 'card' },
    h('h2', { class: 'card__title' }, 'Загрузка по дням', h('small', {}, '% рабочего времени')),
    h('div', { class: 'chart' }, cols));
}

function heatmapCard(stats) {
  const { cells } = stats.heatmap;
  const hours = [...Array(24).keys()].filter((hr) => cells.some((row) => row[hr] !== null));
  const [first, last] = hours.length ? [hours[0], hours[hours.length - 1]] : [10, 19];
  const range = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const body = cells.map((row, weekday) => h('div', { class: 'heat__row', style: { '--cols': range.length } },
    h('span', {}, WEEKDAYS[weekday]),
    range.map((hr) => {
      const value = row[hr];
      return h('div', {
        class: value === null ? 'heat__cell is-off' : 'heat__cell',
        style: value === null ? {} : { '--p': String(Math.round(value * 0.9)) },
        title: value === null ? `${WEEKDAYS[weekday]}, ${hr}:00 — не работают` : `${WEEKDAYS[weekday]}, ${hr}:00 — занято ${value}%`,
      });
    })));
  return h('section', { class: 'card' },
    h('h2', { class: 'card__title' }, 'Когда студия загружена', h('small', {}, 'день недели × час')),
    h('div', { class: 'heat' },
      h('div', { class: 'heat__row', style: { '--cols': range.length } }, h('span'), range.map((hr) => h('span', { class: 'hour' }, String(hr)))),
      body),
    h('div', { class: 'heat__legend' }, 'свободно', h('i'), 'занято'));
}

function sourcesCard(stats) {
  const entries = [['web', 'Сайт', '#8e7cc3'], ['telegram', 'Telegram', '#f4b8a2'], ['admin', 'Администратор', '#c77dae']];
  const total = entries.reduce((sum, [key]) => sum + stats.sources[key], 0);
  return h('section', { class: 'card' },
    h('h2', { class: 'card__title' }, 'Откуда записи'),
    total === 0 ? h('p', { class: 'empty-state' }, 'Нет записей за период') : [
      h('div', { class: 'split', role: 'img', 'aria-label': 'Источники записей' },
        entries.map(([key, , color]) => h('i', { style: { '--w': `${(stats.sources[key] / total) * 100}%`, '--c': color } }))),
      h('div', { class: 'legend' }, entries.map(([key, label, color]) => h('div', {},
        h('span', { class: 'dot', style: { '--c': color } }), label,
        h('b', {}, `${stats.sources[key]} · ${Math.round((stats.sources[key] / total) * 100)}%`)))),
    ]);
}

function servicesCard(stats, currency) {
  return h('section', { class: 'card' },
    h('h2', { class: 'card__title' }, 'Популярные услуги'),
    stats.topServices.length === 0 ? h('p', { class: 'empty-state' }, 'Нет записей за период')
      : h('ol', { class: 'rank' }, stats.topServices.map((s) => h('li', {},
        h('span', {}, s.name), h('b', {}, `${s.count} · ${money(s.revenue, currency)}`)))));
}

export async function render({ root, session, setActions }) {
  const today = session.today;
  let current = 'week';

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Период' });
  const paintSeg = () => seg.replaceChildren(...RANGES.map(([key, label]) => h('button', {
    type: 'button', 'aria-pressed': String(key === current),
    onclick: () => { current = key; paintSeg(); load(); },
  }, label)));
  setActions(seg);
  paintSeg();

  async function load() {
    const [, , bounds] = RANGES.find(([key]) => key === current);
    const [from, to] = bounds(today);
    try {
      const stats = await api.get('/api/admin/dashboard', { from, to });
      const { totals } = stats;
      root.replaceChildren(h('div', { class: 'stack' },
        h('div', { class: 'grid grid--kpi' },
          kpiRing(totals.loadPct, totals.bookedMin, totals.capacityMin),
          kpi('Записей', String(totals.bookings), `отмен: ${totals.cancelled} · не пришли: ${totals.noShow}`),
          kpi('Выручка', money(totals.revenue, session.currency), `выполнено: ${totals.completed}`),
          kpi('Клиентов', String(totals.clients), `${stats.period.days} ${stats.period.days === 1 ? 'день' : 'дн.'} · ${dateShort(from)}${from === to ? '' : ` — ${dateShort(to)}`}`)),
        h('div', { class: 'grid grid--2' }, mastersCard(stats, session.currency), dailyCard(stats, today)),
        heatmapCard(stats),
        h('div', { class: 'grid grid--equal' }, sourcesCard(stats), servicesCard(stats, session.currency))));
    } catch (err) {
      handleError(err);
    }
  }

  await load();
}
