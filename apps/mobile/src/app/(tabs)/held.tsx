import { tables } from "@watchdog/bindings";
import { DEMO_USER_ID } from "@watchdog/core";
import { Fragment, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTable } from "spacetimedb/react";
import { Body, Card, Divider, Empty, Screen, SectionLabel } from "../../components/ui";
import { usdCompact } from "../../lib/format";
import { useTheme } from "../../lib/theme";
import { useNow } from "../../lib/useNow";

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

export default function HeldScreen() {
  const t = useTheme();
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
    <Screen>
      <View style={[styles.protected, { backgroundColor: t.brandTint }]}>
        <SectionLabel>Money protected</SectionLabel>
        <Text style={[styles.total, { color: t.ink }]}>{usdCompact(protectedDollars)}</Text>
        <Body muted style={{ fontSize: 13 }}>Held or expired before the money was sent</Body>
      </View>

      <Card>
        <SectionLabel>On hold</SectionLabel>
        {waiting.length === 0 ? (
          <Empty>Nothing is on hold.</Empty>
        ) : (
          waiting.map((row) => {
            const left = timeLeft(row.expiresAt, now);
            return (
              <View key={row.id.toString()} style={[styles.hold, { borderColor: t.line }]}>
                <View style={styles.holdHead}>
                  <Text style={{ color: t.ink, fontSize: 22, fontWeight: "700" }}>{usdCompact(Number(row.amountCents) / 100)}</Text>
                  {left ? <Text style={{ color: t.muted, fontSize: 13 }}>{left}</Text> : null}
                </View>
                <Text style={{ color: t.ink, fontSize: 15 }}>to {row.destinationAccount}</Text>
                {row.memo ? <Body muted style={{ fontSize: 13 }}>Memo: {row.memo}</Body> : null}
                {row.holdReason ? <Body muted>{row.holdReason}</Body> : null}
              </View>
            );
          })
        )}
      </Card>

      {decided.length > 0 && (
        <Card>
          <SectionLabel>Decided</SectionLabel>
          <View>
            {decided.map((row, i) => (
              <Fragment key={row.id.toString()}>
                {i > 0 && <Divider />}
                <View style={styles.decided}>
                  <Text style={{ flex: 1, color: t.ink, fontSize: 15 }} numberOfLines={1}>
                    <Text style={{ fontWeight: "700" }}>{usdCompact(Number(row.amountCents) / 100)}</Text> to {row.destinationAccount}
                  </Text>
                  <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{row.status.tag}</Text>
                </View>
              </Fragment>
            ))}
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  protected: { borderRadius: 16, padding: 16, gap: 2 },
  total: { fontSize: 34, fontWeight: "700" },
  hold: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 3 },
  holdHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  decided: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11 },
});
