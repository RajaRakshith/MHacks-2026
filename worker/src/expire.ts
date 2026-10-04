import { canExpireHeld } from '../../spacetimedb/src/policy.ts';

export function dueHoldIds(
  rows: { id: bigint; status: { tag: string }; expiresAtMs: number | null }[],
  nowMs: number
): bigint[] {
  return rows.filter((r) => canExpireHeld(r.status.tag, r.expiresAtMs, nowMs)).map((r) => r.id);
}
