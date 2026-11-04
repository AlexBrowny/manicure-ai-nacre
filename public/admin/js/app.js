// Вход, каркас и маршрутизация админ-панели (hash-роутер).
import { api } from '/js/api.js';
import { $, $$, h } from '/js/dom.js';

const ROUTES = {
  dashboard: { title: 'Обзор', load: () => import('./views/dashboard.js') },
  schedule: { title: 'Расписание', load: () => import('./views/schedule.js') },
  bookings: { title: 'Записи', load: () => import('./views/bookings.js') },
  masters: { title: 'Мастера', load: () => import('./views/masters.js') },
  services: { title: 'Услуги', load: () => import('./views/services.js') },
};

let session = null;
let cleanup = null;
let renderToken = 0;

async function showStudioName() {
  try {
    const { studio } = await api.get('/api/public/config');
    for (const el of $$('[data-studio-name]')) el.textContent = studio.name;
    document.title = `Админ-панель — ${studio.name}`;
  } catch { /* название необязательно */ }
}

function showLogin() {
  $('#shell').hidden = true;
  $('#login').hidden = false;
  $('#password').focus();
}

function showShell() {
  $('#login').hidden = true;
  $('#shell').hidden = false;
  route();
}

async function route() {
  const name = (window.location.hash.match(/^#\/(\w+)/) ?? [])[1];
  if (!ROUTES[name]) {
    window.location.hash = '#/dashboard';
    return;
  }
  const token = ++renderToken;
  const view = $('#view');
  const actions = $('#viewActions');
  cleanup?.();
  cleanup = null;
  actions.replaceChildren();
  $('#viewTitle').textContent = ROUTES[name].title;
  document.title = `${ROUTES[name].title} — Админ-панель`;
  for (const link of $$('#nav a')) link.classList.toggle('is-active', link.dataset.route === name);
  view.replaceChildren(h('div', { class: 'skeleton', style: { height: '240px' } }));

  try {
    const module = await ROUTES[name].load();
    if (token !== renderToken) return;
    view.replaceChildren();
    cleanup = (await module.render({ root: view, session, setActions: (...nodes) => actions.replaceChildren(...nodes) })) ?? null;
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    if (token !== renderToken) return;
    view.replaceChildren(h('div', { class: 'card empty-state' },
      h('p', {}, `Не удалось загрузить раздел: ${err.message}`),
      h('button', { class: 'btn', type: 'button', onclick: route }, 'Повторить')));
  }
}

async function login(event) {
  event.preventDefault();
  const error = $('#loginErr');
  error.textContent = '';
  try {
    await api.post('/api/admin/login', { password: $('#password').value });
    $('#password').value = '';
    session = await api.get('/api/admin/me');
    showShell();
  } catch (err) {
    error.textContent = err.message;
  }
}

async function logout() {
  await api.post('/api/admin/logout').catch(() => {});
  session = null;
  showLogin();
}

async function start() {
  showStudioName();
  $('#loginForm').addEventListener('submit', login);
  $('#logout').addEventListener('click', logout);
  window.addEventListener('hashchange', () => { if (session) route(); });
  try {
    session = await api.get('/api/admin/me');
    showShell();
  } catch (err) {
    if (err.status === 401) showLogin();
    else {
      $('#login').hidden = false;
      $('#loginErr').textContent = err.message;
    }
  }
}

start();
