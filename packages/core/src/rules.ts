/** Section 4: transaction rules. First matching rule wins. */

export type TransferKind = "transfer" | "cash_withdrawal";

export interface TransferRequest {
  payee: string;
  amount: number;
  memo: string;
  kind: TransferKind;
}

export interface TransferContext {
  guardArmed: boolean;
  /** Seeded as trusted, or paid twice or more before. See isTrustedPayee. */
  payeeTrusted: boolean;
}

export type TransferDecision =
  | { decision: "allow"; rule: 1 | 5 | 7; message?: string }
  | { decision: "hold"; rule: 2 | 3 | 4; message: string }
  | { decision: "needs_confirmation"; rule: 6; message: string };

export const NEW_PAYEE_HOLD_MIN = 200;
export const CASH_HOLD_MIN = 500;
export const NEW_PAYEE_CONFIRM_MIN = 2000;
export const TRUSTED_AFTER_PAYMENTS = 2;
export const HOLD_TTL_MS = 24 * 60 * 60 * 1000;

export const MSG_HOLD_NEW_PAYEE = "Held: new payee during a suspicious call";
export const MSG_HOLD_CASH = "Held: large cash withdrawal during a suspicious call";
export const MSG_HOLD_METHOD = "Held: payment method common in scams";
export const MSG_WARN_FLAGGED = "You're on a flagged call. Double-check this payment.";
export const MSG_CONFIRM_LARGE = "Large payment to a new payee. Continue?";

/** Trusted payees: the seeded list plus any payee paid twice or more before. */
export function isTrustedPayee(payee: { trusted: boolean; timesPaid: number } | null | undefined): boolean {
  if (!payee) return false;
  return payee.trusted || payee.timesPaid >= TRUSTED_AFTER_PAYMENTS;
}

/**
 * Why an amount cannot be sent, or null when it can. Nessie stores whole
 * dollars and silently drops the cents, so cents are refused up front.
 */
export function amountProblem(amount: number, balance: number | undefined): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount greater than $0.";
  if (!Number.isInteger(amount)) return "Enter a whole-dollar amount. This account cannot send cents.";
  if (balance !== undefined && amount > balance) return "Not enough money in the account.";
  return null;
}

export function isGuardArmed(armedUntilMs: number, nowMs: number): boolean {
  return armedUntilMs > nowMs;
}

const SCAM_METHOD = /gift\s*-?\s*cards?|crypto|bitcoin|\bwire/i;

/** True when the payee or memo mentions gift cards, crypto, or wire. */
export function mentionsScamMethod(text: string): boolean {
  return SCAM_METHOD.test(text);
}

// SPEC-QUESTION: the send-money form has no "cash" field, so a payee named
// "Cash", "Cash withdrawal", or "ATM" is treated as a cash withdrawal.
export function transferKindFor(payee: string): TransferKind {
  return /^\s*(cash(\s+withdrawal)?|atm(\s+withdrawal)?)\s*$/i.test(payee) ? "cash_withdrawal" : "transfer";
}

export function evaluateTransfer(req: TransferRequest, ctx: TransferContext): TransferDecision {
  const isCash = req.kind === "cash_withdrawal";
  // SPEC-QUESTION: "new payee" is read as "not trusted": never seeded and paid
  // fewer than twice. A cash withdrawal has no payee, so it is never "new".
  const newPayee = !isCash && !ctx.payeeTrusted;

  if (ctx.guardArmed) {
    if (!isCash && ctx.payeeTrusted) return { decision: "allow", rule: 1 };
    if (newPayee && req.amount >= NEW_PAYEE_HOLD_MIN) return { decision: "hold", rule: 2, message: MSG_HOLD_NEW_PAYEE };
    if (isCash && req.amount >= CASH_HOLD_MIN) return { decision: "hold", rule: 3, message: MSG_HOLD_CASH };
    if (mentionsScamMethod(`${req.payee} ${req.memo}`)) return { decision: "hold", rule: 4, message: MSG_HOLD_METHOD };
    return { decision: "allow", rule: 5, message: MSG_WARN_FLAGGED };
  }

  if (newPayee && req.amount >= NEW_PAYEE_CONFIRM_MIN) {
    return { decision: "needs_confirmation", rule: 6, message: MSG_CONFIRM_LARGE };
  }
  return { decision: "allow", rule: 7 };
}
