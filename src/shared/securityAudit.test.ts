import test from 'node:test';
import assert from 'node:assert/strict';
import { signSessionToken, verifySessionToken } from '../middleware/auth';
import {
  calculateRefundPaise,
  computeRazorpaySignature,
  verifyRazorpaySignature,
} from './security';

test('Session JWT signs customer claims, verifies cleanly, and rejects forged signatures', () => {
  const token = signSessionToken({
    uid: 'visitor-audit-1',
    email: 'audit-1@guest.stadiumx.in',
    name: 'Fan (audit-1)',
    role: 'USER',
  });

  assert.ok(token.startsWith('STXJWT.'));
  const verified = verifySessionToken(token);
  assert.ok(verified);
  assert.equal(verified?.uid, 'visitor-audit-1');
  assert.equal(verified?.role, 'USER');

  const parts = token.split('.');
  const forged = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`;
  assert.equal(verifySessionToken(forged), null);
  assert.equal(verifySessionToken('invalid.token'), null);
});

test('Razorpay HMAC-SHA256 rejects malformed or empty signatures safely', () => {
  const validSig = computeRazorpaySignature('order_123', 'pay_456', 'secret_abc');
  assert.equal(verifyRazorpaySignature('order_123', 'pay_456', validSig, 'secret_abc'), true);
  assert.equal(verifyRazorpaySignature('order_123', 'pay_456', 'short', 'secret_abc'), false);
  assert.equal(verifyRazorpaySignature('', 'pay_456', validSig, 'secret_abc'), false);
});

test('Refund calculation enforces FULL, PARTIAL, and NON_REFUNDABLE time windows', () => {
  const matchStart = new Date('2026-12-01T14:00:00Z');

  const full = calculateRefundPaise(500000, matchStart, new Date('2026-11-28T10:00:00Z'));
  assert.equal(full.refundTier, 'FULL');
  assert.equal(full.refundAmountPaise, 500000);

  const partial = calculateRefundPaise(500000, matchStart, new Date('2026-12-01T06:00:00Z'));
  assert.equal(partial.refundTier, 'PARTIAL');
  assert.equal(partial.refundAmountPaise, 350000);

  const none = calculateRefundPaise(500000, matchStart, new Date('2026-12-01T12:30:00Z'));
  assert.equal(none.refundTier, 'NON_REFUNDABLE');
  assert.equal(none.refundAmountPaise, 0);
});
