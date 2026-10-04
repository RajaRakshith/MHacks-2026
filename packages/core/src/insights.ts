/**
 * Account analysis from Nessie data: what is normal for this customer, how a
 * payment compares to that, and which real records back up a claim check.
 * Pure functions over the rows the dashboard already has.
 */

import { nameMatches } from "./verify";
import { formatDay, formatUsd, parseDay } from "./nessie";
import type { Claim } from "./types";

export interface ActivityRow {
  kind: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  /** Signed: money out is negative. */
  amount: number;
}

export interface BillRow {
  payee: string;
  amount: number;
  /** YYYY-MM-DD or "" */
  paymentDate: string;
  status: string;
}

export interface Baseline {
  /** Number of payments out in the history we have. */
  paymentsOut: number;
  largestOut: { amount: number; description: string; date: string } | null;
  /** Median payment out. 0 when there are none. */
  typicalOut: number;
  /** Totals over the last 30 days. */
  in30: number;
  out30: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** What this customer's money normally does, from their own history. */
export function accountBaseline(activity: readonly ActivityRow[], nowMs: number): Baseline {
  const out = activity.filter((a) => a.amount < 0);
  const amounts = out.map((a) => -a.amount).sort((a, b) => a - b);
  const largest = out.reduce<ActivityRow | null>((max, a) => (!max || a.amount < max.amount ? a : max), null);
  const mid = Math.floor(amounts.length / 2);
  const typicalOut = amounts.length === 0 ? 0 : amounts.length % 2 ? amounts[mid]! : (amounts[mid - 1]! + amounts[mid]!) / 2;
  const recent = activity.filter((a) => {
    const ms = parseDay(a.date);
    return !Number.isNaN(ms) && ms >= nowMs - 30 * DAY_MS;
  });
  return {
    paymentsOut: out.length,
    largestOut: largest ? { amount: -largest.amount, description: largest.description, date: largest.date } : null,
    typicalOut: Math.round(typicalOut * 100) / 100,
    in30: Math.round(recent.filter((a) => a.amount > 0).reduce((s, a) => s + a.amount, 0) * 100) / 100,
    out30: Math.round(recent.filter((a) => a.amount < 0).reduce((s, a) => s - a.amount, 0) * 100) / 100,
  };
}

/**
 * Plain-language reasons a payment is out of pattern for this customer.
 * Empty when it looks normal.
 */
export function unusualFor(amount: number, payeeKnown: boolean, baseline: Baseline): string[] {
  const reasons: string[] = [];
  if (baseline.largestOut && amount > baseline.largestOut.amount) {
    const times = amount / baseline.largestOut.amount;
    reasons.push(
      `${formatUsd(amount)} is ${times >= 1.5 ? `${times.toFixed(1)} times` : "more than"} the largest payment on record (${formatUsd(baseline.largestOut.amount)}, ${baseline.largestOut.description}).`,
    );
  }
  if (baseline.typicalOut > 0 && amount >= baseline.typicalOut * 5) {
    reasons.push(`A typical payment from this account is ${formatUsd(baseline.typicalOut)}.`);
  }
  if (!payeeKnown) reasons.push("This payee has never been paid from this account.");
  if (baseline.in30 > 0 && amount > baseline.in30) reasons.push(`It is more than all the money that came in over the last 30 days (${formatUsd(baseline.in30)}).`);
  return reasons;
}

/** The real records a claim was checked against, newest first, as short lines. */
export function evidenceFor(claim: Claim, activity: readonly ActivityRow[], bills: readonly BillRow[], limit = 3): string[] {
  const line = (a: ActivityRow): string => `${formatDay(a.date)}: ${a.description}, ${formatUsd(Math.abs(a.amount))}`;
  switch (claim.kind) {
    case "deposit": {
      const deposits = activity.filter((a) => a.kind === "deposit").slice(0, limit).map(line);
      return deposits.length ? deposits : ["No deposits on record."];
    }
    case "charge": {
      const charges = activity.filter((a) => a.kind === "purchase" || a.kind === "withdrawal").slice(0, limit).map(line);
      return charges.length ? charges : ["No purchases or withdrawals on record."];
    }
    case "bill": {
      const matching = bills.filter((b) => nameMatches(b.payee, claim.payee));
      const shown = (matching.length ? matching : bills).slice(0, limit);
      if (shown.length === 0) return ["No bills on record."];
      return shown.map((b) => `${b.payee}: ${formatUsd(b.amount)}, ${b.status}${b.paymentDate ? `, ${formatDay(b.paymentDate)}` : ""}`);
    }
  }
}

/** The next bill that is actually owed: not paid or cancelled, soonest first. */
export function nextRealBill(bills: readonly BillRow[]): BillRow | null {
  const open = bills.filter((b) => b.status === "pending" || b.status === "recurring");
  open.sort((a, b) => (a.paymentDate || "9999").localeCompare(b.paymentDate || "9999"));
  return open[0] ?? null;
}
