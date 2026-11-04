// Мастера: карточки с нагрузкой недели, редактор расписания (дни, часы, перерыв), выходные и услуги.
import { api } from '/js/api.js';
import { h, toast } from '/js/dom.js';
import { initials } from '/js/format.js';
import {
  WEEKDAYS, WEEKDAYS_FULL, confirmDialog, field, handleError, hoursText, isoAdd, openModal, startOfWeek,
} from '../ui.js';

const SWATCHES = ['#8E7CC3', '#F0A58C', '#C77DAE', '#6C8EBF', '#5DAE9A', '#D9A441', '#B5655F', '#7A6BAA'];
const DEFAULT_HOURS = { start: '10:00', end: '19:00', breakStart: '14:00', breakEnd: '15:00' };

function blankMaster(services) {
  return {
    name: '', title: '', bio: '', color: SWATCHES[0], photoUrl: '', active: true,
    serviceIds: services.filter((s) => s.active).map((s) => s.id),
    schedule: [0, 1, 2, 3, 4].map((weekday) => ({ weekday, ...DEFAULT_HOURS })),
    daysOff: [],
  };
}

function weekChips(master) {
  return h('div', { class: 'week', role: 'img', 'aria-label': 'Рабочие дни' }, WEEKDAYS.map((label, weekday) => {
    const day = master.schedule.find((s) => s.weekday === weekday);
    return h('span', { class: day ? 'on' : '', title: day ? `${WEEKDAYS_FULL[weekday]}: ${day.start}–${day.end}` : `${WEEKDAYS_FULL[weekday]}: выходной` },
      label, h('small', {}, day ? day.start : '—'));
  }));
}

function masterCard(master, load, { onEdit }) {
  return h('article', { class: 'card mcard', style: { opacity: master.active ? '1' : '0.65' } },
    h('div', { class: 'mcard__top' },
      h('div', { class: 'mcard__ava', style: { '--c': master.color } }, master.photoUrl ? h('img', { src: master.photoUrl, alt: '' }) : initials(master.name)),
      h('div', {}, h('p', { class: 'mcard__name' }, master.name), h('p', { class: 'mcard__title' }, master.title || 'Мастер'),
        !master.active && h('span', { class: 'badge badge--cancelled' }, 'Не принимает записи'))),
    weekChips(master),
    h('div', { class: 'mload__row' },
      h('div', { class: 'mload__head' }, h('span', { class: 'muted' }, 'Загрузка на этой неделе'), h('span', { class: 'mload__pct', style: { marginLeft: 'auto' } }, `${load?.loadPct ?? 0}%`)),
      h('div', { class: 'bar' }, h('i', { style: { '--w': `${load?.loadPct ?? 0}%`, '--c': master.color } })),
      h('div', { class: 'mload__meta' }, h('span', {}, `свободно: ${hoursText(load?.freeMin ?? 0)}`), h('span', {}, `записей: ${load?.bookings ?? 0}`), h('span', {}, `услуг: ${master.serviceIds.length}`))),
    h('div', { class: 'mcard__actions' }, h('button', { class: 'btn btn--sm', type: 'button', onclick: onEdit }, 'Изменить расписание и данные')));
}

