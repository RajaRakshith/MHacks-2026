import { procedures, reducers, tables } from "@scamshield/bindings";
import { TACTIC_LABELS, describeClaim, type Claim, type Tactic } from "@scamshield/core";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useProcedure, useReducer, useTable } from "spacetimedb/react";
import { RiskMeter } from "../../components/RiskMeter";
import { Body, Button, Card, Empty, Notice, Screen, SectionLabel, StatusPill } from "../../components/ui";
import { clock } from "../../lib/format";
import { postRelay } from "../../lib/relay";
import { useTheme } from "../../lib/theme";
import { useShield } from "../../lib/useShield";

const SCENARIOS: { id: string; label: string }[] = [
  { id: "refund-overpayment", label: "Refund overpayment" },
  { id: "fake-fraud-alert", label: "Fake fraud alert" },
  { id: "utility-shutoff", label: "Utility shutoff" },
  { id: "legit-pharmacy", label: "Legit pharmacy call" },
];

/** A phone screen is short: show the newest lines and let the customer open the rest. */
const VISIBLE_LINES = 5;

function parseClaim(json: string): Claim | null {
  try {
    return JSON.parse(json) as Claim;
  } catch {
    return null;
  }
}

export default function ShieldScreen() {
  const t = useTheme();
  const shield = useShield();
  const { call, live, state, mock } = shield;
  const [transcript] = useTable(tables.transcript);
  const [tacticHits] = useTable(tables.tacticHit);
  const [verdicts] = useTable(tables.verdict);
  const [alerts] = useTable(tables.alert);

  const endCall = useReducer(reducers.endCall);
  const armGuard = useReducer(reducers.armGuard);
  const refreshAccount = useProcedure(procedures.refreshAccount);

  const [scenario, setScenario] = useState(SCENARIOS[0]!.id);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const lines = useMemo(
    () => (call ? transcript.filter((l) => l.callId === call.id).sort((a, b) => a.atMs - b.atMs || Number(a.id - b.id)) : []),
    [transcript, call],
  );
  const tactics = useMemo(() => (call ? tacticHits.filter((h) => h.callId === call.id).sort((a, b) => Number(a.id - b.id)) : []), [tacticHits, call]);
  const claims = useMemo(() => (call ? verdicts.filter((v) => v.callId === call.id).sort((a, b) => Number(a.id - b.id)) : []), [verdicts, call]);
  const callAlerts = useMemo(() => (call ? alerts.filter((a) => a.callId === call.id).sort((a, b) => Number(b.id - a.id)) : []), [alerts, call]);

  const hidden = showAll ? 0 : Math.max(0, lines.length - VISIBLE_LINES);
  const visible = lines.slice(hidden);
  const warning = callAlerts.find((a) => a.kind === "digits_match") ?? callAlerts[0];

  async function startCall(path: "/protect" | "/simulate") {
    setBusy(true);
    setNotice(null);
    setShowAll(false);
    const reply = await postRelay(path, { scenario });
    setBusy(false);
    if (!reply.ok) setNotice(reply.error ?? "Could not start the call.");
    else if (reply.message) setNotice(reply.message);
  }

  /** A blank conversation: ends the open call and starts an empty one. */
  async function onReset() {
    setBusy(true);
    setNotice(null);
    setShowAll(false);
    const reply = await postRelay("/type/reset", {});
    setBusy(false);
    setNotice(reply.ok ? "New conversation started." : reply.error ?? "Could not reset.");
  }

  async function onEndCall() {
    if (!call) return;
    try {
      await endCall({ callId: call.id });
      void refreshAccount();
    } catch {
      setNotice("Could not end the call.");
    }
  }

  return (
    <Screen>
      <Card>
        <View style={{ alignItems: "flex-start" }}>
          <StatusPill state={state} />
        </View>
        <RiskMeter score={call?.score ?? 0} active={call !== null} />
        {call && !live && <Body muted>Last call ended {call.endedAt ? clock(call.endedAt.toDate()) : ""}. Results are kept below.</Body>}

        {warning && <Notice tone={warning.kind === "caution" ? "warning" : "critical"} icon="warning" title={warning.message} />}
        {shield.armed && shield.armedUntil && <Notice tone="brand" icon="lock-closed" title={`Transfers protected until ${clock(shield.armedUntil)}`} />}

        <Button variant="primary" icon="shield-checkmark" label="Protect this call" onPress={() => void startCall("/protect")} disabled={busy || live} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button label="End call" onPress={() => void onEndCall()} disabled={!live} style={{ flex: 1 }} />
          <Button label="I'm on a suspicious call" onPress={() => void armGuard().catch(() => setNotice("Could not arm the guard."))} style={{ flex: 2 }} />
        </View>
        <Button label="Reset conversation" icon="refresh" onPress={() => void onReset()} disabled={busy} />
        {notice && <Body muted>{notice}</Body>}
      </Card>

      <Card>
        <SectionLabel>Live transcript</SectionLabel>
        {lines.length === 0 ? (
          <Empty>{live ? "Listening…" : "No call yet. Press Protect this call when a call feels wrong."}</Empty>
        ) : (
          <View style={[styles.transcript, { backgroundColor: t.sunken }]}>
            {hidden > 0 && (
              <Pressable onPress={() => setShowAll(true)} accessibilityRole="button" style={{ minHeight: 32, justifyContent: "center" }}>
                <Text style={{ color: t.brandStrong, fontSize: 13, fontWeight: "600" }}>Show {hidden} earlier line{hidden === 1 ? "" : "s"}</Text>
              </Pressable>
            )}
            {visible.map((line) => (
              <View key={line.id.toString()} style={styles.line}>
                <Text style={[styles.speaker, { color: line.speaker === "caller" ? t.ink : t.brandStrong }]}>{line.speaker === "caller" ? "Caller" : "You"}</Text>
                <Text style={{ flex: 1, color: t.ink, fontSize: 15, lineHeight: 21 }}>{line.text}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <SectionLabel>Detected tactics</SectionLabel>
        {tactics.length === 0 ? (
          <Body muted>None detected.</Body>
        ) : (
          <View style={styles.chips}>
            {tactics.map((hit) => (
              <View key={hit.id.toString()} style={[styles.chip, { borderColor: t.line, backgroundColor: t.sunken }]}>
                <Text style={{ color: t.ink, fontSize: 13, fontWeight: "500" }}>{TACTIC_LABELS[hit.tactic as Tactic] ?? hit.tactic}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <SectionLabel>Claim checks</SectionLabel>
        {claims.length === 0 ? (
          <Body muted>Nothing the caller said has been checked against your account yet.</Body>
        ) : (
          claims.map((row) => {
            const claim = parseClaim(row.claimJson);
            return (
              <View key={row.id.toString()} style={[styles.claim, { borderColor: t.line }]}>
                <View style={styles.claimHead}>
                  <Text style={{ flex: 1, color: t.ink, fontSize: 15, fontWeight: "600" }}>{claim ? describeClaim(claim) : "Claim"}</Text>
                  <View style={[styles.badge, { backgroundColor: row.claimTrue ? t.goodTrack : t.criticalTrack }]}>
                    <Ionicons name={row.claimTrue ? "checkmark" : "close"} size={14} color={row.claimTrue ? t.good : t.critical} />
                    <Text style={{ color: t.ink, fontSize: 13, fontWeight: "700" }}>{row.claimTrue ? "True" : "False"}</Text>
                  </View>
                </View>
                <Body muted>{row.evidence}</Body>
              </View>
            );
          })
        )}
      </Card>

      {(
        <Card>
          <SectionLabel>{mock ? "Simulate a call (mock mode)" : "Play a scripted call"}</SectionLabel>
          <View style={styles.chips}>
            {SCENARIOS.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => setScenario(s.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: scenario === s.id }}
                style={[styles.chip, styles.scenario, { borderColor: scenario === s.id ? t.brand : t.line, backgroundColor: scenario === s.id ? t.brandTint : t.sunken }]}
              >
                <Text style={{ color: t.ink, fontSize: 14, fontWeight: scenario === s.id ? "700" : "500" }}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
          <Button label="Simulate call" onPress={() => void startCall("/simulate")} disabled={busy} />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  transcript: { borderRadius: 12, padding: 12, gap: 10 },
  line: { flexDirection: "row", gap: 10 },
  speaker: { width: 54, paddingTop: 3, fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  scenario: { minHeight: 40, justifyContent: "center" },
  claim: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 },
  claimHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
});
