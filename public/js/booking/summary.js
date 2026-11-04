// Панель «Ваша запись»: итог выбора и форма контактов.
import { h } from '../dom.js';
import { dateLong, formatPhoneInput, isPhoneComplete, money } from '../format.js';
import { endTime, selectedMaster } from './state.js';

const SUBMIT_LABEL = 'Записаться';

function field(id, label, attrs) {
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('input', { id, required: true, ...attrs }),
    h('div', { class: 'field__err', id: `${id}-err`, role: 'alert' }));
}

const row = (label, dd) => h('div', {}, h('dt', {}, label), dd);

/** Собирает панель. Возвращает элементы, которые потом обновляет renderSummary. */
export function buildSummary({ onSubmit }) {
  const name = field('f-name', 'Ваше имя', { name: 'name', autocomplete: 'name', maxlength: '60', placeholder: 'Анна' });
  const phone = field('f-phone', 'Телефон', { name: 'phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: '24', placeholder: '+998 (90) 123-45-67' });
  phone.querySelector('input').addEventListener('input', (e) => { e.target.value = formatPhoneInput(e.target.value); });
  const honeypot = h('input', { class: 'hp', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
  const submit = h('button', { class: 'submit', type: 'submit' }, SUBMIT_LABEL);
  const form = h('form', { class: 'form', novalidate: true, onsubmit: onSubmit },
    name, phone, honeypot, submit,
    h('p', { class: 'legal' }, 'Нажимая «Записаться», вы соглашаетесь на обработку контактных данных для подтверждения записи.'));

  const sum = Object.fromEntries(['service', 'master', 'date', 'time'].map((k) => [k, h('dd')]));
  const total = h('strong');
  const el = h('aside', { class: 'panel panel--sum' },
    h('h3', { class: 'sum__title' }, 'Ваша запись'),
    h('dl', { class: 'sum__rows' },
      row('Услуга', sum.service), row('Мастер', sum.master), row('Дата', sum.date), row('Время', sum.time)),
    h('div', { class: 'sum__total' }, h('span', {}, 'Итого'), total),
    form);
  return { el, form, submit, sum, total };
}

export function renderSummary(parts, state, currency) {
  const set = (dd, text) => { dd.textContent = text ?? '—'; dd.classList.toggle('is-empty', !text); };
  const { service } = state;
  set(parts.sum.service, service?.name);
  set(parts.sum.master, service ? (selectedMaster(state)?.name ?? 'Любой свободный') : null);
  set(parts.sum.date, state.date ? dateLong(state.date) : null);
  set(parts.sum.time, state.time && service ? `${state.time} – ${endTime(state.time, service.durationMin)}` : null);
  parts.total.textContent = service ? money(service.price, currency) : '—';
  parts.submit.disabled = !(service && state.date && state.time) || state.submitting;
}

export function setSubmitting(parts, busy) {
  if (busy) parts.submit.replaceChildren(h('span', { class: 'spin' }), 'Записываем…');
  else parts.submit.textContent = SUBMIT_LABEL;
}

function fieldError(form, id, message) {
  form.querySelector(`#${id}-err`).textContent = message ?? '';
  form.querySelector(`#${id}`).setAttribute('aria-invalid', message ? 'true' : 'false');
  return !message;
}

/** Проверяет форму и показывает ошибки у полей. null — есть ошибки. */
export function readContacts(form) {
  const data = new FormData(form);
  const name = String(data.get('name')).trim();
  const phone = String(data.get('phone')).trim();
  const nameOk = fieldError(form, 'f-name', name.length < 2 ? 'Введите имя' : null);
  const phoneOk = fieldError(form, 'f-phone', isPhoneComplete(phone) ? null : 'Введите номер телефона полностью');
  if (!nameOk || !phoneOk) return null;
  return { name, phone, website: String(data.get('website') ?? '') };
}
