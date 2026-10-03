import { describe, expect, it } from "vitest";
import {
  MSG_CONFIRM_LARGE, MSG_HOLD_CASH, MSG_HOLD_METHOD, MSG_HOLD_NEW_PAYEE, MSG_WARN_FLAGGED,
  amountProblem, evaluateTransfer, isGuardArmed, isTrustedPayee, mentionsScamMethod, transferKindFor,
  type TransferContext, type TransferRequest,
} from "../src";

const req = (over: Partial<TransferRequest> = {}): TransferRequest => ({ payee: "Someone New", amount: 50, memo: "", kind: "transfer", ...over });
const armed: TransferContext = { guardArmed: true, payeeTrusted: false };
const armedTrusted: TransferContext = { guardArmed: true, payeeTrusted: true };
const off: TransferContext = { guardArmed: false, payeeTrusted: false };
const offTrusted: TransferContext = { guardArmed: false, payeeTrusted: true };

describe("evaluateTransfer: every row of the rules table (section 4)", () => {
  it("rule 1: guard armed, trusted payee -> allow, no message", () => {
    expect(evaluateTransfer(req({ payee: "Oakwood Apartments", amount: 1100 }), armedTrusted)).toEqual({ decision: "allow", rule: 1 });
  });

  it("rule 2: guard armed, new payee, $200 or more -> hold", () => {
    expect(evaluateTransfer(req({ amount: 200 }), armed)).toEqual({ decision: "hold", rule: 2, message: MSG_HOLD_NEW_PAYEE });
    expect(evaluateTransfer(req({ payee: "Account Services", amount: 2000 }), armed)).toEqual({
      decision: "hold", rule: 2, message: "Held: new payee during a suspicious call",
    });
  });

  it("rule 3: guard armed, cash withdrawal $500 or more -> hold", () => {
    expect(evaluateTransfer(req({ payee: "Cash", amount: 500, kind: "cash_withdrawal" }), armed)).toEqual({
      decision: "hold", rule: 3, message: "Held: large cash withdrawal during a suspicious call",
    });
    expect(evaluateTransfer(req({ payee: "Cash", amount: 900, kind: "cash_withdrawal" }), armed)).toMatchObject({ rule: 3, message: MSG_HOLD_CASH });
  });

  it("rule 4: guard armed, payee or memo mentions gift cards, crypto, or wire -> hold", () => {
    const expected = { decision: "hold", rule: 4, message: "Held: payment method common in scams" };
    expect(evaluateTransfer(req({ amount: 50, memo: "gift cards for my grandson" }), armed)).toEqual(expected);
    expect(evaluateTransfer(req({ amount: 50, memo: "crypto deposit" }), armed)).toEqual(expected);
    expect(evaluateTransfer(req({ amount: 50, memo: "wire fee" }), armed)).toEqual(expected);
    expect(evaluateTransfer(req({ payee: "Bitcoin Depot", amount: 50 }), armed)).toMatchObject({ rule: 4, message: MSG_HOLD_METHOD });
    expect(evaluateTransfer(req({ payee: "Cash", amount: 100, memo: "for gift card", kind: "cash_withdrawal" }), armed)).toMatchObject({ rule: 4 });
  });

  it("rule 5: guard armed, anything else -> allow with warning", () => {
    expect(evaluateTransfer(req({ amount: 199.99 }), armed)).toEqual({
      decision: "allow", rule: 5, message: "You're on a flagged call. Double-check this payment.",
    });
    expect(evaluateTransfer(req({ payee: "Cash", amount: 499, kind: "cash_withdrawal" }), armed)).toMatchObject({ rule: 5, message: MSG_WARN_FLAGGED });
  });

  it("rule 6: guard off, new payee, $2,000 or more -> needs confirmation", () => {
    expect(evaluateTransfer(req({ amount: 2000 }), off)).toEqual({
      decision: "needs_confirmation", rule: 6, message: "Large payment to a new payee. Continue?",
    });
    expect(evaluateTransfer(req({ amount: 7500 }), off)).toMatchObject({ rule: 6, message: MSG_CONFIRM_LARGE });
  });

  it("rule 7: otherwise -> allow, no message", () => {
    expect(evaluateTransfer(req({ amount: 1999.99 }), off)).toEqual({ decision: "allow", rule: 7 });
    expect(evaluateTransfer(req({ payee: "Oakwood Apartments", amount: 5000 }), offTrusted)).toEqual({ decision: "allow", rule: 7 });
    expect(evaluateTransfer(req({ payee: "Cash", amount: 3000, kind: "cash_withdrawal" }), off)).toEqual({ decision: "allow", rule: 7 });
  });
});

