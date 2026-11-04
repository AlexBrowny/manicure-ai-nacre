import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlapMinutes, startsFor, subtractIntervals, workingIntervals } from '../src/domain/slots.js';

test('workingIntervals without break is a single interval', () => {
  assert.deepEqual(workingIntervals({ startMin: 600, endMin: 1080 }), [{ start: 600, end: 1080 }]);
});

test('workingIntervals splits around a break', () => {
  const row = { startMin: 600, endMin: 1080, breakStartMin: 840, breakEndMin: 900 };
  assert.deepEqual(workingIntervals(row), [{ start: 600, end: 840 }, { start: 900, end: 1080 }]);
});

test('workingIntervals ignores an inverted or out-of-range break', () => {
  const row = { startMin: 600, endMin: 1080, breakStartMin: 900, breakEndMin: 840 };
  assert.deepEqual(workingIntervals(row), [{ start: 600, end: 1080 }]);
});

test('subtractIntervals cuts bookings out of free time', () => {
  const free = [{ start: 600, end: 1080 }];
  const busy = [{ start: 660, end: 720 }, { start: 900, end: 960 }];
  assert.deepEqual(subtractIntervals(free, busy), [
    { start: 600, end: 660 }, { start: 720, end: 900 }, { start: 960, end: 1080 },
  ]);
});

test('subtractIntervals handles unsorted, overlapping and edge-touching busy blocks', () => {
  const free = [{ start: 600, end: 900 }];
  const busy = [{ start: 800, end: 900 }, { start: 600, end: 650 }, { start: 640, end: 700 }];
  assert.deepEqual(subtractIntervals(free, busy), [{ start: 700, end: 800 }]);
});

test('subtractIntervals returns nothing when fully covered', () => {
  assert.deepEqual(subtractIntervals([{ start: 600, end: 700 }], [{ start: 0, end: 2000 }]), []);
});

test('startsFor yields grid-aligned starts that fit the whole duration', () => {
  const starts = startsFor([{ start: 600, end: 780 }], 60, 30);
  assert.deepEqual(starts, [600, 630, 660, 690, 720]);
});

test('startsFor aligns to the grid, not to the interval start', () => {
  // free from 11:15 — first aligned start is 11:30
  assert.deepEqual(startsFor([{ start: 675, end: 800 }], 60, 30), [690, 720]);
});

test('startsFor respects a minimum start (lead time)', () => {
  assert.deepEqual(startsFor([{ start: 600, end: 780 }], 60, 30, 650), [660, 690, 720]);
});

test('startsFor returns nothing when the service does not fit', () => {
  assert.deepEqual(startsFor([{ start: 600, end: 630 }], 60, 30), []);
});

test('overlapMinutes sums intersection with a window', () => {
  assert.equal(overlapMinutes([{ start: 600, end: 700 }, { start: 800, end: 900 }], 650, 850), 100);
  assert.equal(overlapMinutes([{ start: 600, end: 700 }], 700, 800), 0);
});
