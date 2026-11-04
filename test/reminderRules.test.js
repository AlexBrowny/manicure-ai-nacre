import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alreadyPassed, describeOffsets, dueOffset, durationPhrase, markSent, parseSent, reminderOffsets, serializeSent,
} from '../src/domain/reminderRules.js';

test('default schedule is 2 hours and 10 minutes, largest first', () => {
  assert.deepEqual(reminderOffsets({}), [120, 10]);
  assert.deepEqual(reminderOffsets({ reminderMinutes: [10, 1440, 120] }), [1440, 120, 10]);
});

test('sent offsets survive a round-trip through the database string', () => {
  assert.deepEqual([...parseSent('')], []);
  assert.deepEqual([...parseSent('120,10')], [120, 10]);
  assert.equal(serializeSent(new Set([10, 120])), '120,10');
});

test('dueOffset picks the reminder whose moment has come', () => {
  const offsets = [120, 10];
  assert.equal(dueOffset(offsets, new Set(), 300), null);
  assert.equal(dueOffset(offsets, new Set(), 115), 120);
  assert.equal(dueOffset(offsets, new Set([120]), 115), null);
  assert.equal(dueOffset(offsets, new Set([120]), 9), 10);
  assert.equal(dueOffset(offsets, new Set(), 9), 10, 'пропущенное «за 2 часа» не догоняем');
  assert.equal(dueOffset(offsets, new Set(), 0), null);
  assert.equal(dueOffset(offsets, new Set(), -5), null);
});

test('alreadyPassed and markSent close earlier reminders', () => {
  assert.deepEqual([...alreadyPassed([120, 10], 90)], [120]);
  assert.deepEqual([...alreadyPassed([120, 10], 500)], []);
  assert.deepEqual([...markSent([120, 10], new Set(), 10)].sort((a, b) => a - b), [10, 120]);
  assert.deepEqual([...markSent([120, 10], new Set(), 120)], [120]);
});

test('reminder wording is natural Russian', () => {
  assert.equal(durationPhrase(10), '10 минут');
  assert.equal(durationPhrase(1), '1 минуту');
  assert.equal(durationPhrase(2), '2 минуты');
  assert.equal(durationPhrase(120), '2 часа');
  assert.equal(durationPhrase(60), '1 час');
  assert.equal(durationPhrase(300), '5 часов');
  assert.equal(durationPhrase(90), '1 ч 30 мин');
  assert.equal(durationPhrase(1440), 'сутки');
  assert.equal(describeOffsets([120, 10]), 'за 2 часа и за 10 минут');
  assert.equal(describeOffsets([1440, 120, 10]), 'за сутки, за 2 часа и за 10 минут');
  assert.equal(describeOffsets([30]), 'за 30 минут');
});
