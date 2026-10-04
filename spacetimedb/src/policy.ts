// spacetimedb/src/policy.ts
export const HOLD_TTL_MS = 4 * 60 * 60 * 1000;
export const BANK_HOLD_REASON =
  'Come to the bank to complete this transfer. Watchdog is holding it for 4 hours because this call looks like a scam.';

export function shouldHold(hasActiveSession: boolean, riskScore: number, threshold: number): boolean {
  return hasActiveSession && riskScore >= threshold;
}

export function holdExpiresAtMs(requestedAtMs: number): number {
  return requestedAtMs + HOLD_TTL_MS;
}

export function canExpireHeld(
  status: string,
  expiresAtMs: number | null,
  nowMs: number
): boolean {
  return status === 'Held' && expiresAtMs !== null && nowMs >= expiresAtMs;
}
