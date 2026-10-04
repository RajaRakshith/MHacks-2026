/**
 * Claim verifiers (section 3.5). Pure: the module fetches Nessie data (or
 * loads fixtures) and passes it in. The `evidence` sentence is shown in the UI as-is.
 */
// SPEC-QUESTION: the spec says to port these from nessie_guard.py, which was
// not in the repo. They are written from the rules in section 3.5 instead.

import {
  formatDay, formatUsd, parseDay, withinLastDays,
  type AccountData, type NessieBill, type NessieDeposit, type NessiePurchase, type NessieWithdrawal,
} from "./nessie";
import { sha256Hex } from "./sha256";
import type { Claim, Verdict } from "./types";

export const DEPOSIT_WINDOW_DAYS = 30;
export const CHARGE_WINDOW_DAYS = 14;
/** Amounts match when they differ by less than this. */
export const AMOUNT_TOLERANCE = 1;

const sameAmount = (a: number, b: number): boolean => Math.abs(a - b) <= AMOUNT_TOLERANCE;
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Loose name match: "DTE" matches "DTE Energy" and the other way round. */
export function nameMatches(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

/** True if a deposit within $1 of `amount` exists in the last 30 days. */
export function verifyDeposit(amount: number, deposits: readonly NessieDeposit[], nowMs: number): Verdict {
  const claim: Claim = { kind: "deposit", amount };
  const hit = deposits.find(
    (d) => d.status !== "cancelled" && sameAmount(d.amount, amount) && withinLastDays(d.transaction_date, nowMs, DEPOSIT_WINDOW_DAYS),
  );
  if (hit) {
    return { claim, claimTrue: true, evidence: `A ${formatUsd(hit.amount)} deposit posted on ${formatDay(hit.transaction_date)}.` };
  }
  return { claim, claimTrue: false, evidence: `No ${formatUsd(amount)} deposit in the last ${DEPOSIT_WINDOW_DAYS} days.` };
}

/**
 * False if there is no bill from that payee, or the amount differs by $1 or
 * more. Otherwise true only if the bill is pending and its payment date has passed.
 */
export function verifyBill(
  payee: string,
  amount: number | undefined,
  bills: readonly NessieBill[],
  nowMs: number,
  overdue?: boolean,
): Verdict {
  const claim: Claim = { kind: "bill", payee };
  if (amount !== undefined) claim.amount = amount;
  if (overdue !== undefined) claim.overdue = overdue;

  const fromPayee = bills.filter((b) => b.status !== "cancelled" && (nameMatches(b.payee, payee) || (b.nickname ? nameMatches(b.nickname, payee) : false)));
  if (fromPayee.length === 0) {
    return { claim, claimTrue: false, evidence: `No bill from ${payee} on your account.` };
  }

  const bill = amount === undefined ? fromPayee[0]! : fromPayee.find((b) => Math.abs(b.payment_amount - amount) < AMOUNT_TOLERANCE);
  if (!bill) {
    const real = fromPayee[0]!;
    return { claim, claimTrue: false, evidence: `Your real ${real.payee} bill is ${formatUsd(real.payment_amount)}, not ${formatUsd(amount ?? 0)}.` };
  }

  const due = parseDay(bill.payment_date);
  const pastDue = bill.status === "pending" && !Number.isNaN(due) && due < nowMs;
  if (pastDue) {
    return { claim, claimTrue: true, evidence: `Your ${bill.payee} bill of ${formatUsd(bill.payment_amount)} was due ${formatDay(bill.payment_date)} and is unpaid.` };
  }
  return { claim, claimTrue: false, evidence: `Your ${bill.payee} bill of ${formatUsd(bill.payment_amount)} is not overdue (status: ${bill.status}).` };
}

/** Searches purchases and withdrawals from the last 14 days. */
export function verifyCharge(
  charge: { merchant?: string; amount?: number; location?: string },
  purchases: readonly NessiePurchase[],
  withdrawals: readonly NessieWithdrawal[],
  merchantNames: Readonly<Record<string, string>>,
  nowMs: number,
): Verdict {
  const claim: Claim = { kind: "charge" };
  if (charge.merchant !== undefined) claim.merchant = charge.merchant;
  if (charge.amount !== undefined) claim.amount = charge.amount;
  if (charge.location !== undefined) claim.location = charge.location;

  const amountOk = (amount: number): boolean => charge.amount === undefined || sameAmount(amount, charge.amount);
  const merchantOk = (...names: (string | undefined)[]): boolean =>
    charge.merchant === undefined || names.some((n) => (n ? nameMatches(n, charge.merchant!) : false));

  const purchase = purchases.find(
    (p) =>
      p.status !== "cancelled" &&
      withinLastDays(p.purchase_date, nowMs, CHARGE_WINDOW_DAYS) &&
      amountOk(p.amount) &&
      merchantOk(p.merchant_id ? merchantNames[p.merchant_id] : undefined, p.description),
  );
  if (purchase) {
    const where = (purchase.merchant_id ? merchantNames[purchase.merchant_id] : undefined) || purchase.description || "a merchant";
    return { claim, claimTrue: true, evidence: `A ${formatUsd(purchase.amount)} charge at ${where} posted on ${formatDay(purchase.purchase_date)}.` };
  }

  const withdrawal = withdrawals.find(
    (w) =>
      w.status !== "cancelled" &&
      withinLastDays(w.transaction_date, nowMs, CHARGE_WINDOW_DAYS) &&
      amountOk(w.amount) &&
      merchantOk(w.description),
  );
  if (withdrawal) {
    return { claim, claimTrue: true, evidence: `A ${formatUsd(withdrawal.amount)} withdrawal (${withdrawal.description || "no description"}) posted on ${formatDay(withdrawal.transaction_date)}.` };
  }

  const what = [charge.amount !== undefined ? formatUsd(charge.amount) : "", charge.merchant ?? "", "charge"].filter(Boolean).join(" ");
  return { claim, claimTrue: false, evidence: `No ${what} in the last ${CHARGE_WINDOW_DAYS} days.` };
}

/**
 * Checks one claim against account data. Returns null for a claim too vague
 * to check: a charge with neither merchant nor amount, or a bill with neither
 * an amount nor a statement that it is overdue.
 */
export function verifyClaim(claim: Claim, data: Pick<AccountData, "deposits" | "bills" | "purchases" | "withdrawals" | "merchantNames">, nowMs: number): Verdict | null {
  switch (claim.kind) {
    case "deposit":
      return verifyDeposit(claim.amount, data.deposits, nowMs);
    case "bill":
      if (claim.amount === undefined && claim.overdue !== true) return null;
      return verifyBill(claim.payee, claim.amount, data.bills, nowMs, claim.overdue);
    case "charge":
      if (claim.merchant === undefined && claim.amount === undefined) return null;
      return verifyCharge(claim, data.purchases, data.withdrawals, data.merchantNames, nowMs);
  }
}

/** Last 4 digits of anything number-like, or null when it has fewer than 4 digits. */
export function last4Of(numberLike: string): string | null {
  const digits = numberLike.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** SHA-256 of the last 4 digits. This is the only form in which account digits are compared. */
export function hashLast4(numberLike: string): string | null {
  const last4 = last4Of(numberLike);
  return last4 ? sha256Hex(last4) : null;
}

/** True when the customer read 4+ digits whose last 4 match their real account. */
export function digitsMatch(spoken: string, accountLast4Hash: string): boolean {
  const spokenHash = hashLast4(spoken);
  return spokenHash !== null && spokenHash === accountLast4Hash;
}

export const DIGITS_ALERT_MESSAGE = "You just shared your real account number. Hang up and call the number on your card.";
