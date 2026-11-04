import { randomBytes } from 'node:crypto';

function int(env, key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Переменная ${key} должна быть целым числом от ${min} до ${max}, получено "${raw}"`);
  }
  return n;
}

function list(env, key) {
  return (env[key] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(env = process.env) {
  const warnings = [];

  let adminPassword = env.ADMIN_PASSWORD;
  let generatedAdminPassword = false;
  if (!adminPassword) {
    adminPassword = randomBytes(9).toString('base64url');
    generatedAdminPassword = true;
    warnings.push('ADMIN_PASSWORD не задан — для этого запуска создан временный пароль администратора.');
  }

  let sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString('hex');
    warnings.push('SESSION_SECRET не задан — после перезапуска админ-сессии сбросятся.');
  }

  const adminChatIds = list(env, 'ADMIN_CHAT_IDS');
  for (const id of adminChatIds) {
    if (!/^-?\d+$/.test(id)) throw new Error(`ADMIN_CHAT_IDS: "${id}" не похоже на chat id`);
  }

  return {
    port: int(env, 'PORT', 3000, { min: 1, max: 65535 }),
    dbPath: env.DB_PATH || 'data/studio.db',
    timeZone: env.STUDIO_TZ || 'Asia/Tashkent',
    currency: env.CURRENCY || 'сум',
    slotStepMin: int(env, 'SLOT_STEP_MIN', 30, { min: 5, max: 120 }),
    leadMin: int(env, 'BOOKING_LEAD_MIN', 60, { min: 0, max: 7 * 24 * 60 }),
    horizonDays: int(env, 'BOOKING_HORIZON_DAYS', 60, { min: 1, max: 365 }),
    cancelMinHours: int(env, 'CANCEL_MIN_HOURS', 3, { min: 0, max: 72 }),
    studio: {
      name: env.STUDIO_NAME || 'Nacré',
      tagline: env.STUDIO_TAGLINE || 'Nail Atelier',
      address: env.STUDIO_ADDRESS || 'г. Ташкент, ул. Примерная, 12',
      phone: env.STUDIO_PHONE || '+998 90 000-00-00',
      hours: env.STUDIO_HOURS || 'Ежедневно, 10:00 – 21:00',
      instagram: env.STUDIO_INSTAGRAM || '',
    },
    admin: {
      password: adminPassword,
      generatedPassword: generatedAdminPassword,
      sessionSecret,
      sessionHours: int(env, 'ADMIN_SESSION_HOURS', 12, { min: 1, max: 24 * 30 }),
      cookieSecure: env.COOKIE_SECURE === '1',
    },
    telegram: {
      token: env.TELEGRAM_BOT_TOKEN || '',
      botUsername: (env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
      adminChatIds,
    },
    trustProxy: env.TRUST_PROXY === '1',
    warnings,
  };
}
