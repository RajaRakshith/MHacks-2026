import assert from 'node:assert/strict';
import test from 'node:test';
import { settleApprovedIntent, type ApprovedTransferRow } from '../src/approved-intent.ts';

function row(userId: string): ApprovedTransferRow {
  return {
    id: 7n,
    userId,
    amountCents: 5000n,
    destinationAccount: 'other',
    memo: 'acceptance',
    status: { tag: 'Approved' },
  };
}

test('someone-else Approved intent never calls Nessie', async () => {
  let executions = 0;
  const fails: string[] = [];
  const completes: string[] = [];
  const outcome = await settleApprovedIntent(
    {
      completeTransfer: ({ nessieTransferId }) => {
        completes.push(nessieTransferId);
      },
      failTransfer: ({ reason }) => {
        fails.push(reason);
      },
    },
    row('someone-else'),
    new Set(),
    async () => {
      executions += 1;
      throw new Error('Nessie must not be called');
    },
  );
  assert.equal(outcome, 'refused');
  assert.equal(executions, 0);
  assert.deepEqual(completes, []);
  assert.deepEqual(fails, ['refusing to debit NESSIE_ACCOUNT_ID for someone-else']);
});

test('demo-user Approved intent is the only one executed', async () => {
  let executions = 0;
  const completes: string[] = [];
  const outcome = await settleApprovedIntent(
    {
      completeTransfer: ({ nessieTransferId }) => {
        completes.push(nessieTransferId);
      },
      failTransfer: () => {
        throw new Error('demo-user should be executed, not failed');
      },
    },
    row('demo-user'),
    new Set(),
    async () => {
      executions += 1;
      return { ok: true, transferId: 'txn-demo' };
    },
  );
  assert.equal(outcome, 'completed');
  assert.equal(executions, 1);
  assert.deepEqual(completes, ['txn-demo']);
});

test('a lost fail race still does not call Nessie', async () => {
  let executions = 0;
  const outcome = await settleApprovedIntent(
    {
      completeTransfer: () => {
        throw new Error('must not complete');
      },
      failTransfer: () => {
        throw new Error('Cannot fail transfer in status Failed');
      },
    },
    row('someone-else'),
    new Set(),
    async () => {
      executions += 1;
      return { ok: true, transferId: 'should-not-exist' };
    },
  );
  assert.equal(outcome, 'refused');
  assert.equal(executions, 0);
});
