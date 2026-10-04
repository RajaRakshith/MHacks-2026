import { tables } from "@scamshield/bindings";
import { router } from "expo-router";
import { Fragment, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSpacetimeDB, useTable } from "spacetimedb/react";
import { SendMoney } from "../../components/SendMoney";
import { Body, Button, Card, Divider, Empty, Notice, Screen, SectionLabel, StatusPill } from "../../components/ui";
import { useEndpoints } from "../../lib/config";
import { clock, shortDay, signedUsd, usd, usdCompact } from "../../lib/format";
import { useTheme } from "../../lib/theme";
import { signOut } from "../../lib/session";
import { useShield } from "../../lib/useShield";

const BILL_STATUS: Record<string, string> = { pending: "Pending", completed: "Paid", recurring: "Recurring", cancelled: "Cancelled" };

export default function AccountScreen() {
  const t = useTheme();
  const { isActive, connectionError } = useSpacetimeDB();
  const shield = useShield();
  const endpoints = useEndpoints();
  const [snapshots, ready] = useTable(tables.accountSnapshot);
  const [activity] = useTable(tables.activity);
  const [bills] = useTable(tables.bill);

  const snapshot = snapshots[0];
  const recent = useMemo(() => [...activity].sort((a, b) => a.sortIndex - b.sortIndex).slice(0, 10), [activity]);
  const upcoming = useMemo(() => [...bills].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate)), [bills]);

  return (
    <Screen>
      {!isActive && (
        <Notice tone="neutral" icon="cloud-offline-outline" title={connectionError ? "Cannot reach the demo server" : "Connecting…"}>
          {connectionError ? <Body muted>Start it with `pnpm dev --lan`, on the same Wi-Fi as this phone. Looking for {endpoints?.spacetimeUri ?? "the server"}.</Body> : null}
        </Notice>
      )}

      <Card>
        {!snapshot ? (
          <Empty>{ready ? "No account loaded yet. Is the relay running?" : "Loading account…"}</Empty>
        ) : (
          <View>
            <Text style={[styles.name, { color: t.ink }]}>{snapshot.name}</Text>
            <Text style={{ color: t.muted, fontSize: 15 }}>
              {snapshot.nickname} •••• {snapshot.last4}
            </Text>
            <Text style={[styles.balanceLabel, { color: t.muted }]}>Available balance</Text>
            <Text style={[styles.balance, { color: t.ink }]} adjustsFontSizeToFit numberOfLines={1}>
              {usd(snapshot.balance)}
            </Text>
          </View>
        )}

        {/* The other panels are a tab away on a phone, so the state that matters for sending money is repeated here. */}
        <Pressable onPress={() => router.push("/shield")} accessibilityRole="link" accessibilityLabel="Open ScamShield" style={styles.shieldRow}>
          <Text style={{ color: t.muted, fontSize: 14, fontWeight: "600" }}>ScamShield</Text>
          <StatusPill state={shield.state} />
        </Pressable>
        {shield.armed && shield.armedUntil && <Notice tone="brand" icon="lock-closed" title={`Transfers protected until ${clock(shield.armedUntil)}`} />}
      </Card>

      <Card>
        <SendMoney />
      </Card>

      <Card>
        <SectionLabel>Recent activity</SectionLabel>
        {recent.length === 0 ? (
          <Empty>No activity yet.</Empty>
        ) : (
          <View>
            {recent.map((item, i) => (
              <Fragment key={item.id}>
                {i > 0 && <Divider />}
                <View style={styles.row}>
                  <Text style={{ width: 52, color: t.muted, fontSize: 13 }}>{shortDay(item.date)}</Text>
                  <Text style={{ flex: 1, color: t.ink, fontSize: 15 }} numberOfLines={1}>{item.description}</Text>
                  <Text style={[styles.amount, { color: t.ink }]}>{signedUsd(item.amount)}</Text>
                </View>
              </Fragment>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <SectionLabel>Upcoming bills</SectionLabel>
        {upcoming.length === 0 ? (
          <Empty>No bills.</Empty>
        ) : (
          <View>
            {upcoming.map((bill, i) => (
              <Fragment key={bill.id}>
                {i > 0 && <Divider />}
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontSize: 15 }} numberOfLines={1}>{bill.payee}</Text>
                    <Text style={{ color: t.muted, fontSize: 13 }}>
                      {bill.paymentDate ? shortDay(bill.paymentDate) : "No date"} · {BILL_STATUS[bill.status] ?? bill.status}
                    </Text>
                  </View>
                  <Text style={[styles.amount, { color: t.ink }]}>{usdCompact(bill.amount)}</Text>
                </View>
              </Fragment>
            ))}
          </View>
        )}
      </Card>

      <Button label="Sign out" icon="log-out-outline" onPress={signOut} />

      <Text style={{ color: t.muted, fontSize: 12, textAlign: "center" }}>Demo app. Mock data from the Capital One Nessie hackathon API.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 18, fontWeight: "700" },
  balanceLabel: { marginTop: 14, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  balance: { fontSize: 48, fontWeight: "700", letterSpacing: -1 },
  shieldRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11 },
  amount: { fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
