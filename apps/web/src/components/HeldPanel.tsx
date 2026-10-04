import { procedures, reducers, tables } from "@scamshield/bindings";
import { useMemo, useState } from "react";
import { useProcedure, useReducer, useTable } from "spacetimedb/react";
import { ago, usdCompact } from "../lib/format";
import { useNow } from "../lib/useNow";
import { Button, Empty, Panel, SectionLabel } from "./ui";

const STATUS_LABEL: Record<string, string> = { approved: "Approved and sent", rejected: "Rejected", expired: "Expired" };

export function HeldPanel() {
  const [holds] = useTable(tables.hold);
  const approveHold = useProcedure(procedures.approveHold);
  const rejectHold = useReducer(reducers.rejectHold);
  const now = useNow();
  const [busy, setBusy] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => [...holds].sort((a, b) => Number(b.id - a.id)), [holds]);
  const waiting = sorted.filter((h) => h.status === "held");
  const decided = sorted.filter((h) => h.status !== "held");
  // Money protected: held plus rejected amounts.
  const protectedTotal = holds.filter((h) => h.status === "held" || h.status === "rejected").reduce((sum, h) => sum + h.amount, 0);

  async function approve(id: bigint) {
    setBusy(id);
    setError(null);
    try {
      const result = await approveHold({ holdId: id });
      if (result.outcome !== "sent") setError(result.message);
    } catch {
      setError("Could not approve this transfer.");
    }
    setBusy(null);
  }

  async function reject(id: bigint) {
    setBusy(id);
    setError(null);
    try {
      await rejectHold({ holdId: id });
    } catch {
      setError("Could not reject this transfer.");
    }
    setBusy(null);
  }

  return (
    <Panel title="Held transactions">
      <div className="rounded-xl bg-brand-tint px-4 py-3.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Money protected</p>
        <p className="mt-1 text-3xl font-semibold text-ink">{usdCompact(protectedTotal)}</p>
        <p className="mt-0.5 text-xs text-muted">Held or rejected while ScamShield was on guard</p>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Waiting for approval</SectionLabel>
        {waiting.length === 0 ? (
          <Empty>Nothing is on hold.</Empty>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {waiting.map((hold) => {
              const expired = hold.expiresAt.toDate().getTime() <= now;
              return (
                <li key={hold.id.toString()} className="rounded-lg border border-line p-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-semibold text-ink">{usdCompact(hold.amount)}</span>
                    <span className="text-xs text-muted">Held {ago(hold.createdAt.toDate(), now)}</span>
                  </div>
                  <p className="text-sm text-ink">to {hold.payee}</p>
                  {hold.memo && <p className="text-xs text-muted">Memo: {hold.memo}</p>}
                  <p className="mt-1.5 text-sm text-muted">{hold.reason}</p>
                  <div className="mt-3 flex gap-2">
                    {/* In the MVP, Approve stands in for family approval. */}
                    <Button onClick={() => void approve(hold.id)} disabled={busy === hold.id || expired} className="flex-1">Approve</Button>
                    <Button variant="danger" onClick={() => void reject(hold.id)} disabled={busy === hold.id || expired} className="flex-1">Reject</Button>
                  </div>
                  {expired && <p className="mt-2 text-xs text-muted">This hold has expired.</p>}
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="text-sm text-ink" role="alert">{error}</p>}
      </div>

      {decided.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Decided</SectionLabel>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {decided.map((hold) => (
              <li key={hold.id.toString()} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                <span className="min-w-0 truncate text-ink">
                  <span className="font-medium tabular-nums">{usdCompact(hold.amount)}</span> to {hold.payee}
                </span>
                <span className="shrink-0 text-xs font-medium text-muted">{STATUS_LABEL[hold.status] ?? hold.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
