import { describe, expect, it } from "vitest";
import { accountBaseline, evidenceFor, nextRealBill, unusualFor, type ActivityRow, type BillRow } from "../src";

const NOW = Date.UTC(2026, 9, 3);
const activity: ActivityRow[] = [
  { kind: "purchase", date: "2026-10-02", description: "Stadium Hardware", amount: -23 },
  { kind: "transfer", date: "2026-10-01", description: "Transfer to Oakwood Apartments", amount: -1100 },
  { kind: "deposit", date: "2026-09-30", description: "Social Security", amount: 1650 },
  { kind: "purchase", date: "2026-09-29", description: "Kroger", amount: -64 },
  { kind: "withdrawal", date: "2026-09-24", description: "ATM withdrawal", amount: -60 },
  { kind: "deposit", date: "2026-08-20", description: "Pension", amount: 420 },
];
const bills: BillRow[] = [
  { payee: "Oakwood Apartments", amount: 1100, paymentDate: "2026-10-01", status: "completed" },
  { payee: "DTE Energy", amount: 94, paymentDate: "2026-10-12", status: "recurring" },
  { payee: "Ann Arbor Water", amount: 38, paymentDate: "2026-10-08", status: "pending" },
];

describe("accountBaseline", () => {
  it("finds the largest and the typical payment, and 30-day totals", () => {
    expect(accountBaseline(activity, NOW)).toEqual({
      paymentsOut: 4,
      largestOut: { amount: 1100, description: "Transfer to Oakwood Apartments", date: "2026-10-01" },
      typicalOut: 62,
      in30: 1650,
      out30: 1247,
    });
  });

  it("handles an empty history", () => {
    expect(accountBaseline([], NOW)).toEqual({ paymentsOut: 0, largestOut: null, typicalOut: 0, in30: 0, out30: 0 });
  });
});

describe("unusualFor", () => {
  const baseline = accountBaseline(activity, NOW);

  it("explains why $2,000 to a new payee is out of pattern", () => {
    expect(unusualFor(2000, false, baseline)).toEqual([
      "$2,000 is 1.8 times the largest payment on record ($1,100, Transfer to Oakwood Apartments).",
      "A typical payment from this account is $62.",
      "This payee has never been paid from this account.",
      "It is more than all the money that came in over the last 30 days ($1,650).",
    ]);
  });

  it("says nothing about a normal payment to a known payee", () => {
    expect(unusualFor(94, true, baseline)).toEqual([]);
    expect(unusualFor(1100, true, baseline)).toEqual(["A typical payment from this account is $62."]);
  });
});

describe("evidenceFor", () => {
  it("lists the real deposits behind a deposit claim", () => {
    expect(evidenceFor({ kind: "deposit", amount: 900 }, activity, bills)).toEqual(["Sep 30: Social Security, $1,650", "Aug 20: Pension, $420"]);
  });

  it("lists the real bill behind a bill claim", () => {
    expect(evidenceFor({ kind: "bill", payee: "DTE", amount: 412 }, activity, bills)).toEqual(["DTE Energy: $94, recurring, Oct 12"]);
  });

  it("lists recent purchases and withdrawals behind a charge claim", () => {
    expect(evidenceFor({ kind: "charge", merchant: "Walmart", amount: 499 }, activity, bills)).toEqual([
      "Oct 2: Stadium Hardware, $23",
      "Sep 29: Kroger, $64",
      "Sep 24: ATM withdrawal, $60",
    ]);
  });

  it("says so when there is nothing on record", () => {
    expect(evidenceFor({ kind: "deposit", amount: 900 }, [], [])).toEqual(["No deposits on record."]);
  });
});

describe("nextRealBill", () => {
  it("is the soonest bill still owed", () => {
    expect(nextRealBill(bills)?.payee).toBe("Ann Arbor Water");
    expect(nextRealBill([])).toBeNull();
  });
});
