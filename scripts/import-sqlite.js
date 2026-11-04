// Однократный перенос данных из старой SQLite-базы (data/studio.db) в Lakebase Postgres на Neon.
// npm run import:sqlite [-- путь/к/studio.db] [--force]
// Без --force отказывается, если в Neon уже есть записи, чтобы не задвоить данные.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';

const TABLES = ['services', 'masters', 'master_services', 'master_schedule', 'master_days_off', 'bookings', 'tg_profiles'];
const IDENTITY = ['services', 'masters', 'master_days_off', 'bookings'];
const BOOLEAN = new Set(['active']);
const TIMESTAMP = new Set(['created_at', 'last_reminded_at']);

const args = process.argv.slice(2);
const force = args.includes('--force');
const file = args.find((a) => !a.startsWith('--')) ?? 'data/studio.db';
const log = (msg) => process.stdout.write(`${msg}\n`);

if (!existsSync(file)) {
  log(`Файл ${file} не найден — переносить нечего.`);
  process.exit(0);
}

/** SQLite хранит время как «YYYY-MM-DD HH:MM:SS» в UTC. */
const toTimestamp = (v) => (v == null || v === '' ? null : new Date(`${String(v).replace(' ', 'T')}Z`).toISOString());

function convert(column, value) {
  if (BOOLEAN.has(column)) return Boolean(value);
  if (TIMESTAMP.has(column)) return toTimestamp(value);
  return value;
}

const cfg = loadConfig();
const sqlite = new DatabaseSync(file, { readOnly: true });
const pg = await openDb({ url: cfg.databaseUrl, migrationUrl: cfg.databaseUrlDirect });

try {
  const existing = await pg.get('SELECT COUNT(*)::int AS n FROM bookings');
  if (existing.n > 0 && !force) {
    log(`В Neon уже ${existing.n} записей — перенос пропущен (добавьте --force, чтобы заменить данные).`);
    process.exit(0);
  }

  const copied = await pg.tx(async (db) => {
    await db.run(`TRUNCATE ${TABLES.join(', ')}, tg_drafts RESTART IDENTITY CASCADE`);
    const counts = {};
    for (const table of TABLES) {
      const pgColumns = new Set((await db.all(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', [table],
      )).map((r) => r.column_name));
      const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).filter((c) => pgColumns.has(c));
      const rows = sqlite.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all();
      const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
      for (const row of rows) await db.run(sql, columns.map((c) => convert(c, row[c])));
      counts[table] = rows.length;
    }
    // Явно вставленные id не двигают счётчики identity — выставляем их за максимумом.
    for (const table of IDENTITY) {
      await db.get(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`);
    }
    return counts;
  });

  for (const [table, n] of Object.entries(copied)) log(`${table}: ${n}`);
  log('Готово: данные перенесены в Neon.');
} finally {
  sqlite.close();
  await pg.close();
}
