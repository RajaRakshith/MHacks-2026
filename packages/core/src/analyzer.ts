/** Pure helpers around the call analyzer: parsing, merging, de-duplication, and redaction. */

import { formatUsd } from "./nessie";
import { TACTICS, type AnalyzerOutput, type Claim, type Tactic } from "./types";

/** The analyzer looks at roughly the last 30 seconds of the call. */
export const ANALYSIS_WINDOW_MS = 30_000;

const isTactic = (v: unknown): v is Tactic => typeof v === "string" && (TACTICS as readonly string[]).includes(v);

const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/[$,]/g, "")))) return Number(v.replace(/[$,]/g, ""));
  return undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

function parseClaim(raw: unknown): Claim | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const amount = num(r.amount);
  switch (r.kind) {
    case "deposit":
      return amount === undefined ? null : { kind: "deposit", amount };
    case "bill": {
      const payee = str(r.payee);
      if (!payee) return null;
      const claim: Claim = { kind: "bill", payee };
      if (amount !== undefined) claim.amount = amount;
      if (typeof r.overdue === "boolean") claim.overdue = r.overdue;
      return claim;
    }
    case "charge": {
      const claim: Claim = { kind: "charge" };
      const merchant = str(r.merchant);
      const location = str(r.location);
      if (merchant) claim.merchant = merchant;
      if (amount !== undefined) claim.amount = amount;
      if (location) claim.location = location;
      return claim;
    }
    default:
      return null;
  }
}

/**
 * Turns untrusted JSON (Gemini output or fixture labels) into an AnalyzerOutput.
 * Unknown tactics and malformed claims are dropped rather than rejected.
 */
export function parseAnalyzerOutput(raw: unknown): AnalyzerOutput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tactics = Array.isArray(r.tactics) ? [...new Set(r.tactics.filter(isTactic))] : [];
  const claims = Array.isArray(r.claims) ? r.claims.map(parseClaim).filter((c): c is Claim => c !== null) : [];
  const out: AnalyzerOutput = { tactics, claims };
  const digits = str(r.digitsSpoken)?.replace(/\D/g, "");
  if (digits && digits.length >= 4) out.digitsSpoken = digits;
  return out;
}

/** Same as parseAnalyzerOutput, from a JSON string. Bad JSON gives an empty result. */
export function parseAnalyzerJson(json: string | null | undefined): AnalyzerOutput {
  if (!json) return { tactics: [], claims: [] };
  try {
    return parseAnalyzerOutput(JSON.parse(json));
  } catch {
    return { tactics: [], claims: [] };
  }
}

/**
 * Identity of a claim within one call. The same claim repeated in a later
 * analysis window must not be verified or scored twice.
 */
export function claimKey(claim: Claim): string {
  const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  switch (claim.kind) {
    case "deposit":
      return `deposit:${Math.round(claim.amount)}`;
    case "bill":
      return `bill:${key(claim.payee)}:${claim.amount === undefined ? "" : Math.round(claim.amount)}`;
    case "charge":
      return `charge:${claim.amount === undefined ? key(claim.merchant ?? "") : Math.round(claim.amount)}`;
  }
}

export function mergeAnalyzerOutputs(outputs: readonly AnalyzerOutput[]): AnalyzerOutput {
  const tactics = new Set<Tactic>();
  const claims = new Map<string, Claim>();
  let digitsSpoken: string | undefined;
  for (const o of outputs) {
    for (const t of o.tactics) tactics.add(t);
    for (const c of o.claims) if (!claims.has(claimKey(c))) claims.set(claimKey(c), c);
    if (o.digitsSpoken) digitsSpoken = o.digitsSpoken;
  }
  const out: AnalyzerOutput = { tactics: [...tactics], claims: [...claims.values()] };
  if (digitsSpoken) out.digitsSpoken = digitsSpoken;
  return out;
}

/** Short label for a claim, shown next to its True or False badge. */
export function describeClaim(claim: Claim): string {
  switch (claim.kind) {
    case "deposit":
      return `${formatUsd(claim.amount)} deposit`;
    case "bill":
      return [claim.payee, "bill", claim.amount !== undefined ? `of ${formatUsd(claim.amount)}` : "", claim.overdue ? "overdue" : ""].filter(Boolean).join(" ");
    case "charge":
      return [claim.amount !== undefined ? formatUsd(claim.amount) : "", claim.merchant ?? "", "charge", claim.location ? `in ${claim.location}` : ""].filter(Boolean).join(" ");
  }
}

/** Lines within `windowMs` of the newest line. */
export function transcriptWindow<T extends { atMs: number }>(lines: readonly T[], windowMs = ANALYSIS_WINDOW_MS): T[] {
  let latest = 0;
  for (const l of lines) if (l.atMs > latest) latest = l.atMs;
  return lines.filter((l) => l.atMs >= latest - windowMs).sort((a, b) => a.atMs - b.atMs);
}

const LONG_DIGIT_RUN = /\d(?:[\s-]?\d){11,}/g;

/**
 * Masks anything that looks like a full account or card number (12+ digits,
 * spaces and dashes allowed), keeping the last 4: "4417 1234 5678 1234" -> "•••• 1234".
 * Full numbers must never be stored or logged.
 */
export function redactDigits(text: string): string {
  return text.replace(LONG_DIGIT_RUN, (run) => `•••• ${run.replace(/\D/g, "").slice(-4)}`);
}

/** Keeps only the last 4 digits of `digitsSpoken`, so labels never carry a full number. */
export function redactAnalyzerOutput(output: AnalyzerOutput): AnalyzerOutput {
  if (!output.digitsSpoken) return output;
  return { ...output, digitsSpoken: output.digitsSpoken.replace(/\D/g, "").slice(-4) };
}
