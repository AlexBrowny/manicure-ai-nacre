import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, formatPhoneInput, isPhoneComplete, money } from '../public/js/format.js';

test('formatPhoneInput builds the Uzbek mask as digits are typed', () => {
  assert.equal(formatPhoneInput(''), '');
  assert.equal(formatPhoneInput('9'), '+998 (9');
  assert.equal(formatPhoneInput('90'), '+998 (90)');
  assert.equal(formatPhoneInput('901'), '+998 (90) 1');
  assert.equal(formatPhoneInput('90123'), '+998 (90) 123');
  assert.equal(formatPhoneInput('9012345'), '+998 (90) 123-45');
  assert.equal(formatPhoneInput('901234567'), '+998 (90) 123-45-67');
});

test('formatPhoneInput handles pasted numbers with country code, 8-prefix and extra digits', () => {
  assert.equal(formatPhoneInput('+998901234567'), '+998 (90) 123-45-67');
  assert.equal(formatPhoneInput('998901234567'), '+998 (90) 123-45-67');
  assert.equal(formatPhoneInput('8 90 123 45 67'), '+998 (90) 123-45-67');
  assert.equal(formatPhoneInput('+998 (90) 123-45-67 999'), '+998 (90) 123-45-67', 'лишние цифры отбрасываются');
});

test('formatPhoneInput is idempotent, so re-formatting its own output changes nothing', () => {
  for (const sample of ['9', '90', '901', '90123', '9012345', '901234567']) {
    const once = formatPhoneInput(sample);
    assert.equal(formatPhoneInput(once), once, sample);
  }
});

test('formatPhoneInput lets the user type +998 digit by digit and keeps foreign numbers as is', () => {
  assert.equal(formatPhoneInput('+'), '+');
  assert.equal(formatPhoneInput('+9'), '+9');
  assert.equal(formatPhoneInput('+99'), '+99');
  assert.equal(formatPhoneInput('+998'), '+998');
  assert.equal(formatPhoneInput('+7 900 123 45 67'), '+79001234567');
  assert.equal(formatPhoneInput('+447911123456'), '+447911123456');
});

test('isPhoneComplete requires 12 digits for Uzbek numbers and 10+ for foreign ones', () => {
  assert.equal(isPhoneComplete('+998 (90) 123-45-67'), true);
  assert.equal(isPhoneComplete('+998 (90) 123-45'), false);
  assert.equal(isPhoneComplete(''), false);
  assert.equal(isPhoneComplete('+79001234567'), true);
  assert.equal(isPhoneComplete('+7900123'), false);
});

test('formatPhone groups Uzbek numbers and leaves other numbers as is', () => {
  assert.equal(formatPhone('+998901234567'), '+998 90 123-45-67');
  assert.equal(formatPhone('+79001234567'), '+79001234567');
  assert.equal(formatPhone('+99890123'), '+99890123');
});

test('money formats prices in sums with thousands separators', () => {
  assert.match(money(1250000, 'сум'), /^1\s250\s000 сум$/);
});
