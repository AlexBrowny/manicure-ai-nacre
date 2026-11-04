import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBot } from '../src/bot/index.js';
import { keyboardLabels, tapped } from './botHelpers.js';
import { listBookings } from '../src/domain/bookings.js';
import { seedDefaults } from '../src/seed.js';
import { makeCtx } from './helpers.js';

const ADMIN_CHAT = 9001;
const CLIENT = { id: 555, is_bot: false, first_name: 'Анна', last_name: 'Смирнова' };

let dctx; let events; let sent; let app; let nextMessageId;

const quiet = { error() {}, log() {} };

beforeEach(() => {
  dctx = makeCtx(); // Пн 2026-11-02 07:00 UTC
  dctx.cfg.telegram = { token: 'TEST:TOKEN', botUsername: 'nacre_bot', adminChatIds: [String(ADMIN_CHAT)] };
  dctx.cfg.studio = { name: 'Nacré', tagline: 'Nail Atelier', address: 'ул. Тестовая, 1', phone: '+998 90 000-00-00', hours: '10–21', instagram: '' };
  seedDefaults(dctx);
  events = new EventEmitter();
  sent = [];
  nextMessageId = 100;
  app = createBot({
    ctx: dctx, events, token: 'TEST:TOKEN', logger: quiet,
    botInfo: { id: 1, is_bot: true, first_name: 'Nacre', username: 'nacre_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false },
  });
  app.bot.api.config.use((prev, method, payload) => {
    sent.push({ method, payload });
    if (method === 'sendMessage' || method === 'editMessageText') {
      nextMessageId += 1;
      return Promise.resolve({ ok: true, result: { message_id: nextMessageId, date: 0, chat: { id: payload.chat_id ?? CLIENT.id, type: 'private' }, text: payload.text } });
    }
    return Promise.resolve({ ok: true, result: true });
  });
});

let updateId = 0;
const chat = { id: CLIENT.id, type: 'private' };

const sendText = (text, from = CLIENT) => app.bot.handleUpdate({
  update_id: ++updateId,
  message: {
    message_id: ++nextMessageId, date: 0, chat: { id: from.id, type: 'private' }, from, text,
    ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}),
  },
});

const sendContact = (phone, userId = CLIENT.id) => app.bot.handleUpdate({
  update_id: ++updateId,
  message: { message_id: ++nextMessageId, date: 0, chat, from: CLIENT, contact: { phone_number: phone, first_name: 'Анна', user_id: userId } },
});

const tap = (data, from = CLIENT) => app.bot.handleUpdate({
  update_id: ++updateId,
  callback_query: {
    id: String(updateId), from, chat_instance: 'x', data,
    message: { message_id: nextMessageId, date: 0, chat: { id: from.id, type: 'private' }, text: 'prev' },
  },
});

const lastMessage = () => [...sent].reverse().find((s) => s.method === 'sendMessage' || s.method === 'editMessageText');
const lastText = () => lastMessage().payload.text;
const lastKeyboard = () => lastMessage().payload.reply_markup;

/** Проходит сценарий до экрана подтверждения. */
async function walkToConfirm({ masterData = 'mst:0', serviceData = 's:1', day = 'day:2026-11-04', time } = {}) {
  await sendText('/start');
  await tap('book');
  await tap(serviceData);
  await tap(masterData);
  await tap(day);
  const slot = time ?? tapped(lastKeyboard(), /^t:\d{4}$/)[0];
  await tap(slot);
  await sendContact('+998 90 111-22-33');
}

test('/start shows the welcome menu', async () => {
  await sendText('/start');
  assert.match(lastText(), /Nacré/);
  assert.ok(keyboardLabels(lastKeyboard()).includes('💅 Записаться'));
});

test('/id works for anyone and returns the chat id', async () => {
  await sendText('/id');
  assert.match(lastText(), /<code>555<\/code>/);
});

test('services screen lists active services with prices', async () => {
  await sendText('/start');
  await tap('book');
  const labels = keyboardLabels(lastKeyboard());
  assert.ok(labels.some((l) => /Классический маникюр · 90\s000 сум/.test(l)));
});

