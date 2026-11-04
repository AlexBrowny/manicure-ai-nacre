// Услуги: чтение и CRUD.
import { conflict, notFound } from '../errors.js';

/** @typedef {{ db: object, cfg: object, now: () => Date }} Ctx */

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
export async function listServices({ db }, { activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE active' : '';
  return (await db.all(`SELECT * FROM services ${where} ORDER BY sort, id`)).map(serviceFromRow);
}

/** @param {Ctx} ctx */
export async function getService({ db }, id) {
  const row = await db.get('SELECT * FROM services WHERE id = ?', [id]);
  if (!row) throw notFound('Услуга');
  return serviceFromRow(row);
}

/** @param {Ctx} ctx */
export async function createService({ db }, data) {
  const row = await db.get(
    `INSERT INTO services (name, category, description, duration_min, price, active, sort)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM services)) RETURNING *`,
    [data.name, data.category, data.description, data.durationMin, data.price, Boolean(data.active)],
  );
  return serviceFromRow(row);
}

/** @param {Ctx} ctx */
export async function updateService({ db }, id, data) {
  const row = await db.get(
    `UPDATE services SET name = ?, category = ?, description = ?, duration_min = ?, price = ?, active = ?
     WHERE id = ? RETURNING *`,
    [data.name, data.category, data.description, data.durationMin, data.price, Boolean(data.active), id],
  );
  if (!row) throw notFound('Услуга');
  return serviceFromRow(row);
}

/** @param {Ctx} ctx */
export async function deleteService({ db }, id) {
  await getService({ db }, id);
  const { n } = await db.get('SELECT COUNT(*)::int AS n FROM bookings WHERE service_id = ?', [id]);
  if (n > 0) {
    throw conflict('У услуги есть записи. Скройте её вместо удаления.', 'service_in_use');
  }
  await db.run('DELETE FROM services WHERE id = ?', [id]);
}
