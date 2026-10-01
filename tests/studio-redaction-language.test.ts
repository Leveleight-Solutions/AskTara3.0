import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactIdentityAndPayment } from '../server/studio-imports.ts';
import { scrubStudioPrivateData } from '../server/studio-privacy.ts';

test('ordinary passport acknowledgements and nationality phrases remain readable', () => {
  for (const text of [
    'Thanks, Demo — Melbourne origin and a New Zealand passport noted for this fictional test traveller. Where would you like to travel?',
    'Your New Zealand passport nationality is noted.',
    'Australian passport holder visiting Paris.',
    'Passport not required for this domestic journey.',
    'Your passport identity checks must be completed with the carrier.',
  ]) {
    assert.equal(redactIdentityAndPayment(text), text);
    assert.deepEqual(scrubStudioPrivateData({ reply: text }), { reply: text });
  }
});

test('complete passport labels still redact synthetic identifiers with or without punctuation', () => {
  for (const text of [
    'Passport number AB1234567',
    'passport number: AB1234567',
    'Passport no AB1234567',
    'Passport no. AB1234567',
    'Passport No.: AB1234567',
    'Passport ID = AB1234567',
    'Passport: AB1234567',
    'Passport AB1234567',
    'Passport number: ZXCVBNM',
    'Passport ID: ZXCVBNM',
  ]) {
    const result = redactIdentityAndPayment(text);
    assert.doesNotMatch(result, /AB1234567|ZXCVBNM/);
    assert.match(result, /removed/);
  }
});

test('payment identifiers and machine-readable identity rows remain redacted', () => {
  for (const text of [
    'Card number 4111 1111 1111 1111',
    'Credit card: 4111111111111111',
    'Debit card number 4111111111111111',
    'CVV 123',
    'CVC: 123',
    'Security code = 123',
    'SSR DOCS FICTIONAL IDENTITY DETAILS',
    'P<NZLFICTIONAL<TRAVELLER<<<<<<<<<<',
  ]) {
    const result = redactIdentityAndPayment(text);
    assert.doesNotMatch(result, /4111|\b123\b|FICTIONAL|TRAVELLER/);
    assert.match(result, /removed/);
  }
});
