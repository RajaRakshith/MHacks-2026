import assert from 'node:assert/strict';
import test from 'node:test';
import { hasStoredTransferId } from './nessie-transfer-id.ts';

test('SATS option none is an empty transfer id', () => {
  assert.equal(hasStoredTransferId(null), false);
  assert.equal(hasStoredTransferId(''), false);
  assert.equal(hasStoredTransferId([1, []]), false);
  assert.equal(hasStoredTransferId({ none: [] }), false);
});

test('SATS option some is a sent transfer id', () => {
  assert.equal(hasStoredTransferId([0, 'txn-1']), true);
  assert.equal(hasStoredTransferId({ some: 'txn-1' }), true);
  assert.equal(hasStoredTransferId('txn-1'), true);
});

test('an empty some payload is not a sent id', () => {
  assert.equal(hasStoredTransferId([0, '']), false);
  assert.equal(hasStoredTransferId({ some: '' }), false);
  assert.equal(hasStoredTransferId([0, null]), false);
});
