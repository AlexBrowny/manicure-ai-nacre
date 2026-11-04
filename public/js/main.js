import { api } from './api.js';
import { initBooking } from './booking.js';
import { startHeroVideo } from './hero-video.js';
import { $, $$, h } from './dom.js';
import { duration, initials, money } from './format.js';

const MIN_PRELOADER_MS = 1100; // чтобы прелоадер не мелькал, если видео готово мгновенно

function hidePreloader(hero) {
  hero.classList.remove('is-loading');
  hero.classList.add('is-ready');
  setTimeout(() => $('.preloader')?.remove(), 1200); // после плавного затухания
}

/** Запускает случайное видео с YouTube и убирает прелоадер, когда оно пошло (или стало ясно, что не пойдёт). */
async function setupHero() {
  const hero = $('.hero');
  if (!hero) return;
  const startedAt = performance.now();
  const playing = await startHeroVideo({ mount: $('#heroYt') }).catch(() => false);
  const rest = playing ? Math.max(0, MIN_PRELOADER_MS - (performance.now() - startedAt)) : 0;
  setTimeout(() => hidePreloader(hero), rest);
}

function fillStudio(config) {
  const { studio } = config;
  document.title = `${studio.name} — студия маникюра и педикюра`;
  for (const el of $$('[data-studio-name]')) el.textContent = studio.name;
  for (const el of $$('[data-studio-tagline]')) el.textContent = studio.tagline;
  for (const el of $$('[data-studio-address]')) el.textContent = studio.address;
  for (const el of $$('[data-studio-hours]')) el.textContent = studio.hours;
  for (const el of $$('[data-year]')) el.textContent = String(new Date().getFullYear());

  const tel = `tel:+${studio.phone.replace(/\D/g, '')}`;
  for (const el of $$('[data-phone]')) el.setAttribute('href', tel);
  for (const el of $$('[data-studio-phone]')) {
    el.textContent = studio.phone;
    el.setAttribute('href', tel);
  }

  for (const el of $$('[data-telegram]')) {
    if (config.botUsername) {
      el.setAttribute('href', `https://t.me/${config.botUsername}`);
    } else if (el.closest('.footer')) {
      el.parentElement.remove(); // без бота ссылка на Telegram не нужна
    } else {
      el.removeAttribute('target'); // запасной вариант — прокрутка к форме записи
    }
  }
}

function renderServices(services, currency) {
  const host = $('#servicesList');
  const byCategory = Map.groupBy(services, (s) => s.category);
  host.replaceChildren(...[...byCategory].map(([category, items]) =>
    h('article', { class: 'menu-cat' },
      h('h3', { class: 'menu-cat__title' }, category),
      h('ul', {}, items.map((s) => h('li', { class: 'menu-item' },
        h('div', {}, h('div', { class: 'menu-item__name' }, s.name), s.description && h('div', { class: 'menu-item__desc' }, s.description)),
        h('span', { class: 'menu-item__meta' }, duration(s.durationMin)),
        h('span', { class: 'menu-item__price' }, money(s.price, currency)),
        h('button', {
          class: 'menu-item__book', type: 'button',
          onclick: () => document.dispatchEvent(new CustomEvent('book:service', { detail: { serviceId: s.id } })),
        }, 'Записаться'))))),
  ));
}

function renderMasters(masters) {
  const host = $('#mastersList');
  host.replaceChildren(...masters.map((m) => h('article', { class: 'master-card' },
    h('div', { class: 'master-card__top', style: { '--mc': m.color } },
      h('div', { class: 'master-card__avatar' },
        m.photoUrl ? h('img', { src: m.photoUrl, alt: m.name, loading: 'lazy' }) : initials(m.name))),
    h('div', { class: 'master-card__body' },
      h('h3', { class: 'master-card__name' }, m.name),
      m.title && h('p', { class: 'master-card__title' }, m.title),
      m.bio && h('p', { class: 'master-card__bio' }, m.bio),
      h('button', {
        class: 'master-card__book', type: 'button',
        onclick: () => document.dispatchEvent(new CustomEvent('book:master', { detail: { masterId: m.id } })),
      }, `Записаться к мастеру →`)),
  )));
}

function showLoadError(message) {
  for (const id of ['servicesList', 'mastersList', 'bookingApp']) {
    $(`#${id}`).replaceChildren(h('p', { class: 'step-hint' }, message));
  }
}

async function boot() {
  setupHero();
  try {
    const [config, services, masters] = await Promise.all([
      api.get('/api/public/config'),
      api.get('/api/public/services'),
      api.get('/api/public/masters'),
    ]);
    fillStudio(config);
    renderServices(services, config.currency);
    renderMasters(masters);
    initBooking({ root: $('#bookingApp'), config, services });
  } catch (err) {
    showLoadError(`Не удалось загрузить данные: ${err.message}`);
  }
}

boot();
