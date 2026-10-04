/** Shapes returned by the Nessie API, plus pure helpers for turning them into dashboard rows. */

export interface NessieAccount {
  _id: string;
  type: string;
  nickname: string;
  rewards?: number;
  balance: number;
  account_number?: string;
  customer_id: string;
}

export interface NessieCustomer {
  _id: string;
  first_name: string;
  last_name: string;
}

export interface NessieDeposit {
  _id: string;
  transaction_date?: string;
  status?: string;
  medium?: string;
  amount: number;
  description?: string;
}

export interface NessieWithdrawal {
  _id: string;
  transaction_date?: string;
  status?: string;
  medium?: string;
  amount: number;
  description?: string;
}

/**
 * The live API lists transfers as { id, transaction_date, status, amount,
 * description }: `id` rather than `_id`, and no payer or payee. The older
 * shape with `_id`, `payer_id`, and `payee_id` is accepted too.
 */
export interface NessieTransfer {
  _id?: string;
  id?: string;
  transaction_date?: string;
  status?: string;
  medium?: string;
  payer_id?: string;
  payee_id?: string;
  amount: number;
  description?: string;
}

export interface NessiePurchase {
  _id: string;
  merchant_id?: string;
  purchase_date?: string;
  status?: string;
  medium?: string;
  amount: number;
  description?: string;
}

export type NessieBillStatus = "pending" | "cancelled" | "completed" | "recurring";

export interface NessieBill {
  _id: string;
  status: NessieBillStatus | string;
  payee: string;
  nickname?: string;
  creation_date?: string;
  payment_date?: string;
  recurring_date?: number;
  upcoming_payment_date?: string;
  payment_amount: number;
  account_id?: string;
}

export interface NessieMerchant {
  _id: string;
  name: string;
  category?: string | string[];
}

/** Everything the module reads about one account. */
export interface AccountData {
  account: NessieAccount;
  customer: NessieCustomer | null;
  deposits: NessieDeposit[];
  withdrawals: NessieWithdrawal[];
  bills: NessieBill[];
  /** Empty when the API does not support per-account purchases. */
  purchases: NessiePurchase[];
  /** Empty when the API does not support per-account transfers. */
  transfers: NessieTransfer[];
  /** merchant id -> merchant name */
  merchantNames: Record<string, string>;
}

export type ActivityKind = "deposit" | "withdrawal" | "transfer" | "purchase";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  /** Signed: money in is positive, money out is negative. */
  amount: number;
}

