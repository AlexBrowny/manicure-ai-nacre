import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  `
  CREATE TABLE services (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    category      TEXT    NOT NULL DEFAULT 'Маникюр',
    description   TEXT    NOT NULL DEFAULT '',
    duration_min  INTEGER NOT NULL CHECK (duration_min BETWEEN 15 AND 480),
    price         INTEGER NOT NULL CHECK (price >= 0),
    active        INTEGER NOT NULL DEFAULT 1,
    sort          INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE masters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    title      TEXT    NOT NULL DEFAULT '',
    bio        TEXT    NOT NULL DEFAULT '',
    color      TEXT    NOT NULL DEFAULT '#8E7CC3',
    photo_url  TEXT    NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    sort       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE master_services (
    master_id  INTEGER NOT NULL REFERENCES masters(id)  ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    PRIMARY KEY (master_id, service_id)
  );

  CREATE TABLE master_schedule (
    master_id       INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
    weekday         INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_min       INTEGER NOT NULL,
    end_min         INTEGER NOT NULL,
    break_start_min INTEGER,
    break_end_min   INTEGER,
    PRIMARY KEY (master_id, weekday),
    CHECK (start_min >= 0 AND end_min <= 1440 AND start_min < end_min)
  );

  CREATE TABLE master_days_off (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
    date_from TEXT    NOT NULL,
    date_to   TEXT    NOT NULL,
    note      TEXT    NOT NULL DEFAULT '',
    CHECK (date_from <= date_to)
  );

  CREATE TABLE bookings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    master_id    INTEGER NOT NULL REFERENCES masters(id),
    service_id   INTEGER NOT NULL REFERENCES services(id),
    service_name TEXT    NOT NULL,
    price        INTEGER NOT NULL,
    date         TEXT    NOT NULL,
    start_min    INTEGER NOT NULL,
    end_min      INTEGER NOT NULL,
    client_name  TEXT    NOT NULL,
    client_phone TEXT    NOT NULL,
    source       TEXT    NOT NULL CHECK (source IN ('web', 'telegram', 'admin')),
    status       TEXT    NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('confirmed', 'completed', 'cancelled', 'no_show')),
    tg_chat_id   INTEGER,
    link_token   TEXT    UNIQUE,
    notes        TEXT    NOT NULL DEFAULT '',
    reminded_24h INTEGER NOT NULL DEFAULT 0,
    reminded_2h  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (start_min < end_min)
  );
  CREATE INDEX idx_bookings_day  ON bookings (date, master_id);
  CREATE INDEX idx_bookings_chat ON bookings (tg_chat_id);

  CREATE TABLE tg_profiles (
    chat_id INTEGER PRIMARY KEY,
    name    TEXT NOT NULL DEFAULT '',
    phone   TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE tg_drafts (
    chat_id    INTEGER PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Атомарно выполняет fn. Вложенные транзакции не поддерживаются. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
