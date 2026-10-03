import { procedures, reducers, tables } from "@scamshield/bindings";
import type { Call } from "@scamshield/bindings/types";
import { SHIELD_STATE_LABELS, TACTIC_LABELS, describeClaim, isGuardArmed, type Claim, type ShieldState, type Tactic } from "@scamshield/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useProcedure, useReducer, useTable } from "spacetimedb/react";
import { clock } from "../lib/format";
import { postRelay } from "../lib/relay";
import { useNow } from "../lib/useNow";
import { RiskMeter } from "./RiskMeter";
import { Button, Empty, Icon, Panel, SectionLabel } from "./ui";

const SCENARIOS: { id: string; label: string }[] = [
  { id: "refund-overpayment", label: "Refund overpayment" },
  { id: "fake-fraud-alert", label: "Fake fraud alert" },
  { id: "utility-shutoff", label: "Utility shutoff" },
  { id: "legit-pharmacy", label: "Legit pharmacy call" },
];

const PILL: Record<ShieldState, { dot: string; fill: string }> = {
  idle: { dot: "bg-idle", fill: "bg-idle-track" },
  listening: { dot: "bg-good pulse-dot", fill: "bg-good-track" },
  caution: { dot: "bg-warning", fill: "bg-warning-track" },
  scam_likely: { dot: "bg-critical", fill: "bg-critical-track" },
};

