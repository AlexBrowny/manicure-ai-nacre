import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, formatPhone, normalizePhone } from '../src/domain/contact.js';

test('normalizePhone accepts Uzbek numbers in every common spelling', () => {
  assert.equal(normalizePhone('+998 (90) 123-45-67'), '+998901234567');
  assert.equal(normalizePhone('998901234567'), '+998901234567');
  assert.equal(normalizePhone('90 123 45 67'), '+998901234567', 'без кода страны');
  assert.equal(normalizePhone('8 90 123 45 67'), '+998901234567', 'с «8» впереди');
  assert.equal(normalizePhone('+998-71-234-56-78'), '+998712345678');
});

test('normalizePhone still accepts numbers of other countries in international form', () => {
  assert.equal(normalizePhone('+7 (900) 123-45-67'), '+79001234567');
  assert.equal(normalizePhone('+44 7911 123456'), '+447911123456');
});

test('normalizePhone rejects truncated or overlong Uzbek numbers', () => {
  assert.throws(() => normalizePhone('+998 90 123 45'), { code: 'invalid_phone' });
  assert.throws(() => normalizePhone('+998 90 123 45 678'), { code: 'invalid_phone' });
});

test('normalizePhone rejects too short, too long and non-numeric input', () => {
  assert.throws(() => normalizePhone('12345'), { code: 'invalid_phone' });
  assert.throws(() => normalizePhone('1'.repeat(16)), { code: 'invalid_phone' });
  assert.throws(() => normalizePhone('позвоните мне'), { code: 'invalid_phone' });
  assert.throws(() => normalizePhone(undefined), { code: 'invalid_phone' });
});

test('the phone error message shows the Uzbek format', () => {
  assert.throws(() => normalizePhone('1'), /\+998 90 123-45-67/);
});

test('cleanName trims, collapses whitespace and drops angle brackets', () => {
  assert.equal(cleanName('  Анна   Иванова '), 'Анна Иванова');
  assert.equal(cleanName('<b>Оля</b>'), 'bОля/b');
});

test('cleanName enforces length bounds', () => {
  assert.throws(() => cleanName('А'), { code: 'invalid_name' });
  assert.throws(() => cleanName('А'.repeat(61)), { code: 'invalid_name' });
});

test('formatPhone pretty-prints Uzbek numbers and leaves others untouched', () => {
  assert.equal(formatPhone('+998901234567'), '+998 90 123-45-67');
  assert.equal(formatPhone('+79001234567'), '+79001234567');
  assert.equal(formatPhone('+447911123456'), '+447911123456');
});
