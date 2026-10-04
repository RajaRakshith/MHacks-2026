export type Speaker = "caller" | "customer";

// The first nine are from the spec. The rest were added so more kinds of scam are caught.
export type Tactic =
  | "bank_impersonation" | "government_impersonation" | "urgency" | "secrecy"
  | "unusual_payment" | "remote_access" | "credential_request" | "stay_on_line"
  | "refund_overpayment"
  | "business_impersonation" | "utility_impersonation" | "tech_support" | "legal_threat"
  | "safe_account" | "personal_info_request" | "family_emergency" | "prize_or_lottery"
  | "investment_pitch" | "romance" | "job_or_advance_fee" | "charity_appeal" | "clear_scam"
  // Reassuring signals. These lower the score.
  | "likely_legit" | "invites_verification";

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
  "business_impersonation", "utility_impersonation", "tech_support", "legal_threat",
  "safe_account", "personal_info_request", "family_emergency", "prize_or_lottery",
  "investment_pitch", "romance", "job_or_advance_fee", "charity_appeal", "clear_scam",
  "likely_legit", "invites_verification",
];

/** Signals that make a call look safer. They lower the score and never count once the call is judged a clear scam. */
export const REASSURING: readonly Tactic[] = ["likely_legit", "invites_verification"];

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
  business_impersonation: "Company impersonation",
  utility_impersonation: "Utility impersonation",
  tech_support: "Fake tech support",
  legal_threat: "Threat of arrest or lawsuit",
  safe_account: "Move money to a \"safe\" account",
  personal_info_request: "Asks for personal details",
  family_emergency: "Family emergency story",
  prize_or_lottery: "Prize or lottery",
  investment_pitch: "Investment pitch",
  romance: "Romance or friendship ask",
  job_or_advance_fee: "Job offer or upfront fee",
  charity_appeal: "Charity appeal",
  clear_scam: "AI verdict: clear scam",
  likely_legit: "AI verdict: looks ordinary",
  invites_verification: "Invites you to verify",
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
