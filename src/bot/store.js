// Черновики записи и профили клиентов Telegram (в базе — переживают перезапуск).
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

export async function getDraft(db, chatId, now = Date.now()) {
  const row = await db.get('SELECT data, updated_at FROM tg_drafts WHERE chat_id = ?', [chatId]);
  if (!row) return null;
  const updated = new Date(row.updated_at).getTime();
  if (Number.isFinite(updated) && now - updated > DRAFT_TTL_MS) return null;
  return JSON.parse(row.data);
}

export async function saveDraft(db, chatId, draft) {
  await db.run(
    `INSERT INTO tg_drafts (chat_id, data, updated_at) VALUES (?, ?, now())
     ON CONFLICT (chat_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [chatId, JSON.stringify(draft)],
  );
  return draft;
}

export async function clearDraft(db, chatId) {
  await db.run('DELETE FROM tg_drafts WHERE chat_id = ?', [chatId]);
}

export async function getProfile(db, chatId) {
  const row = await db.get('SELECT name, phone FROM tg_profiles WHERE chat_id = ?', [chatId]);
  return row ? { name: row.name, phone: row.phone } : { name: '', phone: '' };
}

export async function saveProfile(db, chatId, { name, phone }) {
  await db.run(
    `INSERT INTO tg_profiles (chat_id, name, phone) VALUES (?, ?, ?)
     ON CONFLICT (chat_id) DO UPDATE SET name = excluded.name, phone = excluded.phone`,
    [chatId, name, phone],
  );
}
