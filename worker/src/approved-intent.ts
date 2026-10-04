import {
  DEMO_ACCOUNT_USER_ID,
  executeNessieTransfer,
  type NessieTransferResult,
} from './nessie-client.js';

export type ApprovedTransferRow = {
  id: bigint;
  userId: string;
  amountCents: bigint;
  destinationAccount: string;
  memo?: string;
  status: { tag: string };
};

export type ApprovedIntentReducers = {
  completeTransfer: (args: { intentId: bigint; nessieTransferId: string }) => void;
  failTransfer: (args: { intentId: bigint; reason: string }) => void;
};

export type ApprovedIntentOutcome = 'skipped' | 'refused' | 'completed' | 'failed';

/**
 * Approved intents for anyone but demo-user are failed locally.
 * executeNessieTransfer is not called, so NESSIE_ACCOUNT_ID cannot be debited
 * even when this worker wins the race against acceptance.
 */
export async function settleApprovedIntent(
  reducers: ApprovedIntentReducers,
  row: ApprovedTransferRow,
  inFlight: Set<string>,
  execute: (
    request: Parameters<typeof executeNessieTransfer>[0]
  ) => Promise<NessieTransferResult> = executeNessieTransfer,
): Promise<ApprovedIntentOutcome> {
  if (row.status.tag !== 'Approved') return 'skipped';

  const key = row.id.toString();
  if (inFlight.has(key)) return 'skipped';
  inFlight.add(key);

  try {
    if (row.userId !== DEMO_ACCOUNT_USER_ID) {
      console.error(
        `[worker] Refusing to debit NESSIE_ACCOUNT_ID for transfer ${key} user ${row.userId}`
      );
      try {
        reducers.failTransfer({
          intentId: row.id,
          reason: `refusing to debit NESSIE_ACCOUNT_ID for ${row.userId}`,
        });
      } catch (err) {
        console.error(
          `[worker] Transfer ${key} was already not Approved: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return 'refused';
    }

    console.log(
      `[worker] Executing approved transfer ${key} for user ${row.userId}: $${Number(row.amountCents) / 100}`
    );

    const result = await execute({
      intentId: row.id,
      userId: row.userId,
      amountCents: row.amountCents,
      destinationAccount: row.destinationAccount,
      memo: row.memo,
    });

    if (result.ok) {
      reducers.completeTransfer({
        intentId: row.id,
        nessieTransferId: result.transferId,
      });
      console.log(`[worker] Transfer ${key} completed (${result.transferId})`);
      return 'completed';
    }

    reducers.failTransfer({
      intentId: row.id,
      reason: result.error,
    });
    console.error(`[worker] Transfer ${key} failed: ${result.error}`);
    return 'failed';
  } finally {
    inFlight.delete(key);
  }
}
