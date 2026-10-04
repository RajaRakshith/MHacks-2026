import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  availableBalance, claimKey, digitsMatch, hashLast4, last4Of, mergeAnalyzerOutputs, parseAnalyzerOutput, resolveFixtureDates,
  scoreCall, stateForScore, verifyBill, verifyCharge, verifyClaim, verifyDeposit,
  type AccountData, type CallFixture, type NessieAccount, type NessieBill, type NessieDeposit, type NessieMerchant,
  type NessiePurchase, type NessieWithdrawal, type ShieldState, type Tactic, type Verdict,
} from "../src";

const NOW = Date.UTC(2026, 9, 3, 15, 0, 0);
const fixture = <T>(path: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/${path}`, import.meta.url)), "utf8")) as T;
const nessie = <T>(name: string): T => resolveFixtureDates(fixture<T>(`nessie/${name}.json`), NOW);

const account = nessie<NessieAccount>("account");
const deposits = nessie<NessieDeposit[]>("deposits");
const withdrawals = nessie<NessieWithdrawal[]>("withdrawals");
const purchases = nessie<NessiePurchase[]>("purchases");
const bills = nessie<NessieBill[]>("bills");
const merchantNames = Object.fromEntries(nessie<NessieMerchant[]>("merchants").map((m) => [m._id, m.name]));
const data: AccountData = { account, customer: null, deposits, withdrawals, purchases, bills, transfers: [], merchantNames };

describe("mock fixtures", () => {
  it("add up to Margaret's $8,400 balance", () => {
    expect(availableBalance(data)).toBe(8400);
  });
});

describe("verifyDeposit", () => {
  it("is false when no such deposit exists, with the spec's evidence sentence", () => {
    expect(verifyDeposit(900, deposits, NOW)).toEqual({
      claim: { kind: "deposit", amount: 900 },
      claimTrue: false,
      evidence: "No $900 deposit in the last 30 days.",
    });
  });

  it("is true for a real deposit in the last 30 days", () => {
    const v = verifyDeposit(1650, deposits, NOW);
    expect(v.claimTrue).toBe(true);
    expect(v.evidence).toBe("A $1,650 deposit posted on Sep 30.");
  });

  it("matches within plus or minus $1", () => {
    expect(verifyDeposit(1651, deposits, NOW).claimTrue).toBe(true);
    expect(verifyDeposit(1649, deposits, NOW).claimTrue).toBe(true);
    expect(verifyDeposit(1652, deposits, NOW).claimTrue).toBe(false);
  });

  it("ignores deposits older than 30 days and cancelled ones", () => {
    const old: NessieDeposit[] = [{ _id: "a", amount: 900, transaction_date: "2026-08-20", status: "executed" }];
    expect(verifyDeposit(900, old, NOW).claimTrue).toBe(false);
    const cancelled: NessieDeposit[] = [{ _id: "b", amount: 900, transaction_date: "2026-10-01", status: "cancelled" }];
    expect(verifyDeposit(900, cancelled, NOW).claimTrue).toBe(false);
  });
});

describe("verifyBill", () => {
  it("is false when there is no bill from that payee", () => {
    const v = verifyBill("Comcast", 80, bills, NOW);
    expect(v.claimTrue).toBe(false);
    expect(v.evidence).toBe("No bill from Comcast on your account.");
  });

  it("is false when the amount differs by $1 or more, and names the real amount", () => {
    const v = verifyBill("DTE Energy", 412, bills, NOW, true);
    expect(v).toEqual({
      claim: { kind: "bill", payee: "DTE Energy", amount: 412, overdue: true },
      claimTrue: false,
      evidence: "Your real DTE Energy bill is $94, not $412.",
    });
    expect(verifyBill("DTE", 95, bills, NOW).claimTrue).toBe(false);
  });

  it("is false when the bill is real but not pending and past due", () => {
    const v = verifyBill("DTE", 94, bills, NOW);
    expect(v.claimTrue).toBe(false);
    expect(v.evidence).toBe("Your DTE Energy bill of $94 is not overdue (status: recurring).");
    expect(verifyBill("Ann Arbor Water", 38, bills, NOW).claimTrue).toBe(false); // pending, due in the future
    expect(verifyBill("Oakwood Apartments", 1100, bills, NOW).claimTrue).toBe(false); // completed
  });

  it("is true only for a pending bill whose payment date has passed", () => {
    const late: NessieBill[] = [{ _id: "x", status: "pending", payee: "DTE Energy", payment_date: "2026-09-28", payment_amount: 94 }];
    const v = verifyBill("DTE Energy", 94, late, NOW);
    expect(v.claimTrue).toBe(true);
    expect(v.evidence).toBe("Your DTE Energy bill of $94 was due Sep 28 and is unpaid.");
    expect(verifyBill("DTE Energy", undefined, late, NOW).claimTrue).toBe(true);
  });
});

describe("verifyCharge", () => {
  it("is false for a charge that never happened", () => {
    const v = verifyCharge({ merchant: "Walmart", amount: 499, location: "Texas" }, purchases, withdrawals, merchantNames, NOW);
    expect(v).toEqual({
      claim: { kind: "charge", merchant: "Walmart", amount: 499, location: "Texas" },
      claimTrue: false,
      evidence: "No $499 Walmart charge in the last 14 days.",
    });
  });

  it("finds a real purchase by merchant name and amount", () => {
    const v = verifyCharge({ merchant: "Kroger", amount: 64.52 }, purchases, withdrawals, merchantNames, NOW);
    expect(v.claimTrue).toBe(true);
    expect(v.evidence).toBe("A $64.52 charge at Kroger posted on Sep 29.");
  });

  it("requires both merchant and amount to match when both are claimed", () => {
    expect(verifyCharge({ merchant: "Kroger", amount: 499 }, purchases, withdrawals, merchantNames, NOW).claimTrue).toBe(false);
    expect(verifyCharge({ merchant: "Walmart", amount: 64.52 }, purchases, withdrawals, merchantNames, NOW).claimTrue).toBe(false);
  });

  it("searches withdrawals too", () => {
    const v = verifyCharge({ amount: 60 }, [], withdrawals, {}, NOW);
    expect(v.claimTrue).toBe(true);
    expect(v.evidence).toContain("ATM withdrawal");
  });

  it("ignores anything older than 14 days", () => {
    const old: NessiePurchase[] = [{ _id: "p", merchant_id: "m", purchase_date: "2026-09-10", amount: 499 }];
    expect(verifyCharge({ merchant: "Walmart", amount: 499 }, old, [], { m: "Walmart" }, NOW).claimTrue).toBe(false);
  });

  it("works when the API does not support purchases", () => {
    expect(verifyCharge({ merchant: "Walmart" }, [], withdrawals, {}, NOW).evidence).toBe("No Walmart charge in the last 14 days.");
  });
});

describe("verifyClaim", () => {
  it("skips a charge claim with nothing to check", () => {
    expect(verifyClaim({ kind: "charge" }, data, NOW)).toBeNull();
    expect(verifyClaim({ kind: "charge", location: "Texas" }, data, NOW)).toBeNull();
  });

  it("skips a bill claim with no amount and no overdue statement, and checks it once either is given", () => {
    expect(verifyClaim({ kind: "bill", payee: "DTE Energy" }, data, NOW)).toBeNull();
    expect(verifyClaim({ kind: "bill", payee: "DTE Energy", overdue: true }, data, NOW)?.claimTrue).toBe(false);
    expect(verifyClaim({ kind: "bill", payee: "DTE Energy", amount: 412 }, data, NOW)?.evidence).toContain("$94");
  });
});

describe("digitsMatch", () => {
  const accountHash = hashLast4(account.account_number!)!;

  it("compares the last 4 digits by SHA-256 hash", () => {
    expect(accountHash).toMatch(/^[0-9a-f]{64}$/);
    expect(accountHash).not.toContain("1234");
    expect(digitsMatch("4417 1234 5678 1234", accountHash)).toBe(true);
    expect(digitsMatch("1234", accountHash)).toBe(true);
    expect(digitsMatch("it ends in 1-2-3-4", accountHash)).toBe(true);
  });

  it("does not match other digits or fewer than 4", () => {
    expect(digitsMatch("4417 1234 5678 9999", accountHash)).toBe(false);
    expect(digitsMatch("234", accountHash)).toBe(false);
    expect(digitsMatch("", accountHash)).toBe(false);
  });

  it("last4Of needs at least 4 digits", () => {
    expect(last4Of("12a3")).toBeNull();
    expect(last4Of("0012-3456")).toBe("3456");
  });
});

/** Replays a fixture the way analyze_call does in mock mode: labels in, verdicts and score out. */
function runScenario(name: string): { score: number; state: ShieldState; verdicts: Verdict[]; tactics: Tactic[]; maxScore: number } {
  const call = fixture<CallFixture>(`calls/${name}.json`);
  const reported = fixture<{ number: string }[]>("reported-numbers.json").some((r) => r.number === call.callerNumber);
  const accountHash = hashLast4(account.account_number!)!;
  const tactics = new Set<Tactic>();
  const verdicts = new Map<string, Verdict>();
  let digitsMatched = false;
  let score = 0;
  let maxScore = 0;

  for (const line of call.lines) {
    const out = mergeAnalyzerOutputs([parseAnalyzerOutput(line.labels ?? {})]);
    for (const t of out.tactics) tactics.add(t);
    for (const claim of out.claims) {
      if (verdicts.has(claimKey(claim))) continue;
      const v = verifyClaim(claim, data, NOW);
      if (v) verdicts.set(claimKey(claim), v);
    }
    if (out.digitsSpoken && digitsMatch(out.digitsSpoken, accountHash)) digitsMatched = true;
    score = scoreCall({ tactics: [...tactics], verdicts: [...verdicts.values()], callerReported: reported, digitsMatched });
    maxScore = Math.max(maxScore, score);
  }
  return { score, state: stateForScore(score), verdicts: [...verdicts.values()], tactics: [...tactics], maxScore };
}

describe("scenario acceptance (section 8), mock data", () => {
  it("refund-overpayment: scam_likely, deposit $900 false", () => {
    const r = runScenario("refund-overpayment");
    expect(r.state).toBe("scam_likely");
    expect(r.verdicts).toEqual([{ claim: { kind: "deposit", amount: 900 }, claimTrue: false, evidence: "No $900 deposit in the last 30 days." }]);
    expect(r.tactics).toEqual(expect.arrayContaining(["bank_impersonation", "refund_overpayment", "urgency"]));
  });

  it("fake-fraud-alert: scam_likely, charge false", () => {
    const r = runScenario("fake-fraud-alert");
    expect(r.state).toBe("scam_likely");
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]).toMatchObject({ claim: { kind: "charge", merchant: "Walmart", amount: 499 }, claimTrue: false });
    expect(r.tactics).toContain("credential_request");
  });

  it("utility-shutoff: scam_likely, bill false (real bill is $94)", () => {
    const r = runScenario("utility-shutoff");
    expect(r.state).toBe("scam_likely");
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]).toMatchObject({ claim: { kind: "bill", payee: "DTE Energy", amount: 412 }, claimTrue: false });
    expect(r.verdicts[0]!.evidence).toContain("$94");
    expect(r.tactics).toContain("unusual_payment");
  });

  it("legit-pharmacy: listening, score under 40, no verdicts", () => {
    const r = runScenario("legit-pharmacy");
    expect(r.state).toBe("listening");
    expect(r.maxScore).toBeLessThan(40);
    expect(r.verdicts).toEqual([]);
  });
});
