// Виджет онлайн-записи: услуга → мастер → дата → время → контакты.
// Здесь — состояние и действия; разметка шагов — в ./booking/*.
import { api, ApiError } from './api.js';
import { createCalendar } from './calendar.js';
import { h, toast } from './dom.js';
import { addMonths, toISO } from './format.js';
import { doneView } from './booking/done.js';
import { renderChips, renderMasters, renderServices } from './booking/pickers.js';
import { markSelectedTime, renderSlots } from './booking/slots.js';
import { createState, emptyMonth, nextSlotFor } from './booking/state.js';
import { buildSummary, readContacts, renderSummary, setSubmitting } from './booking/summary.js';

const MOBILE = window.matchMedia('(max-width: 760px)');
const reveal = (el) => { if (MOBILE.matches) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

const step = (number, title, ...content) =>
  h('section', { class: 'step', 'data-step': number },
    h('div', { class: 'step-head' }, h('span', { class: 'step-num' }, String(number)), h('span', {}, title)),
    ...content);

/**
 * @param {{ root: HTMLElement, config: object, services: object[] }} deps
 */
export function initBooking({ root, config, services }) {
  const { currency, today } = config;
  const minMonth = today.slice(0, 7);
  const maxMonth = toISO(new Date(new Date(`${today}T00:00:00`).getTime() + config.horizonDays * 86400000)).slice(0, 7);

  let state;
  let ui;
  const seq = { month: 0, slots: 0 }; // защита от устаревших ответов API

  // ---------- каркас ----------
  function build() {
    state = createState({ minMonth, preferMasterId: state?.preferMasterId ?? null });
    const calendar = createCalendar({ onSelect: selectDate, onNavigate: changeMonth });
    calendar.configure({ today, minMonth, maxMonth });
    ui = {
      calendar,
      chips: h('div', { class: 'chips', role: 'group', 'aria-label': 'Категории услуг' }),
      svcList: h('div', { class: 'svc-list', role: 'radiogroup', 'aria-label': 'Услуга' }),
      masterList: h('div', { class: 'master-list', role: 'radiogroup', 'aria-label': 'Мастер' }),
      slotsHost: h('div', { class: 'slots', 'aria-live': 'polite' }),
      summary: buildSummary({ onSubmit: submit }),
    };
    ui.step2 = step(2, 'Мастер', ui.masterList);
    ui.step3 = step(3, 'Дата и время', calendar.el, ui.slotsHost);
    root.replaceChildren(
      h('div', { class: 'panel' }, step(1, 'Услуга', ui.chips, ui.svcList), ui.step2),
      h('div', { class: 'panel' }, ui.step3),
      ui.summary.el,
    );
    paintCatalog();
    paintChoice();
    calendar.show(minMonth, emptyMonth(minMonth));
  }

  // ---------- отрисовка ----------
  function paintCatalog() {
    renderChips(ui.chips, { services, category: state.category, onPick: pickCategory });
    renderServices(ui.svcList, {
      services, category: state.category, selectedId: state.service?.id, currency, onSelect: selectService,
    });
  }

  /** Мастера, время и итог зависят от выбора — перерисовываем их вместе. */
  function paintChoice({ slotsLoading = false } = {}) {
    ui.step2.classList.toggle('is-locked', !state.service);
    ui.step2.classList.toggle('is-done', Boolean(state.service));
    ui.step3.classList.toggle('is-locked', !state.service);
    renderMasters(ui.masterList, { service: state.service, masters: state.masters, masterId: state.masterId, today, onSelect: selectMaster });
    renderSlots(ui.slotsHost, { state, next: nextSlotFor(state), loading: slotsLoading, onPickNext: pickNext, onSelectTime: selectTime });
    renderSummary(ui.summary, state, currency);
  }

  // ---------- действия ----------
  function pickCategory(category) {
    state.category = category;
    paintCatalog();
  }

  async function selectService(service) {
    Object.assign(state, { service, masterId: null, date: null, time: null, slots: [], masters: [] });
    paintCatalog();
    paintChoice();
    reveal(ui.step2);
    try {
      const masters = await api.get('/api/public/masters', { serviceId: service.id });
      if (state.service?.id !== service.id) return;
      state.masters = masters;
      if (state.preferMasterId && masters.some((m) => m.id === state.preferMasterId)) state.masterId = state.preferMasterId;
      paintChoice();
      await loadMonth(nextSlotFor(state)?.date.slice(0, 7) ?? minMonth, 0);
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  async function selectMaster(id) {
    Object.assign(state, { masterId: id, date: null, time: null, slots: [] });
    paintChoice();
    reveal(ui.step3);
    await loadMonth(nextSlotFor(state)?.date.slice(0, 7) ?? state.month, 0);
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
    const id = ++seq.slots;
    paintChoice({ slotsLoading: true });
    try {
      const data = await api.get('/api/public/slots', { serviceId: state.service.id, masterId: state.masterId ?? undefined, date });
      if (id !== seq.slots) return;
      state.slots = data.slots;
    } catch (err) {
      if (id !== seq.slots) return;
      toast(err.message, { error: true });
    }
    paintChoice();
    if (MOBILE.matches) ui.slotsHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function selectTime(time) {
    state.time = time;
    markSelectedTime(ui.slotsHost, time);
    renderSummary(ui.summary, state, currency);
    const { form } = ui.summary;
    if (MOBILE.matches) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else form.querySelector('input')?.focus({ preventScroll: true });
  }

  async function pickNext() {
    const next = nextSlotFor(state);
    if (!next) return;
    if (state.month !== next.date.slice(0, 7)) await loadMonth(next.date.slice(0, 7), 1);
    await selectDate(next.date);
    selectTime(next.time);
  }

  // ---------- отправка ----------
  async function submit(event) {
    event.preventDefault();
    if (state.submitting) return;
    const contacts = readContacts(ui.summary.form);
    if (!contacts || !state.time) return;

    state.submitting = true;
    setSubmitting(ui.summary, true);
    renderSummary(ui.summary, state, currency);
    try {
      const result = await api.post('/api/public/bookings', {
        serviceId: state.service.id, masterId: state.masterId, date: state.date, time: state.time, ...contacts,
      });
      showDone(result);
    } catch (err) {
      state.submitting = false;
      setSubmitting(ui.summary, false);
      renderSummary(ui.summary, state, currency);
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
    root.replaceChildren(doneView({ booking, telegramLink, config, onAgain: () => { build(); reveal(root); } }));
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- внешние события (кнопки в «Услугах» и «Мастерах») ----------
  document.addEventListener('book:service', (event) => {
    const service = services.find((s) => s.id === event.detail.serviceId);
    if (!service) return;
    if (!ui.svcList.isConnected) build();
    state.category = 'all';
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
