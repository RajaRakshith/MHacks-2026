import { procedures, tables } from "@scamshield/bindings";
import { accountBaseline, describeClaim, evidenceFor, formatUsd, isTrustedPayee, nextRealBill, unusualFor, type Claim } from "@scamshield/core";
import { useMemo, useState } from "react";
import { useProcedure, useTable } from "spacetimedb/react";
import { shortDay } from "../lib/format";
import { useNow } from "../lib/useNow";
import { Button, Panel, SectionLabel } from "./ui";

function parseClaim(json: string): Claim | null {
  try {
    return JSON.parse(json) as Claim;
  } catch {
    return null;
  }
}

/**
 * A separate read of the customer's Nessie data: what is normal for her, how
 * held payments compare to that, the real records behind each claim check,
 * and the bill she actually owes.
 */
export function AnalysisPanel() {
  const [activity] = useTable(tables.activity);
  const [bills] = useTable(tables.bill);
  const [payees] = useTable(tables.payee);
  const [holds] = useTable(tables.hold);
  const [verdicts] = useTable(tables.verdict);
  const [calls] = useTable(tables.call);
  const [snapshots] = useTable(tables.accountSnapshot);
  const [configs] = useTable(tables.config);
  const requestTransfer = useProcedure(procedures.requestTransfer);
  const now = useNow(60_000);
  const [paying, setPaying] = useState(false);
  const [payNote, setPayNote] = useState<string | null>(null);

  const ordered = useMemo(() => [...activity].sort((a, b) => a.sortIndex - b.sortIndex), [activity]);
  const baseline = useMemo(() => accountBaseline(ordered, now), [ordered, now]);
  const firstName = snapshots[0]?.name.split(" ")[0] ?? "this customer";
  const mock = configs[0]?.mock ?? true;

  const waiting = holds.filter((h) => h.status === "held").sort((a, b) => Number(b.id - a.id));
  const isKnown = (name: string): boolean => isTrustedPayee(payees.find((p) => p.name.toLowerCase() === name.toLowerCase()));

  const latestCall = calls.reduce<bigint | null>((max, c) => (max === null || c.id > max ? c.id : max), null);
  const claims = verdicts.filter((v) => v.callId === latestCall).sort((a, b) => Number(a.id - b.id));
  const bill = nextRealBill(bills);

  async function payBill() {
    if (!bill) return;
    setPaying(true);
    setPayNote(null);
    try {
      const result = await requestTransfer({ payee: bill.payee, amount: Math.round(bill.amount), memo: "Bill payment", confirmed: undefined });
      setPayNote(result.outcome === "sent" ? `Paid ${formatUsd(Math.round(bill.amount))} to ${bill.payee}.` : result.message);
    } catch {
      setPayNote("Could not pay the bill.");
    }
    setPaying(false);
  }

  return (
    <Panel title="Account analysis" aside={<span className="text-xs font-medium text-muted">{mock ? "Mock data" : "Live from Nessie"}</span>}>
      <div className="flex flex-col gap-2">
        <SectionLabel>Normal for {firstName}</SectionLabel>
        {baseline.paymentsOut === 0 ? (
          <p className="text-sm text-muted">No payment history yet.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted">Largest payment on record</dt>
              <dd className="font-semibold text-ink">{baseline.largestOut ? formatUsd(baseline.largestOut.amount) : "None"}</dd>
              {baseline.largestOut && <dd className="truncate text-xs text-muted" title={baseline.largestOut.description}>{baseline.largestOut.description}</dd>}
            </div>
            <div>
              <dt className="text-xs text-muted">Typical payment</dt>
              <dd className="font-semibold text-ink">{formatUsd(baseline.typicalOut)}</dd>
              <dd className="text-xs text-muted">median of {baseline.paymentsOut}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">In, last 30 days</dt>
              <dd className="font-semibold text-ink">{formatUsd(baseline.in30)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Out, last 30 days</dt>
              <dd className="font-semibold text-ink">{formatUsd(baseline.out30)}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Held payments against her pattern</SectionLabel>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted">Nothing is on hold.</p>
        ) : (
          waiting.map((hold) => {
            const reasons = unusualFor(hold.amount, isKnown(hold.payee), baseline);
            return (
              <div key={hold.id.toString()} className="rounded-lg border border-line p-3">
                <p className="text-sm font-semibold text-ink">{formatUsd(hold.amount)} to {hold.payee}</p>
                {reasons.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">In line with her usual payments.</p>
                ) : (
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                    {reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Records behind the claim checks</SectionLabel>
        {claims.length === 0 ? (
          <p className="text-sm text-muted">No claims checked on the latest call.</p>
        ) : (
          claims.map((row) => {
            const claim = parseClaim(row.claimJson);
            if (!claim) return null;
            return (
              <div key={row.id.toString()} className="rounded-lg border border-line p-3">
                <p className="text-sm text-ink">
                  Caller said: <span className="font-semibold">{describeClaim(claim)}</span>
                </p>
                <p className="mt-1.5 text-xs font-medium text-muted">Her account shows:</p>
                <ul className="mt-0.5 text-sm text-ink">
                  {evidenceFor(claim, ordered, bills).map((line) => (
                    <li key={line} className="tabular-nums">{line}</li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>The bill she really owes</SectionLabel>
        {!bill ? (
          <p className="text-sm text-muted">No bills due.</p>
        ) : (
          <div className="rounded-lg bg-brand-tint p-3">
            <p className="text-sm text-ink">
              <span className="font-semibold">{bill.payee}: {formatUsd(bill.amount)}</span>
              {bill.paymentDate ? `, due ${shortDay(bill.paymentDate)}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-muted">If a caller names a different amount or a new way to pay, this is the real one.</p>
            <Button onClick={() => void payBill()} disabled={paying} className="mt-2">{paying ? "Paying…" : "Pay this bill"}</Button>
            {payNote && <p className="mt-2 text-sm text-ink" role="status">{payNote}</p>}
          </div>
        )}
      </div>

      <p className="text-xs text-muted">Built from Nessie accounts, deposits, withdrawals, transfers, purchases, merchants, and bills.</p>
    </Panel>
  );
}