function StatusPill({ state }: { state: ShieldState }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-ink ${PILL[state].fill}`} role="status">
      <span className={`size-2 rounded-full ${PILL[state].dot}`} aria-hidden="true" />
      {SHIELD_STATE_LABELS[state]}
    </span>
  );
}

function parseClaim(json: string): Claim | null {
  try {
    return JSON.parse(json) as Claim;
  } catch {
    return null;
  }
}

/** The call to show: the open call if there is one, otherwise the most recent call. */
function pickCall(calls: readonly Call[]): Call | null {
  let open: Call | null = null;
  let latest: Call | null = null;
  for (const call of calls) {
    if (!latest || call.id > latest.id) latest = call;
    if (call.endedAt === undefined && (!open || call.id > open.id)) open = call;
  }
  return open ?? latest;
}

export function ShieldPanel() {
  const [calls] = useTable(tables.call);
  const [transcript] = useTable(tables.transcript);
  const [tacticHits] = useTable(tables.tacticHit);
  const [verdicts] = useTable(tables.verdict);
  const [alerts] = useTable(tables.alert);
  const [guards] = useTable(tables.guard);
  const [configs] = useTable(tables.config);

  const endCall = useReducer(reducers.endCall);
  const armGuard = useReducer(reducers.armGuard);
  const refreshAccount = useProcedure(procedures.refreshAccount);

  const now = useNow();
  const [scenario, setScenario] = useState(SCENARIOS[0]!.id);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const mock = configs[0]?.mock ?? true;
  const call = pickCall(calls);
  const live = call !== null && call.endedAt === undefined;
  const state: ShieldState = live ? (call.state as ShieldState) : "idle";

  const lines = useMemo(
    () => (call ? transcript.filter((l) => l.callId === call.id).sort((a, b) => a.atMs - b.atMs || Number(a.id - b.id)) : []),
    [transcript, call],
  );
  const tactics = useMemo(() => (call ? tacticHits.filter((t) => t.callId === call.id).sort((a, b) => Number(a.id - b.id)) : []), [tacticHits, call]);
  const claims = useMemo(() => (call ? verdicts.filter((v) => v.callId === call.id).sort((a, b) => Number(a.id - b.id)) : []), [verdicts, call]);
  const callAlerts = useMemo(() => (call ? alerts.filter((a) => a.callId === call.id).sort((a, b) => Number(b.id - a.id)) : []), [alerts, call]);

  const armedUntil = guards[0]?.armedUntil.toDate();
  const armed = armedUntil !== undefined && isGuardArmed(armedUntil.getTime(), now);

  // Keep the newest line in view.
  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = transcriptEnd.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines.length]);

  async function startCall(path: "/protect" | "/simulate") {
    setBusy(true);
    setNotice(null);
    const reply = await postRelay(path, mock ? { scenario } : {});
    setBusy(false);
    if (!reply.ok) setNotice(reply.error ?? "Could not start the call.");
    else if (reply.message) setNotice(reply.message);
  }

  async function onEndCall() {
    if (!call) return;
    await endCall({ callId: call.id });
    void refreshAccount();
  }

  const warning = callAlerts.find((a) => a.kind === "digits_match") ?? callAlerts[0];
  const warningTone = warning?.kind === "caution" ? "border-warning bg-warning-track" : "border-critical bg-critical-track";

  return (
    <Panel title="ScamShield" aside={<StatusPill state={state} />}>
      <RiskMeter score={call?.score ?? 0} active={call !== null} />
      {call && !live && <p className="-mt-3 text-xs text-muted">Last call ended {call.endedAt ? clock(call.endedAt.toDate()) : ""}. Results are kept below.</p>}

      {warning && (
        <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-ink ${warningTone}`} role="alert">
          <span className="mt-0.5 shrink-0">{Icon.warn}</span>
          <p className="font-medium">{warning.message}</p>
        </div>
      )}

      {armed && armedUntil && (
        <p className="flex items-center gap-2 rounded-lg bg-brand-tint px-3 py-2 text-sm font-medium text-ink">
          <span className="text-brand-strong">{Icon.lock}</span>
          Transfers protected until {clock(armedUntil)}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel>Live transcript</SectionLabel>
        {lines.length === 0 ? (
          <Empty>{live ? "Listening…" : "No call yet. Press Protect this call when a call feels wrong."}</Empty>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg bg-sunken p-3" aria-live="polite">
            <ol className="flex flex-col gap-2.5">
              {lines.map((line) => (
                <li key={line.id.toString()} className="grid grid-cols-[3.75rem_1fr] gap-2 text-sm leading-snug">
                  <span className={`pt-0.5 text-xs font-semibold uppercase tracking-wide ${line.speaker === "caller" ? "text-ink" : "text-brand-strong"}`}>
                    {line.speaker === "caller" ? "Caller" : "You"}
                  </span>
                  <span className="text-ink">{line.text}</span>
                </li>
              ))}
            </ol>
            <div ref={transcriptEnd} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Detected tactics</SectionLabel>
        {tactics.length === 0 ? (
          <p className="text-sm text-muted">None detected.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {tactics.map((hit) => (
              <li key={hit.id.toString()} className="rounded-full border border-line bg-sunken px-2.5 py-1 text-xs font-medium text-ink">
                {TACTIC_LABELS[hit.tactic as Tactic] ?? hit.tactic}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Claim checks</SectionLabel>
        {claims.length === 0 ? (
          <p className="text-sm text-muted">Nothing the caller said has been checked against your account yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {claims.map((row) => {
              const claim = parseClaim(row.claimJson);
              return (
                <li key={row.id.toString()} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-ink">{claim ? describeClaim(claim) : "Claim"}</span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-ink ${row.claimTrue ? "bg-good-track" : "bg-critical-track"}`}
                    >
                      <span className={row.claimTrue ? "text-good" : "text-critical"}>{row.claimTrue ? Icon.check : Icon.cross}</span>
                      {row.claimTrue ? "True" : "False"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{row.evidence}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2.5 border-t border-line pt-4">
        <Button variant="primary" onClick={() => void startCall("/protect")} disabled={busy || live} className="w-full py-2.5">
          {Icon.shield}
          Protect this call
        </Button>

        {mock && (
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="scenario">Scenario</label>
            <select
              id="scenario"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-ink"
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <Button onClick={() => void startCall("/simulate")} disabled={busy}>Simulate call</Button>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={() => void onEndCall()} disabled={!live} className="flex-1">End call</Button>
          <Button onClick={() => void armGuard()} className="flex-1">I'm on a suspicious call</Button>
        </div>

        {notice && <p className="text-sm text-muted" role="status">{notice}</p>}
      </div>
    </Panel>
  );
}
