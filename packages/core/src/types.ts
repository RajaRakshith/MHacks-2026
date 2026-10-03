export type Speaker = "caller" | "customer";

export type Tactic =
  | "bank_impersonation" | "government_impersonation" | "urgency" | "secrecy"
  | "unusual_payment" | "remote_access" | "credential_request" | "stay_on_line"
  | "refund_overpayment";

export type Claim =
  | { kind: "charge"; merchant?: string; amount?: number; location?: string }
  | { kind: "deposit"; amount: number }
  | { kind: "bill"; payee: string; amount?: number; overdue?: boolean };

export interface Verdict { claim: Claim; claimTrue: boolean; evidence: string }

export interface AnalyzerOutput { tactics: Tactic[]; claims: Claim[]; digitsSpoken?: string }

export type ShieldState = "idle" | "listening" | "caution" | "scam_likely";

export const TACTICS: readonly Tactic[] = [
  "bank_impersonation", "government_impersonation", "urgency", "secrecy",
  "unusual_payment", "remote_access", "credential_request", "stay_on_line",
  "refund_overpayment",
];

/** Chip text shown in the ScamShield panel. */
export const TACTIC_LABELS: Record<Tactic, string> = {
  bank_impersonation: "Bank impersonation",
  government_impersonation: "Government impersonation",
  urgency: "Urgency",
  secrecy: "Secrecy",
  unusual_payment: "Gift cards, wire, or crypto",
  remote_access: "Remote access",
  credential_request: "Asks for PIN or card number",
  stay_on_line: "Stay on the line",
  refund_overpayment: "Refund overpayment",
};

export const SHIELD_STATE_LABELS: Record<ShieldState, string> = {
  idle: "Idle",
  listening: "Listening",
  caution: "Caution",
  scam_likely: "Scam likely",
};

/** One line of a scripted call (fixtures/calls/<scenario>.json). */
export interface FixtureLine {
  atMs: number;
  speaker: Speaker;
  text: string;
  labels?: AnalyzerOutput;
}

export interface CallFixture {
  scenario: string;
  callerNumber: string;
  lines: FixtureLine[];
}
