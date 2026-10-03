import { describe, expect, it } from "vitest";
import {
  availableBalance, buildActivity, buildBills, claimKey, describeClaim, formatUsd, mergeAnalyzerOutputs, parseAnalyzerJson, parseAnalyzerOutput,
  redactAnalyzerOutput, redactDigits, resolveFixtureDates, sha256Hex, transcriptWindow, type AccountData,
} from "../src";

describe("sha256Hex", () => {
  it("matches the standard test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256Hex("1234")).toBe("03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4");
  });

  it("handles multi-block and non-ASCII input", () => {
    expect(sha256Hex("a".repeat(200))).toBe("c2a908d98f5df987ade41b5fce213067efbcc21ef2240212a41e54b5e7c28ae5");
    expect(sha256Hex("héllo € 🙂")).toBe("3a7565785a6bcc5dc5278f77c11b38e9e5dc3824d305979936519254fb0fdca3");
  });
});

describe("parseAnalyzerOutput", () => {
  it("accepts the example Gemini output from the spec", () => {
    expect(
      parseAnalyzerOutput({ tactics: ["bank_impersonation", "refund_overpayment", "urgency"], claims: [{ kind: "deposit", amount: 900 }] }),
    ).toEqual({ tactics: ["bank_impersonation", "refund_overpayment", "urgency"], claims: [{ kind: "deposit", amount: 900 }] });
  });

  it("drops unknown tactics and malformed claims", () => {
    expect(
      parseAnalyzerOutput({
        tactics: ["urgency", "flattery", 3, "urgency"],
        claims: [{ kind: "deposit" }, { kind: "bill", amount: 5 }, { kind: "lottery", amount: 1 }, null, { kind: "bill", payee: " DTE ", amount: "$412", overdue: true }],
      }),
    ).toEqual({ tactics: ["urgency"], claims: [{ kind: "bill", payee: "DTE", amount: 412, overdue: true }] });
  });

  it("keeps digitsSpoken only when it has 4+ digits", () => {
    expect(parseAnalyzerOutput({ digitsSpoken: "4417 1234" }).digitsSpoken).toBe("44171234");
    expect(parseAnalyzerOutput({ digitsSpoken: "12" }).digitsSpoken).toBeUndefined();
    expect(parseAnalyzerOutput({ digitsSpoken: "" }).digitsSpoken).toBeUndefined();
  });

  it("returns an empty result for junk", () => {
    expect(parseAnalyzerOutput(null)).toEqual({ tactics: [], claims: [] });
    expect(parseAnalyzerJson("not json")).toEqual({ tactics: [], claims: [] });
    expect(parseAnalyzerJson(undefined)).toEqual({ tactics: [], claims: [] });
  });
});

describe("claims", () => {
  it("claimKey treats a repeated claim as the same claim", () => {
    expect(claimKey({ kind: "deposit", amount: 900 })).toBe(claimKey({ kind: "deposit", amount: 900.2 }));
    expect(claimKey({ kind: "bill", payee: "DTE Energy", amount: 412 })).toBe(claimKey({ kind: "bill", payee: "dte  energy", amount: 412, overdue: true }));
    expect(claimKey({ kind: "charge", merchant: "Walmart", amount: 499 })).toBe(claimKey({ kind: "charge", merchant: "Walmart Supercenter", amount: 499, location: "TX" }));
    expect(claimKey({ kind: "deposit", amount: 900 })).not.toBe(claimKey({ kind: "deposit", amount: 950 }));
    expect(claimKey({ kind: "bill", payee: "DTE Energy" })).toBe(claimKey({ kind: "bill", payee: "DTE Energy", amount: 412 }));
  });

  it("mergeAnalyzerOutputs unions tactics and de-duplicates claims", () => {
    expect(
      mergeAnalyzerOutputs([
        { tactics: ["urgency"], claims: [{ kind: "deposit", amount: 900 }] },
        { tactics: ["urgency", "secrecy"], claims: [{ kind: "deposit", amount: 900 }], digitsSpoken: "1234" },
      ]),
    ).toEqual({ tactics: ["urgency", "secrecy"], claims: [{ kind: "deposit", amount: 900 }], digitsSpoken: "1234" });
  });

  it("describeClaim reads naturally", () => {
    expect(describeClaim({ kind: "deposit", amount: 900 })).toBe("$900 deposit");
    expect(describeClaim({ kind: "bill", payee: "DTE Energy", amount: 412, overdue: true })).toBe("DTE Energy bill of $412 overdue");
    expect(describeClaim({ kind: "charge", merchant: "Walmart", amount: 499, location: "Texas" })).toBe("$499 Walmart charge in Texas");
  });
});

describe("redaction", () => {
  it("masks full account and card numbers, keeping the last 4", () => {
    expect(redactDigits("It's 4417 1234 5678 1234.")).toBe("It's •••• 1234.");
    expect(redactDigits("card 4417-1234-5678-1234 ok")).toBe("card •••• 1234 ok");
    expect(redactDigits("4417123456781234")).toBe("•••• 1234");
  });

  it("leaves amounts, phone numbers, and short codes alone", () => {
    expect(redactDigits("Send $2,000 to 313-555-0142 by 6:42")).toBe("Send $2,000 to 313-555-0142 by 6:42");
    expect(redactDigits("the code is 482913")).toBe("the code is 482913");
  });

  it("keeps only the last 4 of digitsSpoken", () => {
    expect(redactAnalyzerOutput({ tactics: [], claims: [], digitsSpoken: "4417123456781234" })).toEqual({ tactics: [], claims: [], digitsSpoken: "1234" });
    expect(redactAnalyzerOutput({ tactics: ["urgency"], claims: [] })).toEqual({ tactics: ["urgency"], claims: [] });
  });
});

