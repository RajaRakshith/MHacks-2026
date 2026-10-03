/** Nessie API client. Every call goes through http.ts. The dashboard never calls Nessie directly. */

import type {
  AccountData, Claim, NessieAccount, NessieBill, NessieCustomer, NessieDeposit, NessieMerchant, NessiePurchase,
  NessieTransfer, NessieWithdrawal,
} from '@scamshield/core';
import { httpJson, type Http } from './http';

export const DEFAULT_NESSIE_BASE = 'https://prod-api.nessieisreal.com';

export interface NessieEnv {
  base: string;
  key: string;
  accountId: string;
}

export interface AccountFetch {
  data: AccountData;
  supportsPurchases: boolean;
  supportsTransfers: boolean;
}

const url = (env: NessieEnv, path: string): string => `${env.base.replace(/\/+$/, '')}${path}?key=${encodeURIComponent(env.key)}`;

function getList<T>(http: Http, env: NessieEnv, path: string): { ok: boolean; items: T[]; error?: string } {
  const res = httpJson(http, url(env, path));
  if (res.ok && Array.isArray(res.json)) return { ok: true, items: res.json as T[] };
  // An empty list can come back as 404 "No transfers found for this account".
  // A route that does not exist answers 403 instead, so this still works as the probe.
  if (res.status === 404 && /\bno\b.*\bfound\b/i.test(res.text)) return { ok: true, items: [] };
  return { ok: false, items: [], error: res.error ?? `GET ${path} did not return a list` };
}

function merchantNamesFor(http: Http, env: NessieEnv, purchases: readonly NessiePurchase[]): Record<string, string> {
  const names: Record<string, string> = {};
  // Newest purchases are last in the list; a handful of lookups covers the dashboard.
  const ids = [...new Set([...purchases].reverse().map((p) => p.merchant_id).filter((id): id is string => !!id))].slice(0, 12);
  for (const id of ids) {
    const res = httpJson(http, url(env, `/merchants/${id}`));
    const merchant = res.json as NessieMerchant | undefined;
    if (res.ok && merchant && typeof merchant.name === 'string') names[id] = merchant.name;
  }
  return names;
}

/**
 * Everything refresh_account needs. Purchases and transfers per account are
 * not in the official Nessie spec, so each call doubles as the probe.
 */
export function fetchAccountData(http: Http, env: NessieEnv): AccountFetch | { error: string } {
  const accountRes = httpJson(http, url(env, `/accounts/${env.accountId}`));
  const account = accountRes.json as NessieAccount | undefined;
  if (!accountRes.ok || !account || typeof account._id !== 'string') {
    return { error: accountRes.error ?? 'Nessie did not return the account' };
  }

  // SPEC-QUESTION: GET /customers/{id} is not in the spec's endpoint table,
  // but the account panel needs the customer's name and the account has only the id.
  const customerRes = httpJson(http, url(env, `/customers/${account.customer_id}`));
  const customer = customerRes.ok && customerRes.json && typeof customerRes.json === 'object' ? (customerRes.json as NessieCustomer) : null;

  const deposits = getList<NessieDeposit>(http, env, `/accounts/${env.accountId}/deposits`);
  const withdrawals = getList<NessieWithdrawal>(http, env, `/accounts/${env.accountId}/withdrawals`);
  const bills = getList<NessieBill>(http, env, `/accounts/${env.accountId}/bills`);
  const purchases = getList<NessiePurchase>(http, env, `/accounts/${env.accountId}/purchases`);
  const transfers = getList<NessieTransfer>(http, env, `/accounts/${env.accountId}/transfers`);

  return {
    data: {
      account,
      customer,
      deposits: deposits.items,
      withdrawals: withdrawals.items,
      bills: bills.items,
      purchases: purchases.items,
      transfers: transfers.items,
      merchantNames: purchases.ok ? merchantNamesFor(http, env, purchases.items) : {},
    },
    supportsPurchases: purchases.ok,
    supportsTransfers: transfers.ok,
  };
}

/** Only what the verifiers need for these claims. Keeps analyze_call fast. */
export function fetchForClaims(
  http: Http,
  env: NessieEnv,
  claims: readonly Claim[],
  supportsPurchases: boolean
): Pick<AccountData, 'deposits' | 'bills' | 'purchases' | 'withdrawals' | 'merchantNames'> {
  const kinds = new Set(claims.map((c) => c.kind));
  const deposits = kinds.has('deposit') ? getList<NessieDeposit>(http, env, `/accounts/${env.accountId}/deposits`).items : [];
  const bills = kinds.has('bill') ? getList<NessieBill>(http, env, `/accounts/${env.accountId}/bills`).items : [];
  const withdrawals = kinds.has('charge') ? getList<NessieWithdrawal>(http, env, `/accounts/${env.accountId}/withdrawals`).items : [];
  const purchases =
    kinds.has('charge') && supportsPurchases ? getList<NessiePurchase>(http, env, `/accounts/${env.accountId}/purchases`).items : [];
  return { deposits, bills, withdrawals, purchases, merchantNames: merchantNamesFor(http, env, purchases) };
}

export interface SendMoney {
  /** Whole dollars: Nessie drops cents. */
  amount: number;
  /** YYYY-MM-DD */
  date: string;
  payeeName: string;
  cash: boolean;
  supportsTransfers: boolean;
}

/** How a payment shows up in Nessie when it has to be a withdrawal. */
export function withdrawalDescription(payeeName: string, cash: boolean): string {
  return cash ? 'Cash withdrawal' : `Transfer to ${payeeName}`;
}

/**
 * The only place money leaves. A transfer when the API supports transfers;
 * otherwise a withdrawal described as "Transfer to <payee>". Cash is always a withdrawal.
 *
 * Checked against the live API: a transfer takes no payee (`payee_id` and
 * `medium` are rejected), so the payee lives in the description either way.
 * `status` must be sent: a withdrawal saved without one makes the account's
 * withdrawal list fail from then on.
 */
export function sendMoney(http: Http, env: NessieEnv, send: SendMoney): { ok: true; viaWithdrawal: boolean } | { ok: false; error: string } {
  const asTransfer = !send.cash && send.supportsTransfers;
  const res = asTransfer
    ? httpJson(http, url(env, `/accounts/${env.accountId}/transfers`), {
        method: 'POST',
        body: { transaction_date: send.date, status: 'completed', amount: send.amount, description: `Transfer to ${send.payeeName}` },
      })
    : httpJson(http, url(env, `/accounts/${env.accountId}/withdrawals`), {
        method: 'POST',
        body: { medium: 'balance', transaction_date: send.date, status: 'completed', amount: send.amount, description: withdrawalDescription(send.payeeName, send.cash) },
      });
  // Create calls may return a plain string instead of the new object, so only the status is checked.
  if (!res.ok) return { ok: false, error: res.error ?? 'Nessie rejected the payment' };
  return { ok: true, viaWithdrawal: !send.cash && !asTransfer };
}
