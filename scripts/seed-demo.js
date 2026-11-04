// npm run demo        — добавить демо-записи (для знакомства с админкой)
// npm run demo:clear  — удалить только демо-записи
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { clearDemo, seedDefaults, seedDemo } from '../src/seed.js';

const cfg = loadConfig();
const db = await openDb({ url: cfg.databaseUrl, migrationUrl: cfg.databaseUrlDirect });
const ctx = { db, cfg, now: () => new Date() };
const log = (msg) => process.stdout.write(`${msg}
`);

try {
  if (process.argv.includes('--clear')) {
    log(`Удалено демо-записей: ${await clearDemo(ctx)}`);
  } else {
    await seedDefaults(ctx);
    await clearDemo(ctx);
    log(`Создано демо-записей: ${await seedDemo(ctx)}`);
  }
} finally {
  await db.close();
}
