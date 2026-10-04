import { tables } from "@watchdog/bindings";
import { router } from "expo-router";
import { Fragment, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSpacetimeDB, useTable } from "spacetimedb/react";
import { SendMoney } from "../../components/SendMoney";
import { Body, Button, Card, Divider, Empty, Notice, Screen, SectionLabel, StatusPill } from "../../components/ui";
import { useEndpoints } from "../../lib/config";
import { shortDay, signedUsd, usd } from "../../lib/format";
import { useTheme } from "../../lib/theme";
import { signOut } from "../../lib/session";
import { useShield } from "../../lib/useShield";

export default function AccountScreen() {
  const t = useTheme();
  const { isActive, connectionError } = useSpacetimeDB();
  const shield = useShield();
  const endpoints = useEndpoints();
  const [snapshots, ready] = useTable(tables.accountSnapshot);
  const [activity] = useTable(tables.activity);

  const snapshot = snapshots[0];
  const recent = useMemo(() => [...activity].sort((a, b) => a.sortIndex - b.sortIndex).slice(0, 10), [activity]);

  return (
    <Screen>
      {!isActive && (
        <Notice tone="neutral" icon="cloud-offline-outline" title={connectionError ? "Cannot reach the database" : "Connecting…"}>
          {connectionError ? <Body muted>Cannot reach the database. Start everything with pnpm dev. Looking for {endpoints?.spacetimeUri ?? "the server"}.</Body> : null}
        </Notice>
      )}

      <Card>
        {!snapshot ? (
          ready ? (
            <View accessibilityRole="alert" style={[styles.alert, { backgroundColor: t.criticalTrack, borderColor: t.critical }]}>
              <Text style={{ color: t.ink, fontSize: 14, fontWeight: "600", textAlign: "center" }}>Nessie account not loaded.</Text>
            </View>
          ) : (
            <Empty>Loading account…</Empty>
          )
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

        <Pressable onPress={() => router.push("/shield")} accessibilityRole="link" accessibilityLabel="Open Watchdog" style={styles.shieldRow}>
          <Text style={{ color: t.muted, fontSize: 14, fontWeight: "600" }}>Watchdog</Text>
          <StatusPill state={shield.state} />
        </Pressable>
      </Card>

      {snapshot && (
        <Card>
          <SendMoney />
        </Card>
      )}

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

      <Button label="Sign out" icon="log-out-outline" onPress={signOut} />

      <Text style={{ color: t.muted, fontSize: 12, textAlign: "center" }}>Demo app. Mock data from the Capital One Nessie hackathon API.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 18, fontWeight: "700" },
  balanceLabel: { marginTop: 14, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  balance: { fontSize: 48, fontWeight: "700", letterSpacing: -1 },
  alert: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 16 },
  shieldRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11 },
  amount: { fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
