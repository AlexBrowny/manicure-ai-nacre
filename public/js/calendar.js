// Календарь месяца: дни со свободным временем подсвечены, интенсивность — по числу окон.
import { h, svg } from './dom.js';
import { addMonths, dateLong, monthTitle, plural, weekdayIndex } from './format.js';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const ARROW_LEFT = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>';
const ARROW_RIGHT = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg>';

const levelOf = (count) => (count >= 8 ? 3 : count >= 4 ? 2 : 1);

/**
 * @param {{ onSelect: (date: string) => void, onNavigate: (delta: number) => void }} handlers
 */
export function createCalendar({ onSelect, onNavigate }) {
  const state = { month: '', days: [], selected: null, today: '', minMonth: '', maxMonth: '', loading: false };

  const title = h('h4', { class: 'cal__title', 'aria-live': 'polite' });
  const prev = h('button', { class: 'cal__btn', type: 'button', 'aria-label': 'Предыдущий месяц', onclick: () => onNavigate(-1) }, svg(ARROW_LEFT));
  const next = h('button', { class: 'cal__btn', type: 'button', 'aria-label': 'Следующий месяц', onclick: () => onNavigate(1) }, svg(ARROW_RIGHT));
  const grid = h('div', { class: 'cal__grid', role: 'grid' });
  grid.addEventListener('keydown', onKeydown);

  const el = h('div', { class: 'cal' },
    h('div', { class: 'cal__head' }, title, h('div', { class: 'cal__nav' }, prev, next)),
    h('div', { class: 'cal__week', 'aria-hidden': 'true' }, WEEKDAYS.map((d) => h('span', {}, d))),
    h('div', { class: 'cal__body' }, grid),
    h('div', { class: 'cal__legend' },
      h('span', {}, h('i'), 'есть время'),
      h('span', {}, h('i', { class: 'today' }), 'сегодня')),
  );

  function onKeydown(event) {
    const keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    const enabled = [...grid.querySelectorAll('.day:not(:disabled)')];
    const index = enabled.indexOf(document.activeElement);
    if (index === -1 || !(event.key in keys)) return;
    event.preventDefault();
    enabled[Math.min(enabled.length - 1, Math.max(0, index + keys[event.key]))].focus();
  }

  function dayButton({ date, count }) {
    const isSelected = date === state.selected;
    const available = count > 0;
    const level = levelOf(count);
    return h('button', {
      class: ['day', available && 'has-slots', date === state.today && 'is-today', isSelected && 'is-selected'].filter(Boolean).join(' '),
      type: 'button',
      role: 'gridcell',
      disabled: !available,
      'aria-selected': isSelected ? 'true' : 'false',
      'aria-label': available ? `${dateLong(date)}, ${plural(count, ['свободное окно', 'свободных окна', 'свободных окон'])}` : `${dateLong(date)}, нет свободного времени`,
      onclick: () => onSelect(date),
    }, h('span', {}, String(Number(date.slice(8)))),
    available && h('span', { class: 'day__bars', 'aria-hidden': 'true' }, [1, 2, 3].map((n) => h('i', { class: n <= level ? 'on' : '' }))));
  }

  function render(animation = '') {
    title.textContent = monthTitle(state.month);
    prev.disabled = state.month <= state.minMonth;
    next.disabled = state.month >= state.maxMonth;
    grid.className = ['cal__grid', state.loading && 'is-loading', animation].filter(Boolean).join(' ');
    const first = `${state.month}-01`;
    const blanks = Array.from({ length: weekdayIndex(first) }, () => h('span', { class: 'day is-empty', 'aria-hidden': 'true' }));
    const days = state.days.length > 0
      ? state.days.map(dayButton)
      : Array.from({ length: 30 }, () => h('span', { class: 'day' }));
    grid.replaceChildren(...blanks, ...days);
  }

  return {
    el,
    configure({ today, minMonth, maxMonth }) { Object.assign(state, { today, minMonth, maxMonth }); },
    /** Показать месяц. direction: 1 — вперёд, -1 — назад, 0 — без анимации. */
    show(month, days, direction = 0) {
      Object.assign(state, { month, days, loading: false });
      render(direction > 0 ? 'is-enter-next' : direction < 0 ? 'is-enter-prev' : '');
    },
    /** Скелетон на время загрузки месяца. */
    loading(month) {
      Object.assign(state, { month: month ?? state.month, days: [], loading: true });
      render();
    },
    select(date) {
      state.selected = date;
      if (state.days.length > 0) render();
    },
    hasMonth: (month) => state.month === month,
    neighbor: (delta) => addMonths(state.month, delta),
  };
}
