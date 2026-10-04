import { procedures, reducers, tables } from "@scamshield/bindings";
import { Fragment, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useProcedure, useReducer, useTable } from "spacetimedb/react";
import { Body, Button, Card, Divider, Empty, Screen, SectionLabel } from "../../components/ui";
import { ago, usdCompact } from "../../lib/format";
import { useTheme } from "../../lib/theme";
import { useNow } from "../../lib/useNow";

const STATUS_LABEL: Record<string, string> = { approved: "Approved and sent", rejected: "Rejected", expired: "Expired" };

export default function HeldScreen() {
  const t = useTheme();
  const [holds] = useTable(tables.hold);
  const approveHold = useProcedure(procedures.approveHold);
  const rejectHold = useReducer(reducers.rejectHold);
  const now = useNow();
  const [busy, setBusy] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => [...holds].sort((a, b) => Number(b.id - a.id)), [holds]);
  const waiting = sorted.filter((h) => h.status === "held");
  const decided = sorted.filter((h) => h.status !== "held");
  // Money protected: held plus rejected amounts.
  const protectedTotal = holds.filter((h) => h.status === "held" || h.status === "rejected").reduce((sum, h) => sum + h.amount, 0);

  async function approve(id: bigint) {
    setBusy(id);
    setError(null);
    try {
      const result = await approveHold({ holdId: id });
      if (result.outcome !== "sent") setError(result.message);
    } catch {
      setError("Could not approve this transfer.");
    }
    setBusy(null);
  }

  async function reject(id: bigint) {
    setBusy(id);
    setError(null);
    try {
      await rejectHold({ holdId: id });
    } catch {
      setError("Could not reject this transfer.");
    }
    setBusy(null);
  }

  return (
    <Screen>
      <View style={[styles.protected, { backgroundColor: t.brandTint }]}>
        <SectionLabel>Money protected</SectionLabel>
        <Text style={[styles.total, { color: t.ink }]}>{usdCompact(protectedTotal)}</Text>
        <Body muted style={{ fontSize: 13 }}>Held or rejected while ScamShield was on guard</Body>
      </View>

      <Card>
        <SectionLabel>Waiting for approval</SectionLabel>
        {waiting.length === 0 ? (
          <Empty>Nothing is on hold.</Empty>
        ) : (
          waiting.map((hold) => {
            const expired = hold.expiresAt.toDate().getTime() <= now;
            return (
              <View key={hold.id.toString()} style={[styles.hold, { borderColor: t.line }]}>
                <View style={styles.holdHead}>
                  <Text style={{ color: t.ink, fontSize: 22, fontWeight: "700" }}>{usdCompact(hold.amount)}</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>Held {ago(hold.createdAt.toDate(), now)}</Text>
                </View>
                <Text style={{ color: t.ink, fontSize: 15 }}>to {hold.payee}</Text>
                {hold.memo ? <Body muted style={{ fontSize: 13 }}>Memo: {hold.memo}</Body> : null}
                <Body muted>{hold.reason}</Body>
                {/* In the MVP, Approve stands in for family approval. */}
                <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                  <Button label="Approve" onPress={() => void approve(hold.id)} disabled={busy === hold.id || expired} style={{ flex: 1 }} />
                  <Button variant="danger" label="Reject" onPress={() => void reject(hold.id)} disabled={busy === hold.id || expired} style={{ flex: 1 }} />
                </View>
                {expired && <Body muted style={{ fontSize: 13 }}>This hold has expired.</Body>}
              </View>
            );
          })
        )}
        {error && <Body>{error}</Body>}
      </Card>

      {decided.length > 0 && (
        <Card>
          <SectionLabel>Decided</SectionLabel>
          <View>
            {decided.map((hold, i) => (
              <Fragment key={hold.id.toString()}>
                {i > 0 && <Divider />}
                <View style={styles.decided}>
                  <Text style={{ flex: 1, color: t.ink, fontSize: 15 }} numberOfLines={1}>
                    <Text style={{ fontWeight: "700" }}>{usdCompact(hold.amount)}</Text> to {hold.payee}
                  </Text>
                  <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{STATUS_LABEL[hold.status] ?? hold.status}</Text>
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