describe("transcriptWindow", () => {
  it("keeps the last 30 seconds, in order", () => {
    const lines = [{ atMs: 40_000 }, { atMs: 0 }, { atMs: 9_999 }, { atMs: 10_000 }, { atMs: 25_000 }];
    expect(transcriptWindow(lines).map((l) => l.atMs)).toEqual([10_000, 25_000, 40_000]);
    expect(transcriptWindow([])).toEqual([]);
  });
});

describe("dashboard rows", () => {
  const NOW = Date.UTC(2026, 9, 3);
  const data: AccountData = {
    account: { _id: "acct", type: "Checking", nickname: "n", balance: 1, customer_id: "c" },
    customer: null,
    deposits: [{ _id: "d1", amount: 1650, transaction_date: "2026-09-30", description: "Social Security" }],
    withdrawals: [
      { _id: "w1", amount: 60, transaction_date: "2026-09-24", description: "ATM withdrawal" },
      { _id: "w2", amount: 10, transaction_date: "2026-10-02", status: "cancelled" },
    ],
    purchases: [{ _id: "p1", amount: 23.4, purchase_date: "2026-10-02", merchant_id: "m1" }],
    transfers: [
      { _id: "t1", amount: 100, transaction_date: "2026-10-02", payer_id: "acct", payee_id: "other" },
      { _id: "t2", amount: 40, transaction_date: "2026-09-30", payer_id: "other", payee_id: "acct", description: "From Anna" },
    ],
    bills: [],
    merchantNames: { m1: "Stadium Hardware" },
  };

  it("buildActivity merges everything, newest first, with signed amounts", () => {
    expect(buildActivity(data).map((a) => [a.id, a.amount, a.description])).toEqual([
      ["t1", -100, "Transfer out"],
      ["p1", -23.4, "Stadium Hardware"],
      ["t2", 40, "From Anna"],
      ["d1", 1650, "Social Security"],
      ["w1", -60, "ATM withdrawal"],
    ]);
    expect(buildActivity(data, 2)).toHaveLength(2);
  });

  it("buildActivity handles the live transfer shape: `id`, no payer or payee, always money out", () => {
    const liveShape: AccountData = { ...data, deposits: [], withdrawals: [], purchases: [], transfers: [{ id: "x1", amount: 12, transaction_date: "2026-10-03", status: "completed", description: "Transfer to Nora" }] };
    expect(buildActivity(liveShape)).toEqual([{ id: "x1", kind: "transfer", date: "2026-10-03", description: "Transfer to Nora", amount: -12 }]);
  });

  it("buildActivity puts rows it has not seen before first within a day, then keeps the known order", () => {
    const sameDay: AccountData = {
      ...data, deposits: [], purchases: [], transfers: [],
      withdrawals: [
        { _id: "new", amount: 1, transaction_date: "2026-10-03" },
        { _id: "b", amount: 2, transaction_date: "2026-10-03" },
        { _id: "a", amount: 3, transaction_date: "2026-10-03" },
        { _id: "old", amount: 4, transaction_date: "2026-10-01" },
      ],
    };
    const known = new Map([["a", 0], ["b", 1], ["old", 2]]);
    expect(buildActivity(sameDay, 25, known).map((r) => r.id)).toEqual(["new", "a", "b", "old"]);
  });

  it("availableBalance applies the activity to the opening balance", () => {
    // 1 + 1650 - 60 - 23.4 - 100 + 40; the cancelled withdrawal is ignored.
    expect(availableBalance(data)).toBe(1507.6);
    expect(availableBalance({ ...data, deposits: [], withdrawals: [], purchases: [], transfers: [] })).toBe(1);
    expect(availableBalance({ ...data, deposits: [], withdrawals: [], purchases: [], transfers: [{ id: "x", amount: 1, status: "completed" }] })).toBe(0);
  });

  it("buildBills uses the upcoming date and drops cancelled bills", () => {
    expect(
      buildBills([
        { _id: "b1", status: "recurring", payee: "DTE Energy", payment_amount: 94, upcoming_payment_date: "2026-10-12" },
        { _id: "b2", status: "cancelled", payee: "Old Gym", payment_amount: 30, payment_date: "2026-10-01" },
        { _id: "b3", status: "pending", payee: "Water", payment_amount: 38, payment_date: "2026-10-08" },
      ]),
    ).toEqual([
      { id: "b3", payee: "Water", amount: 38, paymentDate: "2026-10-08", status: "pending" },
      { id: "b1", payee: "DTE Energy", amount: 94, paymentDate: "2026-10-12", status: "recurring" },
    ]);
  });

  it("resolveFixtureDates replaces @today tokens", () => {
    expect(resolveFixtureDates({ a: "@today", b: ["@today-3", "@today+9"], c: "keep", d: 4 }, NOW)).toEqual({
      a: "2026-10-03", b: ["2026-09-30", "2026-10-12"], c: "keep", d: 4,
    });
  });

  it("formatUsd", () => {
    expect([formatUsd(900), formatUsd(1650), formatUsd(94.5), formatUsd(-2000), formatUsd(0)]).toEqual(["$900", "$1,650", "$94.50", "-$2,000", "$0"]);
  });
});
