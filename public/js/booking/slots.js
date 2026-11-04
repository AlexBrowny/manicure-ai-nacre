// Шаг 3 (вторая половина): свободное время выбранного дня, сгруппированное по частям дня.
import { h } from '../dom.js';
import { dateLong, dateShort } from '../format.js';

const GROUPS = [['Утро', (t) => t < '12:00'], ['День', (t) => t >= '12:00' && t < '17:00'], ['Вечер', (t) => t >= '17:00']];

function slotGroups(slots, selected, onSelectTime) {
  let index = 0; // сквозной индекс — для каскадной анимации появления
  return GROUPS
    .map(([label, test]) => [label, slots.filter((s) => test(s.time))])
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => h('div', { class: 'slots__group' },
      h('p', { class: 'slots__label' }, label),
      h('div', { class: 'slots__row' }, list.map((s) => h('button', {
        class: 'slot', type: 'button', 'aria-pressed': String(selected === s.time), style: { '--i': String(index++) },
        onclick: () => onSelectTime(s.time),
      }, s.time)))));
}

/**
 * @param {HTMLElement} host
 * @param {{ state: object, next: { date: string, time: string } | null, loading?: boolean,
 *           onPickNext: () => void, onSelectTime: (time: string) => void }} props
 */
export function renderSlots(host, { state, next, loading = false, onPickNext, onSelectTime }) {
  if (loading) {
    host.replaceChildren(h('div', { class: 'skeleton', style: { height: '120px' } }));
    return;
  }
  const pickNextButton = next && h('button', { class: 'link-btn', type: 'button', onclick: onPickNext },
    `Ближайшее время: ${dateShort(next.date)}, ${next.time}`);
  if (!state.service) {
    host.replaceChildren(h('p', { class: 'step-hint' }, 'Выберите услугу — покажем свободные дни и время.'));
  } else if (!state.date) {
    host.replaceChildren(h('p', { class: 'step-hint' }, 'Выберите день в календаре — свободные дни подсвечены.'), pickNextButton);
  } else if (state.slots.length === 0) {
    host.replaceChildren(h('div', { class: 'empty' }, 'На этот день свободного времени нет. Выберите другой день.', pickNextButton));
  } else {
    host.replaceChildren(
      h('div', { class: 'slots__title' }, h('span', {}, dateLong(state.date)), h('small', {}, `${state.slots.length} св.`)),
      ...slotGroups(state.slots, state.time, onSelectTime));
  }
}

/** Отметить выбранное время без перерисовки (чтобы не перезапускать анимацию). */
export function markSelectedTime(host, time) {
  for (const btn of host.querySelectorAll('.slot')) btn.setAttribute('aria-pressed', String(btn.textContent === time));
}
