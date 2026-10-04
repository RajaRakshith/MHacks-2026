import { tables } from "@watchdog/bindings";
import { DEMO_USER_ID, SHIELD_STATE_LABELS, shieldState, type ShieldState } from "@watchdog/core";
import { useEffect, useMemo, useRef } from "react";
import { useTable } from "spacetimedb/react";
import { RiskMeter } from "./RiskMeter";
import { Empty, Icon, Panel, SectionLabel } from "./ui";

const PILL: Record<ShieldState, { dot: string; fill: string }> = {
  idle: { dot: "bg-idle", fill: "bg-idle-track" },
  listening: { dot: "bg-good pulse-dot", fill: "bg-good-track" },
  caution: { dot: "bg-warning", fill: "bg-warning-track" },
  scam_likely: { dot: "bg-critical", fill: "bg-critical-track" },
};

type Timed = { occurredAt: { microsSinceUnixEpoch: bigint }; id: bigint };

function compareTimeThenId(a: Timed, b: Timed): number {
  const at = a.occurredAt.microsSinceUnixEpoch;
  const bt = b.occurredAt.microsSinceUnixEpoch;
  if (at < bt) return -1;
  if (at > bt) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function StatusPill({ state }: { state: ShieldState }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-ink ${PILL[state].fill}`} role="status">
      <span className={`size-2 rounded-full ${PILL[state].dot}`} aria-hidden="true" />
      {SHIELD_STATE_LABELS[state]}
    </span>
  );
}

export function ShieldPanel() {
  const [sessions] = useTable(tables.callSessions);
  const [segments] = useTable(tables.transcriptSegments);
  const [events] = useTable(tables.riskEvents);

  const session = useMemo(() => {
    let active: (typeof sessions)[number] | null = null;
    for (const row of sessions) {
      if (row.userId !== DEMO_USER_ID || row.status.tag !== "Active") continue;
      if (!active || row.id > active.id) active = row;
    }
    return active;
  }, [sessions]);

  const live = session !== null;
  const score = session?.riskScore ?? 0;
  const state = shieldState(live, score);

  const lines = useMemo(
    () => (session ? segments.filter((row) => row.sessionId === session.id).sort(compareTimeThenId) : []),
    [segments, session],
  );
  const sessionEvents = useMemo(
    () => (session ? events.filter((row) => row.sessionId === session.id) : []),
    [events, session],
  );
  const warnings = useMemo(
    () =>
      sessionEvents
        .filter((row) => typeof row.warningMessage === "string" && row.warningMessage.length > 0)
        .sort((a, b) => compareTimeThenId(b, a)),
    [sessionEvents],
  );
  const signals = useMemo(() => {
    const seen = new Set<string>();
    const chips: string[] = [];
    for (const row of [...sessionEvents].sort(compareTimeThenId)) {
      if (seen.has(row.signalType)) continue;
      seen.add(row.signalType);
      chips.push(row.signalType);
    }
    return chips;
  }, [sessionEvents]);

  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = transcriptEnd.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines.length]);

  return (
    <Panel title="Watchdog" aside={<StatusPill state={state} />}>
      <RiskMeter score={score} active={live} />

      {warnings.map((warning) => (
        <div key={warning.id.toString()} className="flex gap-2.5 rounded-lg border border-critical bg-critical-track px-3 py-2.5 text-sm text-ink" role="alert">
          <span className="mt-0.5 shrink-0">{Icon.warn}</span>
          <p className="font-medium">{warning.warningMessage}</p>
        </div>
      ))}

      <div className="flex flex-col gap-2">
        <SectionLabel>Live transcript</SectionLabel>
        {!session ? (
          <Empty>No call yet. Add Watchdog to a live call (Add Call, then Merge) using the Twilio number.</Empty>
        ) : lines.length === 0 ? (
          <Empty>Listening…</Empty>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg bg-sunken p-3" aria-live="polite">
            <ol className="flex flex-col gap-2.5">
              {lines.map((line) => (
                <li key={line.id.toString()} className="text-sm leading-snug text-ink">{line.text}</li>
              ))}
            </ol>
            <div ref={transcriptEnd} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Signals</SectionLabel>
        {signals.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {signals.map((signal) => (
              <li key={signal} className="rounded-full border border-line bg-sunken px-2.5 py-1 text-xs font-medium text-ink">
                {signal}
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="text-sm text-ink">
        <summary className="cursor-pointer font-medium">How to add Watchdog</summary>
        <p className="mt-2 text-muted">
          Place or receive the call on your phone. Add a call to the Watchdog Twilio number, then Merge. This screen only watches that call — it does not start one.
        </p>
      </details>
    </Panel>
  );
}