export interface BillItem {
  id: string;
  payee: string;
  amount: number;
  /** YYYY-MM-DD, or "" when the bill has no date. */
  paymentDate: string;
  status: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parses a Nessie "YYYY-MM-DD" date as UTC midnight. Returns NaN when it cannot. */
export function parseDay(date: string | undefined): number {
  if (!date) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "2026-09-28" -> "Sep 28" */
export function formatDay(date: string | undefined): string {
  const ms = parseDay(date);
  if (Number.isNaN(ms)) return "an unknown date";
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** YYYY-MM-DD for a UTC timestamp. */
export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** True when `date` falls in the `days` days up to and including today. */
export function withinLastDays(date: string | undefined, nowMs: number, days: number): boolean {
  const ms = parseDay(date);
  if (Number.isNaN(ms)) return false;
  // One day of slack on the future side covers timezone differences.
  return ms >= nowMs - days * DAY_MS - DAY_MS && ms <= nowMs + DAY_MS;
}

/** "$900", "$1,650", "$94.50" */
export function formatUsd(amount: number): string {
  const abs = Math.abs(amount);
  const whole = Math.round(abs * 100) % 100 === 0;
  const fixed = whole ? Math.round(abs).toString() : abs.toFixed(2);
  const [int = "0", frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${amount < 0 ? "-" : ""}$${grouped}${frac ? `.${frac}` : ""}`;
}

const live = (status: string | undefined): boolean => status !== "cancelled";

/** A transfer is money out unless it names this account as the payee. */
const isIncoming = (t: NessieTransfer, accountId: string): boolean => t.payee_id === accountId;

/**
 * What the customer can spend. The live Nessie API never changes an
 * account's `balance` when deposits, withdrawals, purchases, or transfers are
 * posted, so `balance` is treated as the opening balance and the activity is
 * applied on top of it.
 */
// SPEC-QUESTION: the spec reads the balance straight from GET /accounts/{id}.
// Done that way, money sent from the dashboard would never lower the balance.
export function availableBalance(data: AccountData): number {
  let total = data.account.balance;
  for (const d of data.deposits) if (live(d.status)) total += d.amount;
  for (const w of data.withdrawals) if (live(w.status)) total -= w.amount;
  for (const p of data.purchases) if (live(p.status)) total -= p.amount;
  for (const t of data.transfers) if (live(t.status)) total += isIncoming(t, data.account._id) ? t.amount : -t.amount;
  return Math.round(total * 100) / 100;
}

/**
 * Deposits, withdrawals, transfers, and purchases as one list, newest first.
 * Nessie dates only have day precision and the API returns lists in no
 * particular order, so within a day: rows not seen before come first, then
 * rows in the order they already had (`known`: id -> previous position).
 */
export function buildActivity(data: AccountData, limit = 25, known?: ReadonlyMap<string, number>): ActivityItem[] {
  const accountId = data.account._id;
  const rows: { item: ActivityItem; order: number }[] = [];
  let order = 0;

  for (const d of data.deposits) {
    if (!live(d.status)) continue;
    rows.push({ order: order++, item: { id: d._id, kind: "deposit", date: d.transaction_date ?? "", description: d.description || "Deposit", amount: d.amount } });
  }
  for (const w of data.withdrawals) {
    if (!live(w.status)) continue;
    rows.push({ order: order++, item: { id: w._id, kind: "withdrawal", date: w.transaction_date ?? "", description: w.description || "Withdrawal", amount: -w.amount } });
  }
  for (const p of data.purchases) {
    if (!live(p.status)) continue;
    const merchant = p.merchant_id ? data.merchantNames[p.merchant_id] : undefined;
    rows.push({ order: order++, item: { id: p._id, kind: "purchase", date: p.purchase_date ?? "", description: merchant || p.description || "Purchase", amount: -p.amount } });
  }
  for (const t of data.transfers) {
    if (!live(t.status)) continue;
    const incoming = isIncoming(t, accountId);
    const id = t._id ?? t.id ?? `transfer-${order}`;
    rows.push({ order: order++, item: { id, kind: "transfer", date: t.transaction_date ?? "", description: t.description || (incoming ? "Transfer in" : "Transfer out"), amount: incoming ? t.amount : -t.amount } });
  }

  const position = (id: string): number => known?.get(id) ?? -1;
  rows.sort((a, b) => {
    if (a.item.date !== b.item.date) return a.item.date < b.item.date ? 1 : -1;
    const byKnown = position(a.item.id) - position(b.item.id);
    return byKnown !== 0 ? byKnown : b.order - a.order;
  });
  return rows.slice(0, limit).map((r) => r.item);
}

export function buildBills(bills: readonly NessieBill[]): BillItem[] {
  return bills
    .filter((b) => b.status !== "cancelled")
    .map((b) => ({
      id: b._id,
      payee: b.payee,
      amount: b.payment_amount,
      paymentDate: b.upcoming_payment_date || b.payment_date || "",
      status: String(b.status),
    }))
    .sort((a, b) => (a.paymentDate < b.paymentDate ? -1 : a.paymentDate > b.paymentDate ? 1 : 0));
}

/**
 * Mock fixtures use relative dates so they never go stale: "@today", "@today-12",
 * "@today+9". Returns a deep copy with those replaced by YYYY-MM-DD strings.
 */
export function resolveFixtureDates<T>(value: T, nowMs: number): T {
  if (typeof value === "string") {
    const m = /^@today(?:([+-])(\d+))?$/.exec(value);
    if (!m) return value;
    const offset = m[1] ? (m[1] === "-" ? -1 : 1) * Number(m[2]) : 0;
    return isoDay(nowMs + offset * DAY_MS) as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveFixtureDates(v, nowMs)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveFixtureDates(v, nowMs);
    return out as T;
  }
  return value;
}
