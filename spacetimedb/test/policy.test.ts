// spacetimedb/test/policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANK_HOLD_REASON,
  HOLD_TTL_MS,
  canExpireHeld,
  holdExpiresAtMs,
  shouldHold,
} from '../src/policy.ts';

test('holds only an active session at or above threshold', () => {
  assert.equal(shouldHold(true, 70, 70), true);
  assert.equal(shouldHold(true, 69, 70), false);
  assert.equal(shouldHold(false, 94, 70), false);
});

test('expiry is 4 hours after request', () => {
  assert.equal(HOLD_TTL_MS, 4 * 60 * 60 * 1000);
  assert.equal(holdExpiresAtMs(1_000), 1_000 + HOLD_TTL_MS);
});

test('can expire only a Held row whose time is up', () => {
  assert.equal(canExpireHeld('Held', 50, 50), true);
  assert.equal(canExpireHeld('Held', 51, 50), false);
  assert.equal(canExpireHeld('Approved', 0, 99), false);
  assert.equal(canExpireHeld('Held', null, 99), false);
});

test('bank hold copy is exact', () => {
  assert.equal(
    BANK_HOLD_REASON,
    'Come to the bank to complete this transfer. Watchdog is holding it for 4 hours because this call looks like a scam.'
  );
});