// ---------- редактор ----------
function scheduleEditor(master) {
  const rows = WEEKDAYS_FULL.map((name, weekday) => {
    const day = master.schedule.find((s) => s.weekday === weekday);
    const hours = day ?? DEFAULT_HOURS;
    const time = (value) => h('input', { type: 'time', value: value ?? '', step: '900' });
    const refs = {
      on: h('input', { type: 'checkbox', checked: Boolean(day), 'aria-label': `${name}: рабочий день` }),
      start: time(hours.start), end: time(hours.end), breakStart: time(day?.breakStart ?? (day ? '' : DEFAULT_HOURS.breakStart)),
      breakEnd: time(day?.breakEnd ?? (day ? '' : DEFAULT_HOURS.breakEnd)),
    };
    const row = h('div', { class: 'sched__row' }, h('label', { class: 'day' }, refs.on, WEEKDAYS[weekday]), refs.start, refs.end, refs.breakStart, refs.breakEnd);
    const sync = () => {
      row.classList.toggle('is-off', !refs.on.checked);
      for (const key of ['start', 'end', 'breakStart', 'breakEnd']) refs[key].disabled = !refs.on.checked;
    };
    refs.on.addEventListener('change', sync);
    sync();
    return { weekday, refs, row };
  });

  const copyToAll = () => {
    const source = rows.find((r) => r.refs.on.checked);
    if (!source) return;
    for (const r of rows.filter((x) => x.refs.on.checked && x !== source)) {
      for (const key of ['start', 'end', 'breakStart', 'breakEnd']) r.refs[key].value = source.refs[key].value;
    }
    toast(`Время «${WEEKDAYS[source.weekday]}» применено ко всем рабочим дням`, { ms: 2800 });
  };

  const el = h('div', { class: 'sched' },
    h('div', { class: 'sched__head' }, h('span', {}, 'День'), h('span', {}, 'Начало'), h('span', {}, 'Конец'), h('span', {}, 'Перерыв с'), h('span', {}, 'до')),
    rows.map((r) => r.row),
    h('div', {}, h('button', { class: 'btn btn--sm', type: 'button', onclick: copyToAll }, 'Применить время первого дня ко всем рабочим')));

  const read = () => rows.filter((r) => r.refs.on.checked).map((r) => ({
    weekday: r.weekday, start: r.refs.start.value, end: r.refs.end.value,
    breakStart: r.refs.breakStart.value, breakEnd: r.refs.breakEnd.value,
  }));
  return { el, read };
}

