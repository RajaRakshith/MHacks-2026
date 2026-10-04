import { reducers, tables } from "@scamshield/bindings";
import { DEMO_USER_ID, dollarsToCents } from "@scamshield/core";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useReducer, useSpacetimeDB, useTable } from "spacetimedb/react";
import { usdCompact } from "../lib/format";
import { useTheme } from "../lib/theme";
import { Body, Button, SectionLabel } from "./ui";

const STATUS_TONE: Record<string, "critical" | "good" | "warning" | "neutral"> = {
  Held: "critical",
  Approved: "good",
  Completed: "good",
  Failed: "critical",
  Expired: "warning",
};

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Could not send this transfer.";
}

export function SendMoney() {
  const t = useTheme();
  const { isActive } = useSpacetimeDB();
  const [payees] = useTable(tables.payees);
  const [intents] = useTable(tables.transferIntents);
  const requestTransfer = useReducer(reducers.requestTransfer);

  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watermark, setWatermark] = useState<bigint | null>(null);

  const saved = useMemo(() => [...payees].sort((a, b) => a.name.localeCompare(b.name)), [payees]);

  const newest = useMemo(() => {
    if (watermark === null) return null;
    let best: (typeof intents)[number] | null = null;
    for (const row of intents) {
      if (row.userId !== DEMO_USER_ID || row.id <= watermark) continue;
      if (!best || row.id > best.id) best = row;
    }
    return best;
  }, [intents, watermark]);

  async function onSubmit() {
    setError(null);
    if (!isActive) {
      setError("Cannot reach the database. Start everything with pnpm dev.");
      return;
    }
    let maxId = -1n;
    for (const row of intents) {
      if (row.userId === DEMO_USER_ID && row.id > maxId) maxId = row.id;
    }
    setBusy(true);
    try {
      await requestTransfer({
        userId: DEMO_USER_ID,
        amountCents: dollarsToCents(Number(amount)),
        destinationAccount: payee.trim(),
        memo: memo.trim() || undefined,
      });
      setWatermark(maxId);
      setAmount("");
      setMemo("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const toneName = newest ? (STATUS_TONE[newest.status.tag] ?? "neutral") : "neutral";
  const tone = {
    critical: { bg: t.criticalTrack, border: t.critical },
    good: { bg: t.goodTrack, border: t.line },
    warning: { bg: t.warningTrack, border: t.warning },
    neutral: { bg: t.sunken, border: t.line },
  }[toneName];
  const input = [styles.input, { backgroundColor: t.card, borderColor: t.line, color: t.ink }];

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Send money</SectionLabel>

      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: t.muted }]}>Payee</Text>
        <TextInput
          value={payee}
          onChangeText={setPayee}
          placeholder="Saved payee or account"
          placeholderTextColor={t.muted}
          autoCorrect={false}
          accessibilityLabel="Payee"
          style={input}
        />
        <View style={styles.chips}>
          {saved.map((row) => (
            <Pressable
              key={row.name}
              onPress={() => setPayee(row.name)}
              accessibilityRole="button"
              accessibilityLabel={`Pay ${row.name}`}
              style={[styles.chip, { borderColor: payee === row.name ? t.brand : t.line, backgroundColor: payee === row.name ? t.brandTint : t.sunken }]}
            >
              <Text style={{ color: t.ink, fontSize: 13, fontWeight: "500" }}>{row.name}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 2, gap: 6 }}>
          <Text style={[styles.label, { color: t.muted }]}>Amount</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            placeholderTextColor={t.muted}
            keyboardType="decimal-pad"
            accessibilityLabel="Amount in dollars"
            style={input}
          />
        </View>
        <View style={{ flex: 3, gap: 6 }}>
          <Text style={[styles.label, { color: t.muted }]}>Memo</Text>
          <TextInput value={memo} onChangeText={setMemo} placeholder="Optional" placeholderTextColor={t.muted} accessibilityLabel="Memo" style={input} />
        </View>
      </View>

      <Button variant="primary" label={busy ? "Sending…" : "Send"} onPress={() => void onSubmit()} disabled={busy} />

      {error && (
        <View accessibilityRole="alert" style={[styles.status, { backgroundColor: t.criticalTrack, borderColor: t.critical }]}>
          <Text style={{ color: t.ink, fontSize: 14 }}>{error}</Text>
        </View>
      )}

      {newest && (
        <View accessibilityLiveRegion="polite" style={[styles.status, { backgroundColor: tone.bg, borderColor: tone.border }]}>
          <Text style={{ color: t.ink, fontSize: 15, fontWeight: "700" }}>{newest.status.tag}</Text>
          <Text style={{ color: t.ink, fontSize: 14 }}>
            {usdCompact(Number(newest.amountCents) / 100)} to {newest.destinationAccount}
          </Text>
          {newest.holdReason ? <Text style={{ color: t.ink, fontSize: 14 }}>{newest.holdReason}</Text> : null}
          {newest.memo ? <Body muted style={{ fontSize: 12 }}>Memo: {newest.memo}</Body> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "500" },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  status: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 11, gap: 4 },
});
