/**
 * Nessie account refresh. The worker is the only caller; this module does not
 * write Spacetime rows itself — refreshAccount invokes the upsert reducers.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SnapshotRow = { name: string; nickname: string; last4: string; balance: number };
export type ActivityRow = {
  id: string;
  kind: string;
  date: string;
  description: string;
  amount: number;
  sortIndex: number;
};
export type PayeeRow = { name: string; nessieAccountId: string; trusted: boolean };

export type WorkerContext = {
  reducers: {
    upsertAccountSnapshot: (args: SnapshotRow) => void;
    replaceActivity: (args: { rows: ActivityRow[] }) => void;
    upsertPayee: (args: PayeeRow) => void;
  };
};

type NessieAccount = {
  _id?: unknown;
  nickname?: unknown;
  type?: unknown;
  balance?: unknown;
  account_number?: unknown;
  customer_id?: unknown;
};

type NessieTxn = {
  _id?: unknown;
  id?: unknown;
  transaction_date?: unknown;
  description?: unknown;
  amount?: unknown;
};

type GetResult = { ok: boolean; status: number; text: string; json: unknown };

const SEED_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../.seed.json');
const ACTIVITY_LIMIT = 20;

async function nessieGet(baseUrl: string, apiKey: string, path: string): Promise<GetResult> {
  const base = baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}${path}?key=${apiKey}`);
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { ok: response.ok, status: response.status, text, json };
}

function readList(kind: string, res: GetResult): unknown[] {
  if (res.ok && Array.isArray(res.json)) return res.json;
  if (res.status === 404 && /\bno\b.*\bfound\b/i.test(res.text)) return [];
  throw new Error(`Nessie ${kind} GET failed (${res.status})`);
}

function last4Of(accountNumber: unknown, id: unknown): string {
  const source =
    typeof accountNumber === 'string' && accountNumber.length > 0
      ? accountNumber
      : typeof id === 'string'
        ? id
        : '';
  return source.slice(-4);
}

function nicknameOf(account: NessieAccount): string {
  if (typeof account.nickname === 'string' && account.nickname) return account.nickname;
  if (typeof account.type === 'string' && account.type) return account.type;
  return '';
}

function balanceOf(value: unknown): number {
  const balance = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(balance)) throw new Error('Nessie account GET returned no balance');
  return balance;
}

function txnId(row: NessieTxn): string {
  if (typeof row._id === 'string' && row._id) return row._id;
  if (typeof row.id === 'string' && row.id) return row.id;
  return '';
}

function mapActivity(items: unknown[], kind: string, sign: 1 | -1): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as NessieTxn;
    const id = txnId(row);
    if (!id) continue;
    const raw = typeof row.amount === 'number' ? row.amount : Number(row.amount ?? 0);
    const amount = Number.isFinite(raw) ? raw : 0;
    rows.push({
      id,
      kind,
      date: typeof row.transaction_date === 'string' ? row.transaction_date : '',
      description: typeof row.description === 'string' ? row.description : '',
      amount: sign * Math.abs(amount),
      sortIndex: 0,
    });
  }
  return rows;
}

function customerName(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const customer = json as { first_name?: unknown; last_name?: unknown };
  if (typeof customer.first_name !== 'string' || typeof customer.last_name !== 'string') return null;
  return customer.first_name + ' ' + customer.last_name;
}

function readSeedPayees(): PayeeRow[] {
  if (!existsSync(SEED_PATH)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || !('payees' in parsed)) return [];
  const payees = (parsed as { payees: unknown }).payees;
  if (!Array.isArray(payees)) return [];
  const rows: PayeeRow[] = [];
  for (const item of payees) {
    if (!item || typeof item !== 'object') continue;
    const payee = item as { name?: unknown; nessieAccountId?: unknown; trusted?: unknown };
    if (typeof payee.name !== 'string') continue;
    if (typeof payee.nessieAccountId !== 'string') continue;
    if (typeof payee.trusted !== 'boolean') continue;
    rows.push({
      name: payee.name,
      nessieAccountId: payee.nessieAccountId,
      trusted: payee.trusted,
    });
  }
  return rows;
}

export async function fetchNessieAccount(env: {
  apiKey: string;
  baseUrl: string;
  accountId: string;
}): Promise<{ snapshot: SnapshotRow; activity: ActivityRow[]; payees: PayeeRow[] }> {
  const accountRes = await nessieGet(env.baseUrl, env.apiKey, `/accounts/${env.accountId}`);
  if (!accountRes.ok || !accountRes.json || typeof accountRes.json !== 'object' || Array.isArray(accountRes.json)) {
    throw new Error(`Nessie account GET failed (${accountRes.status})`);
  }
  const account = accountRes.json as NessieAccount;

  const customerPath =
    typeof account.customer_id === 'string' && account.customer_id
      ? `/customers/${account.customer_id}`
      : null;
  const [customerRes, depositsRes, withdrawalsRes, transfersRes] = await Promise.all([
    customerPath ? nessieGet(env.baseUrl, env.apiKey, customerPath) : Promise.resolve(null),
    nessieGet(env.baseUrl, env.apiKey, `/accounts/${env.accountId}/deposits`),
    nessieGet(env.baseUrl, env.apiKey, `/accounts/${env.accountId}/withdrawals`),
    nessieGet(env.baseUrl, env.apiKey, `/accounts/${env.accountId}/transfers`),
  ]);

  const name =
    customerRes && customerRes.ok ? customerName(customerRes.json) ?? 'Account' : 'Account';
  const activity = [
    ...mapActivity(readList('deposits', depositsRes), 'deposit', 1),
    ...mapActivity(readList('withdrawals', withdrawalsRes), 'withdrawal', -1),
    ...mapActivity(readList('transfers', transfersRes), 'transfer', -1),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, ACTIVITY_LIMIT)
    .map((row, sortIndex) => ({ ...row, sortIndex }));

  return {
    snapshot: {
      name,
      nickname: nicknameOf(account),
      last4: last4Of(account.account_number, account._id),
      balance: balanceOf(account.balance),
    },
    activity,
    payees: readSeedPayees(),
  };
}

export async function refreshAccount(conn: WorkerContext): Promise<void> {
  const apiKey = process.env.NESSIE_API_KEY;
  const accountId = process.env.NESSIE_ACCOUNT_ID;
  if (!apiKey || !accountId) {
    const missing = [
      !apiKey ? 'NESSIE_API_KEY' : null,
      !accountId ? 'NESSIE_ACCOUNT_ID' : null,
    ]
      .filter((name): name is string => name !== null)
      .join(' and ');
    console.error(`[worker] Account refresh skipped: ${missing} is not set`);
    return;
  }

  const baseUrl = process.env.NESSIE_BASE_URL ?? 'http://api.nessieisreal.com';
  try {
    const { snapshot, activity, payees } = await fetchNessieAccount({ apiKey, baseUrl, accountId });
    conn.reducers.upsertAccountSnapshot(snapshot);
    conn.reducers.replaceActivity({ rows: activity });
    for (const payee of payees) conn.reducers.upsertPayee(payee);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] Account refresh failed: ${message}`);
  }
}