function daysOffEditor(master) {
  const list = h('div', { class: 'offs' });
  const add = (value = { from: '', to: '', note: '' }) => {
    const row = h('div', { class: 'offs__row' },
      h('input', { type: 'date', value: value.from, 'aria-label': 'С' }),
      h('input', { type: 'date', value: value.to, 'aria-label': 'По' }),
      h('input', { value: value.note, placeholder: 'Отпуск, больничный…', maxlength: '100' }),
      h('button', { class: 'btn btn--sm', type: 'button', 'aria-label': 'Удалить', onclick: () => row.remove() }, '×'));
    list.append(row);
  };
  master.daysOff.forEach(add);
  const read = () => [...list.children].map((row) => {
    const [from, to, note] = row.querySelectorAll('input');
    return { from: from.value, to: to.value || from.value, note: note.value };
  }).filter((d) => d.from);
  return {
    el: h('div', {}, list, h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn btn--sm', type: 'button', onclick: () => add() }, '+ Добавить выходные / отпуск'))),
    read,
  };
}

function servicesPicker(master, services) {
  const boxes = [];
  const groups = Map.groupBy(services, (s) => s.category);
  const el = h('div', { class: 'checks' }, [...groups].flatMap(([category, items]) => [
    h('p', { class: 'cat' }, category),
    ...items.map((s) => {
      const box = h('input', { type: 'checkbox', checked: master.serviceIds.includes(s.id), value: s.id });
      boxes.push(box);
      return h('label', {}, box, s.name, !s.active && h('span', { class: 'faint' }, ' (скрыта)'));
    }),
  ]));
  const toggleAll = () => { const all = boxes.every((b) => b.checked); for (const b of boxes) b.checked = !all; };
  return { el, toggleAll, read: () => boxes.filter((b) => b.checked).map((b) => Number(b.value)) };
}

function openEditor({ master, services, onSaved }) {
  const data = master ?? blankMaster(services);
  const name = h('input', { value: data.name, maxlength: '60', placeholder: 'Например, Алина Ветрова' });
  const title = h('input', { value: data.title, maxlength: '80', placeholder: 'Специализация' });
  const bio = h('textarea', { maxlength: '400', placeholder: 'Пара слов о мастере — покажем на сайте' }, data.bio);
  const photo = h('input', { type: 'url', value: data.photoUrl, placeholder: 'https://… (необязательно)' });
  const active = h('input', { type: 'checkbox', checked: data.active });
  const color = h('input', { type: 'color', value: data.color });
  const swatches = h('div', { class: 'swatches' }, SWATCHES.map((c) => h('button', {
    type: 'button', style: { '--c': c }, 'aria-label': `Цвет ${c}`, 'aria-pressed': String(c.toLowerCase() === data.color.toLowerCase()),
    onclick: () => { color.value = c; for (const b of swatches.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.style.getPropertyValue('--c') === c)); },
  })), color);
  const sched = scheduleEditor(data);
  const offs = daysOffEditor(data);
  const picker = servicesPicker(data, services);
  const error = h('p', { class: 'form-err', role: 'alert' });

  async function save() {
    error.textContent = '';
    const body = {
      name: name.value.trim(), title: title.value.trim(), bio: bio.value.trim(), color: color.value, photoUrl: photo.value.trim(),
      active: active.checked, serviceIds: picker.read(), schedule: sched.read(), daysOff: offs.read(),
    };
    try {
      if (master) await api.put(`/api/admin/masters/${master.id}`, body);
      else await api.post('/api/admin/masters', body);
      toast(master ? 'Изменения сохранены' : 'Мастер добавлен');
      modal.close();
      onSaved();
    } catch (err) {
      if (err.status === 401) { handleError(err); return; }
      error.textContent = err.message;
    }
  }

  async function remove() {
    if (!(await confirmDialog(`Удалить мастера «${master.name}»? Это нельзя отменить.`, { confirmText: 'Удалить' }))) return;
    try {
      await api.delete(`/api/admin/masters/${master.id}`);
      toast('Мастер удалён');
      modal.close();
      onSaved();
    } catch (err) {
      error.textContent = err.code === 'master_in_use'
        ? 'У мастера есть записи, поэтому его нельзя удалить. Снимите галочку «Принимает записи» — мастер исчезнет с сайта, а история сохранится.'
        : err.message;
    }
  }

  const section = (title, ...content) => h('div', {}, h('p', { style: { fontWeight: '600', margin: '4px 0 10px' } }, title), ...content);
  const modal = openModal({
    title: master ? 'Мастер' : 'Новый мастер', width: 720,
    body: [
      h('div', { class: 'form-row' }, field('Имя', name), field('Специализация', title)),
      field('О мастере', bio),
      h('div', { class: 'form-row' }, field('Фото (ссылка)', photo), section('Цвет в календаре', swatches)),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, active, 'Принимает записи (виден на сайте и в боте)'),
      section('Рабочие дни и часы', sched.el),
      section('Выходные и отпуск', offs.el),
      section('Какие услуги выполняет', h('div', { style: { marginBottom: '8px' } }, h('button', { class: 'btn btn--sm', type: 'button', onclick: picker.toggleAll }, 'Выбрать все / снять')), picker.el),
      error,
    ],
    footer: [
      master && h('button', { class: 'btn btn--danger spacer', type: 'button', onclick: remove }, 'Удалить'),
      h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Отмена'),
      h('button', { class: 'btn btn--primary', type: 'button', onclick: save }, master ? 'Сохранить' : 'Добавить мастера'),
    ].filter(Boolean),
  });
}

export async function render({ root, session, setActions }) {
  const weekStart = startOfWeek(session.today);
  const grid = h('div', { class: 'mgrid' });
  root.replaceChildren(grid);

  async function load() {
    try {
      const [masters, services, stats] = await Promise.all([
        api.get('/api/admin/masters'),
        api.get('/api/admin/services'),
        api.get('/api/admin/dashboard', { from: weekStart, to: isoAdd(weekStart, 6) }),
      ]);
      setActions(h('button', { class: 'btn btn--primary', type: 'button', onclick: () => openEditor({ master: null, services, onSaved: load }) }, '+ Добавить мастера'));
      const loads = new Map(stats.masters.map((m) => [m.id, m]));
      grid.replaceChildren(...(masters.length === 0
        ? [h('div', { class: 'card empty-state' }, 'Мастеров пока нет. Нажмите «Добавить мастера».')]
        : masters.map((m) => masterCard(m, loads.get(m.id), { onEdit: () => openEditor({ master: m, services, onSaved: load }) }))));
    } catch (err) {
      handleError(err);
    }
  }
  await load();
}
