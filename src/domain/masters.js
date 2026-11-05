// Мастера: чтение и CRUD вместе с расписанием, выходными и списком услуг. Время — минуты от полуночи.
import { conflict, notFound } from '../errors.js';

/** @typedef {{ db: object, cfg: object, now: () => Date }} Ctx */

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[key]) ?? [];
    list.push(row);
    map.set(row[key], list);
  }
  return map;
}

/** Расписание, выходные и услуги читаются тремя запросами на всех мастеров сразу. */
async function assembleMasters(db, masterRows) {
  if (masterRows.length === 0) return [];
  const ids = masterRows.map((m) => m.id);
  const [services, schedule, daysOff] = await Promise.all([
    db.all('SELECT master_id, service_id FROM master_services WHERE master_id = ANY(?) ORDER BY service_id', [ids]),
    db.all('SELECT * FROM master_schedule WHERE master_id = ANY(?) ORDER BY weekday', [ids]),
    db.all('SELECT * FROM master_days_off WHERE master_id = ANY(?) ORDER BY date_from, id', [ids]),
  ]).then((lists) => lists.map((rows) => groupBy(rows, 'master_id')));
  return masterRows.map((m) => ({
    id: m.id,
    name: m.name,
    title: m.title,
    bio: m.bio,
    color: m.color,
    photoUrl: m.photo_url,
    photoKey: m.photo_key ?? null,
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
export async function listMasters({ db }, { activeOnly = false, serviceId = null } = {}) {
  const rows = await db.all(`SELECT * FROM masters ${activeOnly ? 'WHERE active' : ''} ORDER BY sort, id`);
  const masters = await assembleMasters(db, rows);
  return serviceId == null ? masters : masters.filter((m) => m.serviceIds.includes(serviceId));
}

/** @param {Ctx} ctx */
export async function getMaster({ db }, id) {
  const row = await db.get('SELECT * FROM masters WHERE id = ?', [id]);
  if (!row) throw notFound('Мастер');
  return (await assembleMasters(db, [row]))[0];
}

async function replaceChildren(db, masterId, data) {
  await db.run('DELETE FROM master_services WHERE master_id = ?', [masterId]);
  for (const serviceId of new Set(data.serviceIds)) {
    await db.run('INSERT INTO master_services (master_id, service_id) VALUES (?, ?)', [masterId, serviceId]);
  }
  await db.run('DELETE FROM master_schedule WHERE master_id = ?', [masterId]);
  for (const s of data.schedule) {
    await db.run(
      `INSERT INTO master_schedule (master_id, weekday, start_min, end_min, break_start_min, break_end_min)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [masterId, s.weekday, s.startMin, s.endMin, s.breakStartMin ?? null, s.breakEndMin ?? null],
    );
  }
  await db.run('DELETE FROM master_days_off WHERE master_id = ?', [masterId]);
  for (const d of data.daysOff) {
    await db.run(
      'INSERT INTO master_days_off (master_id, date_from, date_to, note) VALUES (?, ?, ?, ?)',
      [masterId, d.from, d.to, d.note ?? ''],
    );
  }
}

/** @param {Ctx} ctx */
export async function createMaster({ db }, data) {
  const id = await db.tx(async (t) => {
    const row = await t.get(
      `INSERT INTO masters (name, title, bio, color, photo_url, active, sort)
       VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM masters)) RETURNING id`,
      [data.name, data.title, data.bio, data.color, data.photoUrl, Boolean(data.active)],
    );
    await replaceChildren(t, row.id, data);
    return row.id;
  });
  return getMaster({ db }, id);
}

/** @param {Ctx} ctx */
export async function updateMaster({ db }, id, data) {
  await getMaster({ db }, id);
  await db.tx(async (t) => {
    await t.run(
      'UPDATE masters SET name = ?, title = ?, bio = ?, color = ?, photo_url = ?, active = ? WHERE id = ?',
      [data.name, data.title, data.bio, data.color, data.photoUrl, Boolean(data.active), id],
    );
    await replaceChildren(t, id, data);
  });
  return getMaster({ db }, id);
}

/** @param {Ctx} ctx */
export async function deleteMaster({ db, storage }, id) {
  const master = await getMaster({ db }, id);
  const { n } = await db.get('SELECT COUNT(*)::int AS n FROM bookings WHERE master_id = ?', [id]);
  if (n > 0) {
    throw conflict('У мастера есть записи. Отключите мастера вместо удаления.', 'master_in_use');
  }
  await db.run('DELETE FROM masters WHERE id = ?', [id]);
  if (master.photoKey) await storage?.remove(master.photoKey).catch(() => {});
}
