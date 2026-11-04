// Услуги: чтение и CRUD.
import { conflict, notFound } from '../errors.js';

/** @typedef {{ db: import('node:sqlite').DatabaseSync, cfg: object, now: () => Date }} Ctx */

const serviceFromRow = (r) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  description: r.description,
  durationMin: r.duration_min,
  price: r.price,
  active: Boolean(r.active),
  sort: r.sort,
});

/** @param {Ctx} ctx */
export function listServices({ db }, { activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE active = 1' : '';
  return db.prepare(`SELECT * FROM services ${where} ORDER BY sort, id`).all().map(serviceFromRow);
}

/** @param {Ctx} ctx */
export function getService({ db }, id) {
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!row) throw notFound('Услуга');
  return serviceFromRow(row);
}

/** @param {Ctx} ctx */
export function createService({ db }, data) {
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM services').get().next;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO services (name, category, description, duration_min, price, active, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(data.name, data.category, data.description, data.durationMin, data.price, data.active ? 1 : 0, sort);
  return getService({ db }, Number(lastInsertRowid));
}

/** @param {Ctx} ctx */
export function updateService({ db }, id, data) {
  getService({ db }, id);
  db.prepare(
    `UPDATE services SET name = ?, category = ?, description = ?, duration_min = ?, price = ?, active = ?
     WHERE id = ?`,
  ).run(data.name, data.category, data.description, data.durationMin, data.price, data.active ? 1 : 0, id);
  return getService({ db }, id);
}

/** @param {Ctx} ctx */
export function deleteService({ db }, id) {
  getService({ db }, id);
  const used = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE service_id = ?').get(id).n;
  if (used > 0) {
    throw conflict('У услуги есть записи. Скройте её вместо удаления.', 'service_in_use');
  }
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
}
