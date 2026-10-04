import type { ShieldState, Tactic } from "./types";

/**
 * Points per tactic. Each counts once per call.
 */
// SPEC-QUESTION: section 3.2 has nine tactics worth 10 to 25. By request the
// list is longer and the weights are higher, on the principle "better safe
// than sorry": one clear scam signal plus any pressure should reach Caution,
// and `clear_scam` (the analyzer's own overall verdict) carries the most.
export const TACTIC_POINTS: Record<Tactic, number> = {
  clear_scam: 40,
  unusual_payment: 30,
  credential_request: 30,
  safe_account: 30,
  remote_access: 25,
  legal_threat: 25,
  family_emergency: 25,
  prize_or_lottery: 25,
  bank_impersonation: 20,
  government_impersonation: 20,
  tech_support: 20,
  personal_info_request: 20,
  investment_pitch: 20,
  romance: 20,
  job_or_advance_fee: 20,
  secrecy: 20,
  refund_overpayment: 20,
  business_impersonation: 15,
  utility_impersonation: 15,
  urgency: 15,
  stay_on_line: 15,
  charity_appeal: 10,
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
