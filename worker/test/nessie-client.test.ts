import assert from 'node:assert/strict';
import test from 'node:test';
import { executeNessieTransfer } from '../src/nessie-client.ts';

test('missing NESSIE_API_KEY does not invent a mock transfer', async () => {
  const prevKey = process.env.NESSIE_API_KEY;
  const prevAcct = process.env.NESSIE_ACCOUNT_ID;
  try {
    delete process.env.NESSIE_API_KEY;
    process.env.NESSIE_ACCOUNT_ID = 'acc-1';
    const result = await executeNessieTransfer({
      intentId: 1n,
      userId: 'demo-user',
      amountCents: 200000n,
      destinationAccount: 'payee-1',
      memo: 'refund',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /NESSIE_API_KEY/);
    if (result.ok) assert.doesNotMatch(result.transferId, /^mock-/);
  } finally {
    if (prevKey === undefined) delete process.env.NESSIE_API_KEY;
    else process.env.NESSIE_API_KEY = prevKey;
    if (prevAcct === undefined) delete process.env.NESSIE_ACCOUNT_ID;
    else process.env.NESSIE_ACCOUNT_ID = prevAcct;
  }
});

test('missing NESSIE_ACCOUNT_ID fails', async () => {
  const prevKey = process.env.NESSIE_API_KEY;
  const prevAcct = process.env.NESSIE_ACCOUNT_ID;
  try {
    process.env.NESSIE_API_KEY = 'k';
    delete process.env.NESSIE_ACCOUNT_ID;
    const result = await executeNessieTransfer({
      intentId: 2n,
      userId: 'demo-user',
      amountCents: 100n,
      destinationAccount: 'payee-1',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /NESSIE_ACCOUNT_ID/);
  } finally {
    if (prevKey === undefined) delete process.env.NESSIE_API_KEY;
    else process.env.NESSIE_API_KEY = prevKey;
    if (prevAcct === undefined) delete process.env.NESSIE_ACCOUNT_ID;
    else process.env.NESSIE_ACCOUNT_ID = prevAcct;
  }
});