test('master screen offers "any master" and shows the nearest free slot per master', async () => {
  await tap('book');
  await tap('s:1');
  const labels = keyboardLabels(lastKeyboard());
  assert.ok(labels[0].includes('Любой свободный мастер'));
  assert.ok(labels.some((l) => /Алина Ветрова · .*\d\d:\d\d/.test(l)));
});

test('calendar marks days without slots with a dot and offers only free days as buttons', async () => {
  await tap('s:1');
  await tap('mst:0');
  const days = tapped(lastKeyboard(), /^day:/);
  assert.ok(days.includes('day:2026-11-04'));
  assert.ok(!days.includes('day:2026-11-01'), 'прошедшие дни недоступны');
  assert.ok(keyboardLabels(lastKeyboard()).includes('Ноябрь 2026'));
  assert.ok(tapped(lastKeyboard(), /^cal:/).includes('cal:2026-12'), 'есть переход на следующий месяц');
  assert.ok(!tapped(lastKeyboard(), /^cal:/).includes('cal:2026-10'), 'в прошлый месяц назад нельзя');
});

test('full booking: contact shared, confirmed, stored, admin notified, profile remembered', async () => {
  await walkToConfirm();
  assert.match(lastText(), /Проверьте запись/);
  assert.match(lastText(), /\+998 90 111-22-33/);

  await tap('ok');
  assert.match(lastText(), /Вы записаны/);

  const [booking] = listBookings(dctx, {});
  assert.equal(booking.source, 'telegram');
  assert.equal(booking.tgChatId, CLIENT.id);
  assert.equal(booking.clientPhone, '+998901112233');
  assert.equal(booking.clientName, 'Анна Смирнова');

  await new Promise((r) => setImmediate(r));
  const adminMsg = sent.find((s) => s.method === 'sendMessage' && s.payload.chat_id === String(ADMIN_CHAT));
  assert.match(adminMsg.payload.text, /Новая запись/);
  assert.match(adminMsg.payload.text, /Telegram-бот/);

  // Второй визит: телефон уже известен, сразу экран подтверждения.
  await tap('book');
  await tap('s:1');
  await tap('mst:0');
  await tap('day:2026-11-05');
  await tap(tapped(lastKeyboard(), /^t:/)[0]);
  assert.match(lastText(), /Проверьте запись/);
});

test('a phone typed as text is validated before it is accepted', async () => {
  await sendText('/start');
  await tap('s:1');
  await tap('mst:0');
  await tap('day:2026-11-04');
  await tap(tapped(lastKeyboard(), /^t:/)[0]);
  await sendText('позвоните мне');
  assert.match(lastText(), /Укажите телефон/);
  await sendText('8 90 555 44 33');
  assert.match(lastText(), /\+998 90 555-44-33/);
});

test('a contact belonging to someone else is refused', async () => {
  await tap('s:1');
  await tap('mst:0');
  await tap('day:2026-11-04');
  await tap(tapped(lastKeyboard(), /^t:/)[0]);
  await sendContact('+998 90 000-00-01', 12345);
  assert.match(lastText(), /свой номер/);
});

test('the name can be edited on the confirmation screen and is HTML-escaped in messages', async () => {
  await walkToConfirm();
  await tap('edit:name');
  await sendText('<b>Мария</b> & Ко');
  assert.match(lastText(), /Проверьте запись/);
  assert.doesNotMatch(lastText(), /<b>Мария<\/b>/);
  assert.match(lastText(), /bМария\/b &amp; Ко/);
});

test('if the slot is taken between choosing and confirming the client is sent back to pick a time', async () => {
  await walkToConfirm({ masterData: 'mst:1' });
  const { startMin, date } = (await import('../src/bot/store.js')).getDraft(dctx.db, CLIENT.id);
  const { createBooking } = await import('../src/domain/bookings.js');
  createBooking(dctx, { serviceId: 1, masterId: 1, date, startMin, name: 'Другая клиентка', phone: '+79990001122', source: 'web' });
  await tap('ok');
  assert.match(lastText(), /только что заняли/);
  assert.equal(listBookings(dctx, {}).length, 1);
});

