// Виджет онлайн-записи: услуга → мастер → дата → время → контакты.
import { api, ApiError } from './api.js';
import { createCalendar } from './calendar.js';
import { h, svg, toast } from './dom.js';
import {
  addMonths, dateLong, dateShort, duration, formatPhoneInput, initials, isPhoneComplete, money, toISO,
} from './format.js';
import { downloadIcs } from './ics.js';

const MOBILE = window.matchMedia('(max-width: 760px)');
const reveal = (el) => { if (MOBILE.matches) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

const CHECK = '<svg class="done__check" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="42"/><path d="M26 43l11 11 21-23"/></svg>';

function endTime(time, minutes) {
  const [hh, mm] = time.split(':').map(Number);
  const total = hh * 60 + mm + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const emptyMonth = (month) => {
  const count = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  return Array.from({ length: count }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, '0')}`, count: 0 }));
};

/**
 * @param {{ root: HTMLElement, config: object, services: object[] }} deps
 */
export function initBooking({ root, config, services }) {
  const currency = config.currency;
  const today = config.today;
  const minMonth = today.slice(0, 7);
  const maxMonth = toISO(new Date(new Date(`${today}T00:00:00`).getTime() + config.horizonDays * 86400000)).slice(0, 7);

  let state;
  let ui;
  const seq = { month: 0, slots: 0 };

  const resetState = () => {
    state = {
      category: 'all', service: null, masterId: null, preferMasterId: state?.preferMasterId ?? null,
      masters: [], month: minMonth, date: null, slots: [], time: null, submitting: false,
    };
  };

  // ---------- сборка каркаса ----------
  function build() {
    resetState();
    const calendar = createCalendar({ onSelect: selectDate, onNavigate: changeMonth });
    calendar.configure({ today, minMonth, maxMonth });

    ui = {
      calendar,
      chips: h('div', { class: 'chips', role: 'group', 'aria-label': 'Категории услуг' }),
      svcList: h('div', { class: 'svc-list', role: 'radiogroup', 'aria-label': 'Услуга' }),
      masterList: h('div', { class: 'master-list', role: 'radiogroup', 'aria-label': 'Мастер' }),
      slotsHost: h('div', { class: 'slots', 'aria-live': 'polite' }),
      sum: Object.fromEntries(['service', 'master', 'date', 'time'].map((k) => [k, h('dd')])),
      total: h('strong'),
      form: null,
    };
    ui.step2 = step(2, 'Мастер', ui.masterList);
    ui.step3 = step(3, 'Дата и время', calendar.el, ui.slotsHost);

    root.replaceChildren(
      h('div', { class: 'panel' }, step(1, 'Услуга', ui.chips, ui.svcList), ui.step2),
      h('div', { class: 'panel' }, ui.step3),
      buildSummary(),
    );
    renderChips();
    renderServices();
    renderMasters();
    renderSlots();
    renderSummary();
    calendar.show(minMonth, emptyMonth(minMonth));
  }

  const step = (number, title, ...content) =>
    h('section', { class: 'step', 'data-step': number },
      h('div', { class: 'step-head' }, h('span', { class: 'step-num' }, String(number)), h('span', {}, title)),
      ...content);

  function buildSummary() {
    const field = (id, label, attrs) => h('div', { class: 'field' },
      h('label', { for: id }, label),
      h('input', { id, required: true, ...attrs }),
      h('div', { class: 'field__err', id: `${id}-err`, role: 'alert' }));

    const name = field('f-name', 'Ваше имя', { name: 'name', autocomplete: 'name', maxlength: '60', placeholder: 'Анна' });
    const phone = field('f-phone', 'Телефон', { name: 'phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: '24', placeholder: '+998 (90) 123-45-67' });
    phone.querySelector('input').addEventListener('input', (e) => { e.target.value = formatPhoneInput(e.target.value); });
    const honeypot = h('input', { class: 'hp', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    ui.submit = h('button', { class: 'submit', type: 'submit' }, 'Записаться');
    ui.form = h('form', { class: 'form', novalidate: true, onsubmit: submit },
      name, phone, honeypot, ui.submit,
      h('p', { class: 'legal' }, 'Нажимая «Записаться», вы соглашаетесь на обработку контактных данных для подтверждения записи.'));

    return h('aside', { class: 'panel panel--sum' },
      h('h3', { class: 'sum__title' }, 'Ваша запись'),
      h('dl', { class: 'sum__rows' },
        row('Услуга', ui.sum.service), row('Мастер', ui.sum.master), row('Дата', ui.sum.date), row('Время', ui.sum.time)),
      h('div', { class: 'sum__total' }, h('span', {}, 'Итого'), ui.total),
      ui.form);
  }

  const row = (label, dd) => h('div', {}, h('dt', {}, label), dd);

  // ---------- отрисовка ----------
  function renderChips() {
    const categories = [...new Set(services.map((s) => s.category))];
    const chip = (value, label) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(state.category === value),
      onclick: () => { state.category = value; renderChips(); renderServices(); },
    }, label);
    ui.chips.replaceChildren(chip('all', 'Все'), ...categories.map((c) => chip(c, c)));
  }

  function renderServices() {
    const list = services.filter((s) => state.category === 'all' || s.category === state.category);
    ui.svcList.replaceChildren(...list.map((s) => h('button', {
      class: 'svc', type: 'button', role: 'radio', 'aria-checked': String(state.service?.id === s.id),
      onclick: () => selectService(s),
    },
    h('span', { class: 'svc__name' }, s.name),
    h('span', { class: 'svc__meta' }, duration(s.durationMin), '·', h('b', {}, money(s.price, currency))))));
  }

  const nextLabel = (slot) => {
    if (!slot) return 'нет свободного времени';
    const tomorrow = toISO(new Date(new Date(`${today}T00:00:00`).getTime() + 86400000));
    const day = slot.date === today ? 'сегодня' : slot.date === tomorrow ? 'завтра' : dateShort(slot.date);
    return `ближайшее: ${day}, ${slot.time}`;
  };

  const earliest = (pool) => pool.map((m) => m.nextSlot).filter(Boolean)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0] ?? null;

  const nextSlotFor = () => earliest(state.masterId == null ? state.masters : state.masters.filter((m) => m.id === state.masterId));

  function masterButton({ id, name, photoUrl, color, next }) {
    const ava = h('span', { class: 'mpick__ava', style: color ? { '--mc': color } : {} },
      photoUrl ? h('img', { src: photoUrl, alt: '', loading: 'lazy' }) : (id == null ? svg('<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M12 2c.5 4.5 3.5 7.5 8 8-4.5.5-7.5 3.5-8 8-.5-4.5-3.5-7.5-8-8 4.5-.5 7.5-3.5 8-8z"/></svg>') : initials(name)));
    return h('button', {
      class: 'mpick', type: 'button', role: 'radio', 'aria-checked': String(state.masterId === id),
      onclick: () => selectMaster(id),
    }, ava, h('span', {}, h('span', { class: 'mpick__name', style: { display: 'block' } }, name), h('span', { class: 'mpick__next' }, next)));
  }

  function renderMasters() {
    ui.step2.classList.toggle('is-locked', !state.service);
    ui.step2.classList.toggle('is-done', Boolean(state.service));
    ui.step3.classList.toggle('is-locked', !state.service);
    if (!state.service) {
      ui.masterList.replaceChildren(h('p', { class: 'step-hint' }, 'Сначала выберите услугу'));
      return;
    }
    const any = masterButton({ id: null, name: 'Любой свободный мастер', next: nextLabel(earliest(state.masters)) });
    ui.masterList.replaceChildren(any, ...state.masters.map((m) => masterButton({ ...m, next: nextLabel(m.nextSlot) })));
  }

  function renderSummary() {
    const set = (dd, text) => { dd.textContent = text ?? '—'; dd.classList.toggle('is-empty', !text); };
    const service = state.service;
    const master = state.masterId == null ? null : state.masters.find((m) => m.id === state.masterId);
    set(ui.sum.service, service?.name);
    set(ui.sum.master, service ? (master?.name ?? 'Любой свободный') : null);
    set(ui.sum.date, state.date ? dateLong(state.date) : null);
    set(ui.sum.time, state.time && service ? `${state.time} – ${endTime(state.time, service.durationMin)}` : null);
    ui.total.textContent = service ? money(service.price, currency) : '—';
    ui.submit.disabled = !(service && state.date && state.time) || state.submitting;
  }

  function slotGroups() {
    const groups = [['Утро', (t) => t < '12:00'], ['День', (t) => t >= '12:00' && t < '17:00'], ['Вечер', (t) => t >= '17:00']];
    let index = 0;
    return groups
      .map(([label, test]) => [label, state.slots.filter((s) => test(s.time))])
      .filter(([, list]) => list.length > 0)
      .map(([label, list]) => h('div', { class: 'slots__group' },
        h('p', { class: 'slots__label' }, label),
        h('div', { class: 'slots__row' }, list.map((s) => h('button', {
          class: 'slot', type: 'button', 'aria-pressed': String(state.time === s.time), style: { '--i': String(index++) },
          onclick: () => selectTime(s.time),
        }, s.time)))));
  }

  function renderSlots({ loading = false } = {}) {
    if (loading) {
      ui.slotsHost.replaceChildren(h('div', { class: 'skeleton', style: { height: '120px' } }));
      return;
    }
    const next = nextSlotFor();
    const pickNextButton = next && h('button', { class: 'link-btn', type: 'button', onclick: pickNext },
      `Ближайшее время: ${dateShort(next.date)}, ${next.time}`);
    if (!state.service) {
      ui.slotsHost.replaceChildren(h('p', { class: 'step-hint' }, 'Выберите услугу — покажем свободные дни и время.'));
    } else if (!state.date) {
      ui.slotsHost.replaceChildren(h('p', { class: 'step-hint' }, 'Выберите день в календаре — свободные дни подсвечены.'), pickNextButton);
    } else if (state.slots.length === 0) {
      ui.slotsHost.replaceChildren(h('div', { class: 'empty' }, 'На этот день свободного времени нет. Выберите другой день.', pickNextButton));
    } else {
      ui.slotsHost.replaceChildren(
        h('div', { class: 'slots__title' }, h('span', {}, dateLong(state.date)), h('small', {}, `${state.slots.length} св.`)),
        ...slotGroups());
    }
  }

  // ---------- действия ----------
  async function selectService(service) {
    Object.assign(state, { service, masterId: null, date: null, time: null, slots: [], masters: [] });
    renderServices();
    renderMasters();
    renderSlots();
    renderSummary();
    reveal(ui.step2);
    try {
      const masters = await api.get('/api/public/masters', { serviceId: service.id });
      if (state.service?.id !== service.id) return;
      state.masters = masters;
      if (state.preferMasterId && masters.some((m) => m.id === state.preferMasterId)) state.masterId = state.preferMasterId;
      renderMasters();
      renderSlots();
      renderSummary();
      await loadMonth(nextSlotFor()?.date.slice(0, 7) ?? minMonth, 0);
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  async function selectMaster(id) {
    Object.assign(state, { masterId: id, date: null, time: null, slots: [] });
    renderMasters();
    renderSlots();
    renderSummary();
    reveal(ui.step3);
    await loadMonth(nextSlotFor()?.date.slice(0, 7) ?? state.month, 0);
  }

  async function loadMonth(month, direction) {
    const id = ++seq.month;
    state.month = month;
    ui.calendar.loading(month);
    try {
      const data = await api.get('/api/public/availability', { serviceId: state.service.id, masterId: state.masterId ?? undefined, month });
      if (id !== seq.month) return;
      ui.calendar.show(month, data.days, direction);
      ui.calendar.select(state.date);
    } catch (err) {
      if (id === seq.month) toast(err.message, { error: true });
    }
  }

  function changeMonth(delta) {
    const month = addMonths(state.month, delta);
    if (month < minMonth || month > maxMonth || !state.service) return;
    loadMonth(month, delta);
  }

  async function selectDate(date) {
    Object.assign(state, { date, time: null, slots: [] });
    ui.calendar.select(date);
    renderSummary();
    const id = ++seq.slots;
    renderSlots({ loading: true });
    try {
      const data = await api.get('/api/public/slots', { serviceId: state.service.id, masterId: state.masterId ?? undefined, date });
      if (id !== seq.slots) return;
      state.slots = data.slots;
    } catch (err) {
      if (id !== seq.slots) return;
      toast(err.message, { error: true });
    }
    renderSlots();
    if (MOBILE.matches) ui.slotsHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function selectTime(time) {
    state.time = time;
    for (const btn of ui.slotsHost.querySelectorAll('.slot')) btn.setAttribute('aria-pressed', String(btn.textContent === time));
    renderSummary();
    if (MOBILE.matches) ui.form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else ui.form.querySelector('input')?.focus({ preventScroll: true });
  }

  async function pickNext() {
    const next = nextSlotFor();
    if (!next) return;
    if (state.month !== next.date.slice(0, 7)) await loadMonth(next.date.slice(0, 7), 1);
    await selectDate(next.date);
    selectTime(next.time);
  }

  // ---------- отправка ----------
  function fieldError(id, message) {
    const input = ui.form.querySelector(`#${id}`);
    ui.form.querySelector(`#${id}-err`).textContent = message ?? '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    return !message;
  }

  async function submit(event) {
    event.preventDefault();
    if (state.submitting) return;
    const data = new FormData(ui.form);
    const name = String(data.get('name')).trim();
    const phone = String(data.get('phone')).trim();
    const nameOk = fieldError('f-name', name.length < 2 ? 'Введите имя' : null);
    const phoneOk = fieldError('f-phone', isPhoneComplete(phone) ? null : 'Введите номер телефона полностью');
    if (!nameOk || !phoneOk || !state.time) return;

    state.submitting = true;
    ui.submit.replaceChildren(h('span', { class: 'spin' }), 'Записываем…');
    renderSummary();
    try {
      const result = await api.post('/api/public/bookings', {
        serviceId: state.service.id, masterId: state.masterId, date: state.date, time: state.time,
        name, phone, website: String(data.get('website') ?? ''),
      });
      showDone(result);
    } catch (err) {
      state.submitting = false;
      ui.submit.textContent = 'Записаться';
      renderSummary();
      toast(err.message, { error: true, ms: 6000 });
      if (err instanceof ApiError && err.code === 'slot_unavailable') {
        state.time = null;
        await selectDate(state.date);
        loadMonth(state.month, 0);
      }
    }
  }

  function showDone({ booking, telegramLink }) {
    if (!booking) { build(); return; } // ловушка для ботов вернула пустой ответ
    const line = (label, value) => h('div', {}, h('span', {}, label), h('b', {}, value));
    const actions = [
      h('button', { class: 'btn btn-ics', type: 'button', onclick: () => downloadIcs(booking, config) }, 'Добавить в календарь'),
      telegramLink && h('a', { class: 'btn btn--primary', href: telegramLink, target: '_blank', rel: 'noopener' }, 'Напоминания в Telegram'),
      h('button', { class: 'btn', type: 'button', onclick: () => { build(); reveal(root); } }, 'Записаться ещё'),
    ];
    root.replaceChildren(h('div', { class: 'panel done' },
      svg(CHECK),
      h('h3', {}, `Вы записаны, ${booking.clientName.split(' ')[0]}!`),
      h('div', { class: 'done__card' },
        line('Услуга', booking.serviceName), line('Мастер', booking.masterName),
        line('Когда', `${dateLong(booking.date)}, ${booking.start}–${booking.end}`),
        line('Стоимость', money(booking.price, currency)), line('Адрес', config.studio.address)),
      h('div', { class: 'done__actions' }, actions),
      h('p', { class: 'done__note' }, telegramLink
        ? 'Нажмите «Напоминания в Telegram» — бот напомнит о визите за сутки и за 2 часа и позволит отменить запись.'
        : `Если планы изменятся, позвоните нам: ${config.studio.phone}`)));
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- внешние события (кнопки в «Услугах» и «Мастерах») ----------
  document.addEventListener('book:service', (event) => {
    const service = services.find((s) => s.id === event.detail.serviceId);
    if (!service) return;
    if (!ui.svcList.isConnected) build();
    state.category = 'all';
    renderChips();
    selectService(service);
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.addEventListener('book:master', (event) => {
    if (!ui.svcList.isConnected) build();
    state.preferMasterId = event.detail.masterId;
    if (state.service && state.masters.some((m) => m.id === state.preferMasterId)) selectMaster(state.preferMasterId);
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!state.service) toast('Выберите услугу — мастер уже отмечен', { ms: 3600 });
  });

  build();
}
