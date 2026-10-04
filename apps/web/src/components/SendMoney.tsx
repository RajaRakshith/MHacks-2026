import { reducers, tables } from "@watchdog/bindings";
import { DEMO_USER_ID, dollarsToCents } from "@watchdog/core";
import { useMemo, useState, type FormEvent } from "react";
import { useReducer, useSpacetimeDB, useTable } from "spacetimedb/react";
import { usdCompact } from "../lib/format";
import { Button, SectionLabel } from "./ui";

const field = "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-2 focus:outline-offset-1 focus:outline-brand";

const STATUS_TONE: Record<string, string> = {
  Held: "border-critical bg-critical-track",
  Approved: "border-line bg-good-track",
  Completed: "border-line bg-good-track",
  Failed: "border-critical bg-critical-track",
  Expired: "border-warning bg-warning-track",
};

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Could not send this transfer.";
}

export function SendMoney() {
  const { isActive } = useSpacetimeDB();
  const [payees] = useTable(tables.payees);
  const [intents] = useTable(tables.transferIntents);
  const requestTransfer = useReducer(reducers.requestTransfer);

  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watermark, setWatermark] = useState<bigint | null>(null);

  const saved = useMemo(() => [...payees].sort((a, b) => a.name.localeCompare(b.name)), [payees]);

  const newest = useMemo(() => {
    if (watermark === null) return null;
    let best: (typeof intents)[number] | null = null;
    for (const row of intents) {
      if (row.userId !== DEMO_USER_ID || row.id <= watermark) continue;
      if (!best || row.id > best.id) best = row;
    }
    return best;
  }, [intents, watermark]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isActive) {
      setError("Cannot reach the database. Start everything with pnpm dev.");
      return;
    }
    if (!payee.trim()) {
      setError("Choose or enter a payee before sending.");
      return;
    }
    let maxId = -1n;
    for (const row of intents) {
      if (row.userId === DEMO_USER_ID && row.id > maxId) maxId = row.id;
    }
    setBusy(true);
    try {
      await requestTransfer({
        userId: DEMO_USER_ID,
        amountCents: dollarsToCents(Number(amount)),
        destinationAccount: payee.trim(),
        memo: memo.trim() || undefined,
      });
      setWatermark(maxId);
      setAmount("");
      setMemo("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const tone = newest ? (STATUS_TONE[newest.status.tag] ?? "border-line bg-sunken") : "";

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Send money</SectionLabel>

      <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
        <div>
          <label htmlFor="payee" className="mb-1 block text-xs font-medium text-muted">Payee</label>
          <input
            id="payee"
            list="saved-payees"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="Saved payee or account"
            autoComplete="off"
            required
            className={field}
          />
          <datalist id="saved-payees">
            {saved.map((p) => (
              <option key={p.name} value={p.name} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-5 gap-2.5">
          <div className="col-span-2">
            <label htmlFor="amount" className="mb-1 block text-xs font-medium text-muted">Amount</label>
            <input
              id="amount"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              required
              className={`${field} tabular-nums`}
            />
          </div>
          <div className="col-span-3">
            <label htmlFor="memo" className="mb-1 block text-xs font-medium text-muted">Memo</label>
            <input id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional" autoComplete="off" className={field} />
          </div>
        </div>

        <Button type="submit" variant="primary" disabled={busy}>{busy ? "Sending…" : "Send"}</Button>
      </form>

      {error && (
        <p className="rounded-lg border border-critical bg-critical-track px-3 py-2.5 text-sm text-ink" role="alert">{error}</p>
      )}

      {newest && (
        <div className={`rounded-lg border px-3 py-2.5 text-sm text-ink ${tone}`} role="status">
          <p className="font-semibold">{newest.status.tag}</p>
          <p className="mt-1">
            {usdCompact(Number(newest.amountCents) / 100)} to {newest.destinationAccount}
          </p>
          {newest.holdReason && <p className="mt-1">{newest.holdReason}</p>}
          {newest.memo && <p className="mt-1 text-xs text-muted">Memo: {newest.memo}</p>}
        </div>
      )}
    </div>
  );
}
