import { stateForScore } from './score';

export const DEMO_USER_ID = 'demo-user';

export function dollarsToCents(dollars: number): bigint {
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error('Amount must be a positive number.');
  }
  return BigInt(Math.round(dollars * 100));
}

export function shieldState(
  active: boolean,
  score: number,
): 'idle' | 'listening' | 'caution' | 'scam_likely' {
  return active ? stateForScore(score) : 'idle';
}

export type LiveTransferIntent = {
  id?: bigint | number;
  amountCents: bigint | number;
  status: { tag: string } | string;
  nessieTransferId?: string | null;
  destinationAccount?: string;
  memo?: string | null;
};

export type PendingActivityRow = {
  id: string;
  kind: string;
  date: string;
  description: string;
  amount: number;
  sortIndex: number;
};

function statusTag(status: LiveTransferIntent['status']): string {
  return typeof status === 'string' ? status : status.tag;
}

function dollarsOut(amountCents: bigint | number): number {
  return Number(amountCents) / 100;
}

function isLiveSend(intent: LiveTransferIntent, activityIds: ReadonlySet<string>): boolean {
  const tag = statusTag(intent.status);
  if (tag !== 'Approved' && tag !== 'Completed') return false;
  const nessieId = intent.nessieTransferId ?? undefined;
  return !(nessieId && activityIds.has(nessieId));
}

/** Snapshot balance minus sends that have left the app but are not in Nessie activity yet. */
export function liveAvailableBalance(
  snapshotBalance: number,
  intents: readonly LiveTransferIntent[],
  activityIds: ReadonlySet<string>
): number {
  let total = snapshotBalance;
  for (const intent of intents) {
    if (!isLiveSend(intent, activityIds)) continue;
    total -= dollarsOut(intent.amountCents);
  }
  return Math.round(total * 100) / 100;
}

/** Approved/Completed sends that should appear at the top of Recent activity. */
export function pendingSendActivity(
  intents: readonly LiveTransferIntent[],
  activityIds: ReadonlySet<string>,
  today = new Date().toISOString().slice(0, 10)
): PendingActivityRow[] {
  const rows: PendingActivityRow[] = [];
  for (const intent of intents) {
    if (!isLiveSend(intent, activityIds)) continue;
    const id = intent.id === undefined ? `pending-${rows.length}` : `pending-${intent.id.toString()}`;
    rows.push({
      id,
      kind: 'transfer',
      date: today,
      description: intent.memo || (intent.destinationAccount ? `Transfer to ${intent.destinationAccount}` : 'Transfer'),
      amount: -dollarsOut(intent.amountCents),
      sortIndex: 0,
    });
  }
  return rows;
}