describe("evaluateTransfer: first matching rule wins", () => {
  it("a trusted payee is allowed even when the memo mentions gift cards (rule 1 before 4)", () => {
    expect(evaluateTransfer(req({ payee: "DTE Energy", amount: 94, memo: "not gift cards" }), armedTrusted)).toMatchObject({ decision: "allow", rule: 1 });
  });

  it("a large new-payee wire is held as a new payee (rule 2 before 4)", () => {
    expect(evaluateTransfer(req({ amount: 2000, memo: "wire" }), armed)).toMatchObject({ rule: 2 });
  });

  it("a small new-payee payment is not held below $200", () => {
    expect(evaluateTransfer(req({ amount: 199 }), armed)).toMatchObject({ decision: "allow", rule: 5 });
  });

  it("scam-method words do not hold anything when the guard is off", () => {
    expect(evaluateTransfer(req({ amount: 50, memo: "gift cards" }), off)).toEqual({ decision: "allow", rule: 7 });
  });

  it("the armed guard takes priority over the $2,000 confirmation", () => {
    expect(evaluateTransfer(req({ amount: 2000 }), armed).decision).toBe("hold");
  });
});

describe("helpers", () => {
  it("trusted payees: seeded, or paid twice or more", () => {
    expect(isTrustedPayee({ trusted: true, timesPaid: 0 })).toBe(true);
    expect(isTrustedPayee({ trusted: false, timesPaid: 2 })).toBe(true);
    expect(isTrustedPayee({ trusted: false, timesPaid: 1 })).toBe(false);
    expect(isTrustedPayee(null)).toBe(false);
    expect(isTrustedPayee(undefined)).toBe(false);
  });

  it("amountProblem refuses zero, cents, and more than the balance", () => {
    expect(amountProblem(2000, 8400)).toBeNull();
    expect(amountProblem(8400, 8400)).toBeNull();
    expect(amountProblem(0, 8400)).toBe("Enter an amount greater than $0.");
    expect(amountProblem(-5, 8400)).toBe("Enter an amount greater than $0.");
    expect(amountProblem(Number.NaN, 8400)).toBe("Enter an amount greater than $0.");
    expect(amountProblem(12.34, 8400)).toBe("Enter a whole-dollar amount. This account cannot send cents.");
    expect(amountProblem(8401, 8400)).toBe("Not enough money in the account.");
    expect(amountProblem(50, undefined)).toBeNull();
  });

  it("guard is armed only before armed_until", () => {
    expect(isGuardArmed(1000, 999)).toBe(true);
    expect(isGuardArmed(1000, 1000)).toBe(false);
    expect(isGuardArmed(0, 5)).toBe(false);
  });

  it("recognises scam payment methods", () => {
    for (const s of ["Gift card", "giftcards", "gift-cards", "CRYPTO wallet", "wire transfer", "send a wire"]) expect(mentionsScamMethod(s)).toBe(true);
    for (const s of ["rent", "birthday gift", "rewire the kitchen", ""]) expect(mentionsScamMethod(s)).toBe(false);
  });

  it("treats a Cash or ATM payee as a cash withdrawal", () => {
    expect(transferKindFor("Cash")).toBe("cash_withdrawal");
    expect(transferKindFor(" cash withdrawal ")).toBe("cash_withdrawal");
    expect(transferKindFor("ATM")).toBe("cash_withdrawal");
    expect(transferKindFor("Cashmere Shop")).toBe("transfer");
    expect(transferKindFor("Account Services")).toBe("transfer");
  });
});
