import { tables } from "@scamshield/bindings";
import { useMemo } from "react";
import { useTable } from "spacetimedb/react";
import { shortDay, signedUsd, usd, usdCompact } from "../lib/format";
import { SendMoney } from "./SendMoney";
import { Empty, Panel, SectionLabel } from "./ui";

const BILL_STATUS: Record<string, string> = { pending: "Pending", completed: "Paid", recurring: "Recurring", cancelled: "Cancelled" };

export function AccountPanel() {
  const [snapshots, ready] = useTable(tables.accountSnapshot);
  const [activity] = useTable(tables.activity);
  const [bills] = useTable(tables.bill);
  const [configs] = useTable(tables.config);

  const snapshot = snapshots[0];
  const recent = useMemo(() => [...activity].sort((a, b) => a.sortIndex - b.sortIndex).slice(0, 10), [activity]);
  const upcoming = useMemo(() => [...bills].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate)), [bills]);
  const supportsPurchases = configs[0]?.supportsPurchases ?? false;

  return (
    <Panel title="Account">
      {!snapshot ? (
        <Empty>{ready ? "No account loaded yet. Is the relay running?" : "Loading account…"}</Empty>
      ) : (
        <div>
          <p className="text-base font-semibold text-ink">{snapshot.name}</p>
          <p className="text-sm text-muted">
            {snapshot.nickname} <span className="tabular-nums">•••• {snapshot.last4}</span>
          </p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Available balance</p>
          <p className="text-5xl font-semibold leading-tight tracking-tight text-ink">{usd(snapshot.balance)}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel>Recent activity</SectionLabel>
        {recent.length === 0 ? (
          <Empty>No activity yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="w-12 shrink-0 text-xs text-muted">{shortDay(item.date)}</span>
                <span className="min-w-0 flex-1 truncate text-ink" title={item.description}>{item.description}</span>
                <span className="shrink-0 font-medium tabular-nums text-ink">{signedUsd(item.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {!supportsPurchases && recent.length > 0 && <p className="text-xs text-muted">Card purchases are not available from this API.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Upcoming bills</SectionLabel>
        {upcoming.length === 0 ? (
          <Empty>No bills.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.map((bill) => (
              <li key={bill.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{bill.payee}</span>
                  <span className="text-xs text-muted">
                    {bill.paymentDate ? shortDay(bill.paymentDate) : "No date"} · {BILL_STATUS[bill.status] ?? bill.status}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums text-ink">{usdCompact(bill.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <SendMoney />
      </div>
    </Panel>
  );
}