test('my bookings lists upcoming visits and the client can cancel them', async () => {
  await walkToConfirm();
  await tap('ok');
  await tap('my');
  assert.match(lastText(), /Ваши записи/);
  const cancelData = tapped(lastKeyboard(), /^cx:\d+$/)[0];
  await tap(cancelData);
  assert.match(lastText(), /Отменить запись/);
  await tap(cancelData.replace('cx:', 'cxy:'));
  assert.match(lastText(), /Запись отменена/);
  assert.equal(listBookings(dctx, {})[0].status, 'cancelled');

  await new Promise((r) => setImmediate(r));
  assert.ok(sent.some((s) => s.method === 'sendMessage' && /клиент/.test(s.payload.text) && /Запись отменена/.test(s.payload.text)));
});

test('a client cannot cancel someone else\'s booking', async () => {
  await walkToConfirm();
  await tap('ok');
  const other = { id: 777, is_bot: false, first_name: 'Чужой' };
  await tap('cx:1', other);
  assert.match(lastText(), /не найдена/);
  assert.equal(listBookings(dctx, {})[0].status, 'confirmed');
});

test('late cancellation is refused with the studio phone', async () => {
  await walkToConfirm();
  await tap('ok');
  const { date, startMin } = listBookings(dctx, {})[0];
  dctx.clock.current = new Date(`${date}T00:00:00Z`.replace('T00:00', `T${String(Math.floor(startMin / 60) - 1).padStart(2, '0')}:00`));
  await tap('cxy:1');
  assert.match(lastText(), /не позднее чем за 3 ч/);
  assert.equal(listBookings(dctx, {})[0].status, 'confirmed');
});

test('a website booking is linked through the /start deep link and then appears in "my bookings"', async () => {
  const { createBooking } = await import('../src/domain/bookings.js');
  const web = createBooking(dctx, { serviceId: 1, masterId: null, date: '2026-11-04', startMin: 600, name: 'Анна', phone: '+79001112233', source: 'web' });
  await sendText(`/start b_${web.linkToken}`);
  assert.match(lastText(), /привязана к Telegram/);
  await tap('my');
  assert.match(lastText(), /Ваши записи/);
  await sendText(`/start b_${web.linkToken}`, { id: 999, is_bot: false, first_name: 'Взломщик' });
  assert.doesNotMatch(lastText(), /привязана/, 'токен одноразовый');
});

test('reminders are delivered once to linked clients', async () => {
  await walkToConfirm();
  await tap('ok');
  const { date, startMin } = listBookings(dctx, {})[0];
  const [y, m, d] = date.split('-').map(Number);
  dctx.clock.current = new Date(Date.UTC(y, m - 1, d, Math.floor(startMin / 60) - 1, 0)); // за час
  sent.length = 0;
  assert.equal(await app.sendReminders(), 1);
  assert.match(sent[0].payload.text, /Ждём вас/);
  assert.equal(sent[0].payload.chat_id, CLIENT.id);
  assert.equal(await app.sendReminders(), 0);
});

test('admin cancellation of a Telegram booking notifies the client', async () => {
  await walkToConfirm();
  await tap('ok');
  const booking = listBookings(dctx, {})[0];
  sent.length = 0;
  events.emit('booking:status', { booking: { ...booking, status: 'cancelled' }, previous: 'confirmed', by: 'admin' });
  await new Promise((r) => setImmediate(r));
  const msg = sent.find((s) => s.method === 'sendMessage');
  assert.equal(msg.payload.chat_id, CLIENT.id);
  assert.match(msg.payload.text, /студия отменила/);
});

test('group chats are ignored except for /id', async () => {
  await app.bot.handleUpdate({
    update_id: ++updateId,
    message: { message_id: 1, date: 0, chat: { id: -100, type: 'group', title: 'g' }, from: CLIENT, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] },
  });
  assert.equal(sent.length, 0);
});

test('prices and contacts screens render', async () => {
  await tap('prices');
  assert.match(lastText(), /Услуги и цены/);
  assert.match(lastText(), /Педикюр/);
  await tap('info');
  assert.match(lastText(), /ул\. Тестовая, 1/);
});
