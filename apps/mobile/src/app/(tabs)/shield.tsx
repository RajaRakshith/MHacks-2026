import { tables } from "@watchdog/bindings";
import { useMemo, useState } from "react";
import * as Linking from "expo-linking";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTable } from "spacetimedb/react";
import { RiskMeter } from "../../components/RiskMeter";
import { Body, Card, Empty, Notice, Screen, SectionLabel, StatusPill } from "../../components/ui";
import { useTheme } from "../../lib/theme";
import { useShield } from "../../lib/useShield";

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

export default function ShieldScreen() {
  const t = useTheme();
  const { callSession: session, live, state } = useShield();
  const [segments] = useTable(tables.transcriptSegments);
  const [events] = useTable(tables.riskEvents);
  const [helpOpen, setHelpOpen] = useState(false);

  const score = session?.riskScore ?? 0;

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

  return (
    <Screen>
      <Card>
        <View style={{ alignItems: "flex-start" }}>
          <StatusPill state={state} />
        </View>
        <RiskMeter score={score} active={live} />
        {warnings.map((warning) => (
          <Notice key={warning.id.toString()} tone="critical" icon="warning" title={warning.warningMessage ?? ""} />
        ))}
      </Card>

      <Card>
        <SectionLabel>Live transcript</SectionLabel>
        {!session ? (
          <Empty>No call yet. Add Watchdog to a live call (Add Call, then Merge) using the Twilio number.</Empty>
        ) : lines.length === 0 ? (
          <Empty>Listening…</Empty>
        ) : (
          <View style={[styles.transcript, { backgroundColor: t.sunken }]} accessibilityLiveRegion="polite">
            {lines.map((line) => (
              <Text key={line.id.toString()} style={{ color: t.ink, fontSize: 15, lineHeight: 21 }}>{line.text}</Text>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <SectionLabel>Signals</SectionLabel>
        {signals.length === 0 ? (
          <Body muted>None yet.</Body>
        ) : (
          <View style={styles.chips}>
            {signals.map((signal) => (
              <View key={signal} style={[styles.chip, { borderColor: t.line, backgroundColor: t.sunken }]}>
                <Text style={{ color: t.ink, fontSize: 13, fontWeight: "500" }}>{signal}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <Pressable
          onPress={() => setHelpOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: helpOpen }}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: t.ink, fontSize: 15, fontWeight: "600" }}>How to add Watchdog</Text>
        </Pressable>
        {helpOpen && (
          <Body muted>
            Place or receive the call on your phone. Add a call to{" "}
            <Text
              accessibilityRole="link"
              accessibilityLabel="Call Watchdog at 906-767-6720"
              onPress={() => void Linking.openURL("tel:+19067676720")}
              style={{ color: t.brandStrong, textDecorationLine: "underline" }}
            >
              906-767-6720
            </Text>
            , then Merge. This screen only watches that call — it does not start one.
          </Body>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  transcript: { borderRadius: 12, padding: 12, gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
});
