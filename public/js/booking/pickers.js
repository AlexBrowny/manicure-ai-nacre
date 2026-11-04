// Шаги 1–2: категории и список услуг, выбор мастера.
import { h, svg } from '../dom.js';
import { dateShort, duration, initials, money, toISO } from '../format.js';
import { earliest } from './state.js';

const ANY_MASTER_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M12 2c.5 4.5 3.5 7.5 8 8-4.5.5-7.5 3.5-8 8-.5-4.5-3.5-7.5-8-8 4.5-.5 7.5-3.5 8-8z"/></svg>';

export function renderChips(host, { services, category, onPick }) {
  const categories = [...new Set(services.map((s) => s.category))];
  const chip = (value, label) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(category === value), onclick: () => onPick(value),
  }, label);
  host.replaceChildren(chip('all', 'Все'), ...categories.map((c) => chip(c, c)));
}

export function renderServices(host, { services, category, selectedId, currency, onSelect }) {
  const list = services.filter((s) => category === 'all' || s.category === category);
  host.replaceChildren(...list.map((s) => h('button', {
    class: 'svc', type: 'button', role: 'radio', 'aria-checked': String(selectedId === s.id),
    onclick: () => onSelect(s),
  },
  h('span', { class: 'svc__name' }, s.name),
  h('span', { class: 'svc__meta' }, duration(s.durationMin), '·', h('b', {}, money(s.price, currency))))));
}

/** «ближайшее: сегодня, 15:00» / «завтра» / «ср, 4 нояб.» */
export function nextLabel(slot, today) {
  if (!slot) return 'нет свободного времени';
  const tomorrow = toISO(new Date(new Date(`${today}T00:00:00`).getTime() + 86400000));
  const day = slot.date === today ? 'сегодня' : slot.date === tomorrow ? 'завтра' : dateShort(slot.date);
  return `ближайшее: ${day}, ${slot.time}`;
}

function masterButton({ id, name, photoUrl, color, next, checked, onSelect }) {
  const face = photoUrl ? h('img', { src: photoUrl, alt: '', loading: 'lazy' }) : (id == null ? svg(ANY_MASTER_ICON) : initials(name));
  return h('button', {
    class: 'mpick', type: 'button', role: 'radio', 'aria-checked': String(checked), onclick: () => onSelect(id),
  },
  h('span', { class: 'mpick__ava', style: color ? { '--mc': color } : {} }, face),
  h('span', {}, h('span', { class: 'mpick__name', style: { display: 'block' } }, name), h('span', { class: 'mpick__next' }, next)));
}

export function renderMasters(host, { service, masters, masterId, today, onSelect }) {
  if (!service) {
    host.replaceChildren(h('p', { class: 'step-hint' }, 'Сначала выберите услугу'));
    return;
  }
  const any = masterButton({
    id: null, name: 'Любой свободный мастер', next: nextLabel(earliest(masters), today), checked: masterId === null, onSelect,
  });
  host.replaceChildren(any, ...masters.map((m) => masterButton({
    ...m, next: nextLabel(m.nextSlot, today), checked: masterId === m.id, onSelect,
  })));
}
