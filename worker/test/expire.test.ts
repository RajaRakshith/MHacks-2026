import assert from 'node:assert/strict';
import test from 'node:test';
import { dueHoldIds } from '../src/expire.ts';

test('only due Held rows expire', () => {
  const ids = dueHoldIds(
    [
      { id: 1n, status: { tag: 'Held' }, expiresAtMs: 10 },
      { id: 2n, status: { tag: 'Held' }, expiresAtMs: 30 },
      { id: 3n, status: { tag: 'Approved' }, expiresAtMs: 10 },
    ],
    20,
  );
  assert.deepEqual(ids, [1n]);
});
