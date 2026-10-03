/** Mock mode: Nessie responses bundled from fixtures/nessie, so the demo runs with no API keys. */

import { resolveFixtureDates, type AccountData, type NessieAccount, type NessieBill, type NessieCustomer, type NessieDeposit, type NessieMerchant, type NessiePurchase, type NessieTransfer, type NessieWithdrawal } from '@scamshield/core';
import account from '../../fixtures/nessie/account.json';
import bills from '../../fixtures/nessie/bills.json';
import customer from '../../fixtures/nessie/customer.json';
import deposits from '../../fixtures/nessie/deposits.json';
import merchants from '../../fixtures/nessie/merchants.json';
import purchases from '../../fixtures/nessie/purchases.json';
import transfers from '../../fixtures/nessie/transfers.json';
import withdrawals from '../../fixtures/nessie/withdrawals.json';
import reportedNumbers from '../../fixtures/reported-numbers.json';

export interface MockTxn {
  id: bigint;
  /** transfer | withdrawal */
  kind: string;
  date: string;
  description: string;
  amount: number;
}

export const MOCK_REPORTED_NUMBERS: readonly { number: string; reports: number }[] = reportedNumbers;

/** Fixture data with relative dates resolved, plus money sent from the dashboard so far. */
export function mockAccountData(nowMs: number, sent: readonly MockTxn[]): AccountData {
  const base = resolveFixtureDates(
    {
      account: account as NessieAccount,
      customer: customer as NessieCustomer,
      deposits: deposits as NessieDeposit[],
      withdrawals: withdrawals as NessieWithdrawal[],
      bills: bills as NessieBill[],
      purchases: purchases as NessiePurchase[],
      transfers: transfers as NessieTransfer[],
    },
    nowMs
  );
  // Same shapes the live API returns. As there, `account.balance` is the opening
  // balance: the dashboard balance is that plus the activity (availableBalance).
  const sentTransfers = sent.filter((t) => t.kind === 'transfer');
  const sentWithdrawals = sent.filter((t) => t.kind !== 'transfer');
  return {
    ...base,
    withdrawals: [
      ...base.withdrawals,
      ...sentWithdrawals.map((t) => ({ _id: `mock-sent-${t.id}`, transaction_date: t.date, status: 'completed', medium: 'balance', amount: t.amount, description: t.description })),
    ],
    transfers: [
      ...base.transfers,
      ...sentTransfers.map((t) => ({ id: `mock-sent-${t.id}`, transaction_date: t.date, status: 'completed', amount: t.amount, description: t.description })),
    ],
    merchantNames: Object.fromEntries((merchants as NessieMerchant[]).map((m) => [m._id, m.name])),
  };
}
