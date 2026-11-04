// Мини-приложение Telegram: тот же календарь записи, что на сайте, но клиент уже опознан ботом.
import { ApiError, api } from '/js/api.js';
import { initBooking } from '/js/booking.js';
import { $, $$, h } from '/js/dom.js';
import { celebrate } from './celebrate.js';

const tg = window.Telegram?.WebApp;

/** Запрос к /api/miniapp с подписанными данными Telegram (сервер проверяет их подпись). */
async function miniApi(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: { 'X-Telegram-Init-Data': tg?.initData ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => { throw new ApiError('Нет связи с сервером. Проверьте интернет.', 'network', 0); });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success) throw new ApiError(json?.error ?? 'Что-то пошло не так', json?.code ?? 'error', response.status);
  return json.data;
}

function applyTelegramLook() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor('#3b2f5c');
    tg.setBackgroundColor('#fbf7f4');
  } catch { /* старые клиенты Telegram */ }
}

function showProblem(text) {
  $('#bookingApp').replaceChildren(h('div', { class: 'panel mini-problem' }, h('p', {}, text)));
}

/** Экран успеха: анимация, карточка записи и кнопка Telegram «Готово». */
function renderDone(root, config) {
  return ({ booking, reminders }, { again }) => {
    tg?.HapticFeedback?.notificationOccurred('success');
    root.replaceChildren(celebrate({ booking, config, reminders, onAgain: again }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tg?.MainButton) {
      tg.MainButton.setText('Готово');
      tg.MainButton.show();
      tg.MainButton.onClick(() => tg.close());
    }
  };
}

async function start() {
  applyTelegramLook();
  if (!tg?.initData) {
    showProblem('Откройте запись из нашего Telegram-бота — кнопка «Записаться» в меню чата.');
    return;
  }
  try {
    const [config, services, me] = await Promise.all([
      api.get('/api/public/config'),
      api.get('/api/public/services'),
      miniApi('/api/miniapp/me'),
    ]);
    for (const el of $$('[data-studio-name]')) el.textContent = config.studio.name;
    const root = $('#bookingApp');
    initBooking({
      root, config, services, prefill: me,
      submitBooking: (payload) => miniApi('/api/miniapp/bookings', { method: 'POST', body: payload }),
      renderDone: renderDone(root, config),
    });
  } catch (err) {
    showProblem(err.message);
  }
}

start();
