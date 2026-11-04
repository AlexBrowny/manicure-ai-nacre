import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, eachDate, hhmmToMin, isISODate, isMonth, localAbsMinutes, minToHHMM,
  monthBounds, nowInTz, weekdayOf,
} from '../src/time.js';

test('minToHHMM and hhmmToMin round-trip', () => {
  assert.equal(minToHHMM(0), '00:00');
  assert.equal(minToHHMM(605), '10:05');
  assert.equal(hhmmToMin('9:30'), 570);
  assert.equal(hhmmToMin('21:00'), 1260);
});

test('hhmmToMin rejects malformed or out-of-range input', () => {
  assert.throws(() => hhmmToMin('25:00'));
  assert.throws(() => hhmmToMin('10:60'));
  assert.throws(() => hhmmToMin('abc'));
});

test('isISODate validates real calendar dates only', () => {
  assert.equal(isISODate('2026-11-05'), true);
  assert.equal(isISODate('2026-02-30'), false);
  assert.equal(isISODate('2026-2-3'), false);
  assert.equal(isISODate('hello'), false);
});

test('isMonth validates YYYY-MM', () => {
  assert.equal(isMonth('2026-11'), true);
  assert.equal(isMonth('2026-13'), false);
  assert.equal(isMonth('2026-1'), false);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('weekdayOf is Monday-based (0 = Monday, 6 = Sunday)', () => {
  assert.equal(weekdayOf('2026-11-02'), 0); // Monday
  assert.equal(weekdayOf('2026-11-08'), 6); // Sunday
});

test('eachDate is inclusive', () => {
  assert.deepEqual(eachDate('2026-11-29', '2026-12-02'), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(eachDate('2026-11-05', '2026-11-05'), ['2026-11-05']);
});

test('monthBounds returns first and last day', () => {
  assert.deepEqual(monthBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthBounds('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
});

test('nowInTz converts an instant to wall-clock date and minutes in the zone', () => {
  const instant = new Date('2026-11-05T20:30:00Z');
  assert.deepEqual(nowInTz('Asia/Almaty', instant), { date: '2026-11-06', minutes: 90 }); // UTC+5
  assert.deepEqual(nowInTz('UTC', instant), { date: '2026-11-05', minutes: 20 * 60 + 30 });
});

test('localAbsMinutes grows monotonically with date and minutes', () => {
  const a = localAbsMinutes('2026-11-05', 600);
  const b = localAbsMinutes('2026-11-05', 660);
  const c = localAbsMinutes('2026-11-06', 0);
  assert.equal(b - a, 60);
  assert.equal(c - localAbsMinutes('2026-11-05', 0), 1440);
});
