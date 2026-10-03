import { procedures, tables } from "@scamshield/bindings";
import type { TransferResult } from "@scamshield/bindings/types";
import { useState, type FormEvent } from "react";
import { useProcedure, useTable } from "spacetimedb/react";
import { usdCompact } from "../lib/format";
import { Button, Icon, SectionLabel } from "./ui";

const CASH = "Cash withdrawal";

interface Sent {
  payee: string;
  amount: number;
  result: TransferResult;
}

const field = "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-2 focus:outline-offset-1 focus:outline-brand";

/**
 * Every transfer goes through the request_transfer procedure, which runs the
 * guard rules before anything reaches Nessie. The result shows inline as
 * Sent, Held (with reason), or Needs confirmation.
 */
export function SendMoney() {
  const [payees] = useTable(tables.payee);
  const [configs] = useTable(tables.config);
  const requestTransfer = useProcedure(procedures.requestTransfer);

  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Sent | null>(null);

  const supportsTransfers = configs[0]?.supportsTransfers ?? false;
  const saved = [...payees].sort((a, b) => a.name.localeCompare(b.name));

  async function submit(confirmed: boolean) {
    const value = Number(amount);
    setBusy(true);
    try {
      const result = await requestTransfer({ payee: payee.trim(), amount: value, memo: memo.trim(), confirmed: confirmed ? true : undefined });
      setLast({ payee: payee.trim(), amount: value, result });
      if (result.outcome === "sent" || result.outcome === "held") {
        setAmount("");
        setMemo("");
      }
    } catch {
      setLast({ payee: payee.trim(), amount: value, result: { outcome: "error", message: "Could not reach the bank. Try again.", rule: 0, viaWithdrawal: false } });
    }
    setBusy(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <SectionLabel>Send money</SectionLabel>
        {!supportsTransfers && (
          <span
            className="cursor-help text-muted"
            tabIndex={0}
            title="Nessie's transfer endpoint is not available, so money you send is posted as a withdrawal described “Transfer to <payee>”."
            aria-label="Money you send is posted as a withdrawal described Transfer to payee, because Nessie's transfer endpoint is not available."
          >
            {Icon.info}
          </span>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
        <div>
          <label htmlFor="payee" className="mb-1 block text-xs font-medium text-muted">Payee</label>
          <input
            id="payee"
            list="saved-payees"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="Pick a saved payee or type a new name"
            autoComplete="off"
            required
            className={field}
          />
          <datalist id="saved-payees">
            {saved.map((p) => (
              <option key={p.name} value={p.name} />
            ))}
            <option value={CASH} />
          </datalist>
        </div>

        <div className="grid grid-cols-5 gap-2.5">
          <div className="col-span-2">
            <label htmlFor="amount" className="mb-1 block text-xs font-medium text-muted">Amount</label>
            <input
              id="amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
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

      {last && <Result sent={last} busy={busy} onConfirm={() => void submit(true)} onCancel={() => setLast(null)} />}
    </div>
  );
}

function Result({ sent, busy, onConfirm, onCancel }: { sent: Sent; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { result } = sent;
  const what = `${usdCompact(sent.amount)} to ${sent.payee}`;

  if (result.outcome === "sent") {
    return (
      <div className="rounded-lg border border-line bg-good-track px-3 py-2.5 text-sm text-ink" role="status">
        <p className="flex items-center gap-1.5 font-semibold">
          <span className="text-good">{Icon.check}</span>
          Sent: {what}
        </p>
        {result.message && <p className="mt-1">{result.message}</p>}
        {result.viaWithdrawal && <p className="mt-1 text-xs text-muted">Posted as a withdrawal described “Transfer to {sent.payee}”.</p>}
      </div>
    );
  }

  if (result.outcome === "held") {
    return (
      <div className="rounded-lg border border-critical bg-critical-track px-3 py-2.5 text-sm text-ink" role="alert">
        <p className="flex items-center gap-1.5 font-semibold">
          {Icon.lock}
          Held: {what}
        </p>
        <p className="mt-1">{result.message}</p>
        <p className="mt-1 text-xs text-muted">It will not be sent unless a trusted contact approves it.</p>
      </div>
    );
  }

  if (result.outcome === "needs_confirmation") {
    return (
      <div className="rounded-lg border border-warning bg-warning-track px-3 py-2.5 text-sm text-ink" role="alert">
        <p className="flex items-center gap-1.5 font-semibold">
          {Icon.warn}
          Needs confirmation: {what}
        </p>
        <p className="mt-1">{result.message}</p>
        <div className="mt-2.5 flex gap-2">
          <Button onClick={onConfirm} disabled={busy}>Continue</Button>
          <Button variant="quiet" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-sunken px-3 py-2.5 text-sm text-ink" role="alert">
      <p className="font-semibold">Not sent</p>
      <p className="mt-1">{result.message}</p>
    </div>
  );
}
