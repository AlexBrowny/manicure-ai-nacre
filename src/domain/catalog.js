// Услуги и мастера: чтение и CRUD. Время в расписании — минуты от полуночи.
import { tx } from '../db.js';
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

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[key]) ?? [];
    list.push(row);
    map.set(row[key], list);
  }
  return map;
}

function assembleMasters(db, masterRows) {
  const services = groupBy(db.prepare('SELECT master_id, service_id FROM master_services').all(), 'master_id');
  const schedule = groupBy(db.prepare('SELECT * FROM master_schedule ORDER BY weekday').all(), 'master_id');
  const daysOff = groupBy(db.prepare('SELECT * FROM master_days_off ORDER BY date_from').all(), 'master_id');
  return masterRows.map((m) => ({
    id: m.id,
    name: m.name,
    title: m.title,
    bio: m.bio,
    color: m.color,
    photoUrl: m.photo_url,
    active: Boolean(m.active),
    sort: m.sort,
    serviceIds: (services.get(m.id) ?? []).map((r) => r.service_id),
    schedule: (schedule.get(m.id) ?? []).map((r) => ({
      weekday: r.weekday,
      startMin: r.start_min,
      endMin: r.end_min,
      breakStartMin: r.break_start_min,
      breakEndMin: r.break_end_min,
    })),
    daysOff: (daysOff.get(m.id) ?? []).map((r) => ({ id: r.id, from: r.date_from, to: r.date_to, note: r.note })),
  }));
}

/** @param {Ctx} ctx */
export function listMasters({ db }, { activeOnly = false, serviceId = null } = {}) {
  const rows = db.prepare(`SELECT * FROM masters ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort, id`).all();
  const masters = assembleMasters(db, rows);
  return serviceId == null ? masters : masters.filter((m) => m.serviceIds.includes(serviceId));
}

/** @param {Ctx} ctx */
export function getMaster({ db }, id) {
  const row = db.prepare('SELECT * FROM masters WHERE id = ?').get(id);
  if (!row) throw notFound('Мастер');
  return assembleMasters(db, [row])[0];
}

function replaceChildren(db, masterId, data) {
  db.prepare('DELETE FROM master_services WHERE master_id = ?').run(masterId);
  const link = db.prepare('INSERT INTO master_services (master_id, service_id) VALUES (?, ?)');
  for (const serviceId of new Set(data.serviceIds)) link.run(masterId, serviceId);

  db.prepare('DELETE FROM master_schedule WHERE master_id = ?').run(masterId);
  const day = db.prepare(
    `INSERT INTO master_schedule (master_id, weekday, start_min, end_min, break_start_min, break_end_min)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const s of data.schedule) {
    day.run(masterId, s.weekday, s.startMin, s.endMin, s.breakStartMin ?? null, s.breakEndMin ?? null);
  }

  db.prepare('DELETE FROM master_days_off WHERE master_id = ?').run(masterId);
  const off = db.prepare('INSERT INTO master_days_off (master_id, date_from, date_to, note) VALUES (?, ?, ?, ?)');
  for (const d of data.daysOff) off.run(masterId, d.from, d.to, d.note ?? '');
}

/** @param {Ctx} ctx */
export function createMaster({ db }, data) {
  const id = tx(db, () => {
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM masters').get().next;
    const { lastInsertRowid } = db
      .prepare('INSERT INTO masters (name, title, bio, color, photo_url, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(data.name, data.title, data.bio, data.color, data.photoUrl, data.active ? 1 : 0, sort);
    replaceChildren(db, Number(lastInsertRowid), data);
    return Number(lastInsertRowid);
  });
  return getMaster({ db }, id);
}

/** @param {Ctx} ctx */
export function updateMaster({ db }, id, data) {
  getMaster({ db }, id);
  tx(db, () => {
    db.prepare(
      'UPDATE masters SET name = ?, title = ?, bio = ?, color = ?, photo_url = ?, active = ? WHERE id = ?',
    ).run(data.name, data.title, data.bio, data.color, data.photoUrl, data.active ? 1 : 0, id);
    replaceChildren(db, id, data);
  });
  return getMaster({ db }, id);
}

/** @param {Ctx} ctx */
export function deleteMaster({ db }, id) {
  getMaster({ db }, id);
  const used = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE master_id = ?').get(id).n;
  if (used > 0) {
    throw conflict('У мастера есть записи. Отключите мастера вместо удаления.', 'master_in_use');
  }
  db.prepare('DELETE FROM masters WHERE id = ?').run(id);
}
