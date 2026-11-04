// npm run demo        — добавить демо-записи (для знакомства с админкой)
// npm run demo:clear  — удалить только демо-записи
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { clearDemo, seedDefaults, seedDemo } from '../src/seed.js';

const cfg = loadConfig();
const ctx = { db: openDb(cfg.dbPath), cfg, now: () => new Date() };
const log = (msg) => process.stdout.write(`${msg}\n`);

if (process.argv.includes('--clear')) {
  log(`Удалено демо-записей: ${clearDemo(ctx)}`);
} else {
  seedDefaults(ctx);
  clearDemo(ctx);
  log(`Создано демо-записей: ${seedDemo(ctx)}`);
}
