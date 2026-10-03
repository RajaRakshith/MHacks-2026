import type { ShieldState, Tactic } from "./types";

/** Section 3.2. Each tactic counts once per call. */
export const TACTIC_POINTS: Record<Tactic, number> = {
  unusual_payment: 25,
  credential_request: 25,
  remote_access: 20,
  bank_impersonation: 15,
  government_impersonation: 15,
  secrecy: 15,
  refund_overpayment: 15,
  urgency: 10,
  stay_on_line: 10,
};

export const CLAIM_FALSE_POINTS = 30;
export const CLAIM_TRUE_POINTS = -10;
export const REPORTED_NUMBER_POINTS = 20;
export const DIGITS_MATCH_POINTS = 25;

export const CAUTION_THRESHOLD = 40;
export const SCAM_THRESHOLD = 70;

/** Crossing SCAM_THRESHOLD (or pressing "I'm on a suspicious call") arms the guard for this long. */
export const GUARD_ARM_MS = 4 * 60 * 60 * 1000;

export interface ScoreInput {
  /** Tactics detected so far in the call. Duplicates are ignored. */
  tactics: readonly Tactic[];
  /** One entry per verified claim. */
  verdicts: readonly { claimTrue: boolean }[];
  /** Caller number is in the reported-scams list. */
  callerReported: boolean;
  /** The customer read 4+ digits matching their real account. */
  digitsMatched: boolean;
}

/** Sum of every signal, clamped to 0..100. */
export function scoreCall(input: ScoreInput): number {
  let total = 0;
  for (const tactic of new Set(input.tactics)) total += TACTIC_POINTS[tactic] ?? 0;
  for (const verdict of input.verdicts) total += verdict.claimTrue ? CLAIM_TRUE_POINTS : CLAIM_FALSE_POINTS;
  if (input.callerReported) total += REPORTED_NUMBER_POINTS;
  if (input.digitsMatched) total += DIGITS_MATCH_POINTS;
  return Math.max(0, Math.min(100, total));
}

/** State of a call in progress. `idle` is "no call" and never comes from a score. */
export function stateForScore(score: number): Exclude<ShieldState, "idle"> {
  if (score >= SCAM_THRESHOLD) return "scam_likely";
  if (score >= CAUTION_THRESHOLD) return "caution";
  return "listening";
}

/** True when a score moved from below `threshold` to at or above it. */
export function crossed(previous: number, next: number, threshold: number): boolean {
  return previous < threshold && next >= threshold;
}

/** Meter color band: green below 40, amber 40 to 69, red 70 and up. */
export function meterBand(score: number): "green" | "amber" | "red" {
  if (score >= SCAM_THRESHOLD) return "red";
  if (score >= CAUTION_THRESHOLD) return "amber";
  return "green";
}
