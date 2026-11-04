// Стартовые данные (услуги и мастера, которые можно сразу править в админке) и демо-записи.
import { addDays, nowInTz } from './time.js';
import { daySlots } from './domain/availability.js';
import { createBooking, setStatus } from './domain/bookings.js';
import { createMaster, createService, listMasters, listServices } from './domain/catalog.js';

const SERVICES = [
  ['Маникюр', 'Классический маникюр', 'Обработка кутикулы и формы, уход за кожей рук', 60, 90000],
  ['Маникюр', 'Маникюр + гель-лак', 'Аккуратная форма и стойкое покрытие на 3–4 недели', 120, 160000],
  ['Маникюр', 'Укрепление + гель-лак', 'Базовое укрепление, выравнивание и покрытие', 120, 180000],
  ['Наращивание', 'Наращивание ногтей', 'Моделирование формы гелем или акригелем', 180, 280000],
  ['Наращивание', 'Коррекция наращивания', 'Восстановление длины и формы', 150, 220000],
  ['Педикюр', 'Педикюр классический', 'Комплексный уход за стопами', 90, 140000],
  ['Педикюр', 'Педикюр + гель-лак', 'Уход и покрытие на 4–5 недель', 120, 200000],
  ['Дизайн', 'Дизайн 1–2 ногтей', 'Втирка, стемпинг, рисунок', 30, 25000],
  ['Дизайн', 'Френч / лунный маникюр', 'Тонкая линия или лунка в выбранном цвете', 30, 30000],
  ['Дизайн', 'Снятие покрытия', 'Бережное снятие гель-лака или геля', 30, 30000],
  ['Комплекс', 'Маникюр + педикюр с покрытием', 'Полный уход за руками и ногами', 210, 330000],
];

const weekdays = (days, startMin, endMin, breakStartMin, breakEndMin) =>
  days.map((weekday) => ({ weekday, startMin, endMin, breakStartMin, breakEndMin }));

const MASTERS = [
  {
    name: 'Алина Ветрова', title: 'Топ-мастер, nail-художник', color: '#8E7CC3',
    bio: 'Работает с 2016 года. Любит чистые формы и аккуратный нюд.',
    serviceNames: ['Маникюр', 'Наращивание', 'Дизайн'],
    schedule: weekdays([0, 1, 2, 3, 4, 5], 600, 1140, 840, 900),
  },
  {
    name: 'Мария Лебедева', title: 'Мастер маникюра и дизайна', color: '#F0A58C',
    bio: 'Авторский дизайн, градиенты и объёмные текстуры.',
    serviceNames: ['Маникюр', 'Наращивание', 'Дизайн', 'Комплекс'],
    schedule: weekdays([1, 2, 3, 4, 5, 6], 660, 1200, 900, 960),
  },
  {
    name: 'Диана Каримова', title: 'Мастер педикюра', color: '#C77DAE',
    bio: 'Безопасный аппаратный педикюр и бережный уход за стопами.',
    serviceNames: ['Маникюр', 'Педикюр', 'Комплекс'],
    schedule: weekdays([0, 1, 2, 3, 4], 540, 1080, 780, 840),
  },
];

/** Заполняет пустую базу примерами. Ничего не делает, если данные уже есть. */
export async function seedDefaults(ctx) {
  if ((await listServices(ctx)).length > 0 || (await listMasters(ctx)).length > 0) return false;
  const created = [];
  for (const [category, name, description, durationMin, price] of SERVICES) {
    created.push(await createService(ctx, { name, category, description, durationMin, price, active: true }));
  }
  for (const m of MASTERS) {
    const serviceIds = created.filter((s) => m.serviceNames.includes(s.category)).map((s) => s.id);
    await createMaster(ctx, {
      name: m.name, title: m.title, bio: m.bio, color: m.color, photoUrl: '', active: true,
      serviceIds, schedule: m.schedule, daysOff: [],
    });
  }
  return true;
}

// ---- Демо-записи для знакомства с админ-панелью ----------------------------------------------

const DEMO_NOTE = 'demo';
const FIRST = ['Анна', 'Ольга', 'Мария', 'Елена', 'Ирина', 'Наталья', 'Дарья', 'Юлия', 'Алёна', 'Кристина', 'Вероника', 'Полина'];
const LAST = ['Смирнова', 'Попова', 'Волкова', 'Морозова', 'Новикова', 'Фёдорова', 'Орлова', 'Соколова', 'Захарова', 'Громова'];

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function clearDemo({ db }) {
  return (await db.all('DELETE FROM bookings WHERE notes = ? RETURNING id', [DEMO_NOTE])).length;
}

/** Создаёт реалистичную загрузку: две недели назад и неделя вперёд. Возвращает число записей. */
export async function seedDemo(ctx, { daysBack = 14, daysForward = 7, seed = 7 } = {}) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const today = nowInTz(ctx.cfg.timeZone, ctx.now()).date;
  const masters = await listMasters(ctx, { activeOnly: true });
  let created = 0;

  for (let offset = -daysBack; offset <= daysForward; offset += 1) {
    const date = addDays(today, offset);
    for (const master of masters) {
      const attempts = 2 + Math.floor(rand() * 5);
      for (let i = 0; i < attempts; i += 1) {
        const serviceId = pick(master.serviceIds);
        if (serviceId == null) continue;
        const slots = await daySlots(ctx, { serviceId, masterId: master.id, date, ignoreLead: true });
        if (slots.length === 0) continue;
        const phone = `+99890${String(1000000 + Math.floor(rand() * 40) * 1117).slice(0, 7)}`;
        try {
          const booking = await createBooking(ctx, {
            serviceId, masterId: master.id, date, startMin: pick(slots).start,
            name: `${pick(FIRST)} ${pick(LAST)}`, phone, notes: DEMO_NOTE,
            source: pick(['web', 'web', 'telegram', 'telegram', 'admin']), ignoreLead: true,
          });
          created += 1;
          if (offset < 0) {
            const roll = rand();
            const status = roll > 0.93 ? 'cancelled' : roll > 0.86 ? 'no_show' : 'completed';
            await setStatus(ctx, booking.id, status);
          }
        } catch (err) {
          if (err.code !== 'slot_unavailable' && err.code !== 'too_many_bookings') throw err;
        }
      }
    }
  }
  return created;
}
