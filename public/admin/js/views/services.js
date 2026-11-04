// Услуги: название, категория, длительность (определяет сетку записи), цена, видимость.
import { api } from '/js/api.js';
import { h, toast } from '/js/dom.js';
import { duration, money } from '/js/format.js';
import { confirmDialog, field, handleError, openModal } from '../ui.js';

function openEditor({ service, categories, onSaved }) {
  const data = service ?? { name: '', category: categories[0] ?? 'Маникюр', description: '', durationMin: 60, price: 100000, active: true };
  const name = h('input', { value: data.name, maxlength: '80', placeholder: 'Например, Маникюр + гель-лак' });
  const category = h('input', { value: data.category, maxlength: '40', list: 'catList' });
  const description = h('input', { value: data.description, maxlength: '300', placeholder: 'Коротко, что входит' });
  const minutes = h('input', { type: 'number', min: '15', max: '480', step: '15', value: data.durationMin });
  const price = h('input', { type: 'number', min: '0', step: '1000', value: data.price });
  const active = h('input', { type: 'checkbox', checked: data.active });
  const error = h('p', { class: 'form-err', role: 'alert' });

  async function save() {
    error.textContent = '';
    const body = {
      name: name.value.trim(), category: category.value.trim(), description: description.value.trim(),
      durationMin: Number(minutes.value), price: Number(price.value), active: active.checked,
    };
    try {
      if (service) await api.put(`/api/admin/services/${service.id}`, body);
      else await api.post('/api/admin/services', body);
      toast(service ? 'Услуга сохранена' : 'Услуга добавлена');
      modal.close();
      onSaved();
    } catch (err) {
      if (err.status === 401) { handleError(err); return; }
      error.textContent = err.message;
    }
  }

  async function remove() {
    if (!(await confirmDialog(`Удалить услугу «${service.name}»?`, { confirmText: 'Удалить' }))) return;
    try {
      await api.delete(`/api/admin/services/${service.id}`);
      toast('Услуга удалена');
      modal.close();
      onSaved();
    } catch (err) {
      error.textContent = err.code === 'service_in_use'
        ? 'По этой услуге есть записи. Снимите галочку «Показывать на сайте» — услуга скроется, а история сохранится.'
        : err.message;
    }
  }

  const modal = openModal({
    title: service ? 'Услуга' : 'Новая услуга', width: 560,
    body: [
      field('Название', name),
      h('div', { class: 'form-row' }, field('Категория', category), field('Описание', description)),
      h('div', { class: 'form-row' },
        field('Длительность, минут', minutes),
        field('Цена', price)),
      h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Длительность определяет, сколько времени мастер будет занят. Лучше кратно 30 минутам — так запись ложится на сетку без «окон».'),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, active, 'Показывать на сайте и в боте'),
      h('datalist', { id: 'catList' }, categories.map((c) => h('option', { value: c }))),
      error,
    ],
    footer: [
      service && h('button', { class: 'btn btn--danger spacer', type: 'button', onclick: remove }, 'Удалить'),
      h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Отмена'),
      h('button', { class: 'btn btn--primary', type: 'button', onclick: save }, service ? 'Сохранить' : 'Добавить'),
    ].filter(Boolean),
  });
}

export async function render({ root, session, setActions }) {
  const host = h('div', { class: 'card table-wrap' });
  root.replaceChildren(host);

  async function load() {
    try {
      const services = await api.get('/api/admin/services');
      const categories = [...new Set(services.map((s) => s.category))];
      setActions(h('button', { class: 'btn btn--primary', type: 'button', onclick: () => openEditor({ service: null, categories, onSaved: load }) }, '+ Добавить услугу'));
      host.replaceChildren(services.length === 0 ? h('p', { class: 'empty-state' }, 'Услуг пока нет.')
        : h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, ['Услуга', 'Категория', 'Время', 'Цена', 'На сайте'].map((t, i) => h('th', { class: i === 3 ? 'num' : '' }, t)))),
          h('tbody', {}, services.map((s) => h('tr', {
            class: `is-click${s.active ? '' : ' is-cancelled'}`, tabindex: '0',
            onclick: () => openEditor({ service: s, categories, onSaved: load }),
            onkeydown: (e) => { if (e.key === 'Enter') openEditor({ service: s, categories, onSaved: load }); },
          },
          h('td', {}, h('b', {}, s.name), s.description && h('span', { class: 'sub' }, s.description)),
          h('td', {}, s.category), h('td', {}, duration(s.durationMin)),
          h('td', { class: 'num' }, money(s.price, session.currency)),
          h('td', {}, s.active ? h('span', { class: 'badge badge--completed' }, 'Показывается') : h('span', { class: 'badge badge--cancelled' }, 'Скрыта')))))));
    } catch (err) {
      handleError(err);
    }
  }
  await load();
}
