// Черновики записи и профили клиентов Telegram (в SQLite — переживают перезапуск).
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

export function getDraft(db, chatId, now = Date.now()) {
  const row = db.prepare('SELECT data, updated_at FROM tg_drafts WHERE chat_id = ?').get(chatId);
  if (!row) return null;
  const updated = Date.parse(`${row.updated_at.replace(' ', 'T')}Z`);
  if (Number.isFinite(updated) && now - updated > DRAFT_TTL_MS) return null;
  return JSON.parse(row.data);
}

export function saveDraft(db, chatId, draft) {
  db.prepare(
    `INSERT INTO tg_drafts (chat_id, data, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT (chat_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(chatId, JSON.stringify(draft));
  return draft;
}

export function clearDraft(db, chatId) {
  db.prepare('DELETE FROM tg_drafts WHERE chat_id = ?').run(chatId);
}

export function getProfile(db, chatId) {
  return db.prepare('SELECT name, phone FROM tg_profiles WHERE chat_id = ?').get(chatId) ?? { name: '', phone: '' };
}

export function saveProfile(db, chatId, { name, phone }) {
  db.prepare(
    `INSERT INTO tg_profiles (chat_id, name, phone) VALUES (?, ?, ?)
     ON CONFLICT (chat_id) DO UPDATE SET name = excluded.name, phone = excluded.phone`,
  ).run(chatId, name, phone);
}
