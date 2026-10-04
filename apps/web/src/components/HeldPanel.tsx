import { tables } from "@watchdog/bindings";
import { DEMO_USER_ID } from "@watchdog/core";
import { useMemo } from "react";
import { useTable } from "spacetimedb/react";
import { usdCompact } from "../lib/format";
import { useNow } from "../lib/useNow";
import { Empty, Panel, SectionLabel } from "./ui";

const DECIDED = new Set(["Completed", "Failed", "Expired", "Released"]);

function timeLeft(expiresAt: { toDate(): Date } | undefined, now: number): string | null {
  if (!expiresAt) return null;
  const remaining = expiresAt.toDate().getTime() - now;
  if (remaining <= 0) return "0 min left";
  const totalMinutes = Math.max(1, Math.ceil(remaining / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min left`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr left` : `${hours} hr ${minutes} min left`;
}

export function HeldPanel() {
  const [intents] = useTable(tables.transferIntents);
  const now = useNow();

  const mine = useMemo(
    () => intents.filter((row) => row.userId === DEMO_USER_ID).sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)),
    [intents],
  );
  const waiting = mine.filter((row) => row.status.tag === "Held");
  const decided = mine.filter((row) => DECIDED.has(row.status.tag));
  const protectedDollars = useMemo(() => {
    let cents = 0n;
    for (const row of mine) {
      if (row.status.tag === "Held" || row.status.tag === "Expired") cents += row.amountCents;
    }
    return Number(cents) / 100;
  }, [mine]);

  return (
    <Panel title="Held transactions">
      <div className="rounded-xl bg-brand-tint px-4 py-3.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Money protected</p>
        <p className="mt-1 text-3xl font-semibold text-ink">{usdCompact(protectedDollars)}</p>
        <p className="mt-0.5 text-xs text-muted">Held or expired before the money was sent</p>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>On hold</SectionLabel>
        {waiting.length === 0 ? (
          <Empty>Nothing is on hold.</Empty>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {waiting.map((row) => {
              const left = timeLeft(row.expiresAt, now);
              return (
                <li key={row.id.toString()} className="rounded-lg border border-line p-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-semibold text-ink">{usdCompact(Number(row.amountCents) / 100)}</span>
                    {left && <span className="text-xs text-muted">{left}</span>}
                  </div>
                  <p className="text-sm text-ink">to {row.destinationAccount}</p>
                  {row.memo && <p className="text-xs text-muted">Memo: {row.memo}</p>}
                  {row.holdReason && <p className="mt-1.5 text-sm text-muted">{row.holdReason}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {decided.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Decided</SectionLabel>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {decided.map((row) => (
              <li key={row.id.toString()} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                <span className="min-w-0 truncate text-ink">
                  <span className="font-medium tabular-nums">{usdCompact(Number(row.amountCents) / 100)}</span> to {row.destinationAccount}
                </span>
                <span className="shrink-0 text-xs font-medium text-muted">{row.status.tag}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
