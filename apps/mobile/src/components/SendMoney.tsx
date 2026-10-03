import { procedures, tables } from "@scamshield/bindings";
import type { TransferResult } from "@scamshield/bindings/types";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useProcedure, useTable } from "spacetimedb/react";
import { usdCompact } from "../lib/format";
import { useTheme } from "../lib/theme";
import { Body, Button, Notice, SectionLabel } from "./ui";

const CASH = "Cash withdrawal";

interface Sent {
  payee: string;
  amount: number;
  result: TransferResult;
}

/**
 * Every transfer goes through the request_transfer procedure, which runs the
 * guard rules before anything reaches Nessie. The result shows inline as
 * Sent, Held (with reason), or Needs confirmation.
 */
export function SendMoney() {
  const t = useTheme();
  const [payees] = useTable(tables.payee);
  const [configs] = useTable(tables.config);
  const requestTransfer = useProcedure(procedures.requestTransfer);

  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Sent | null>(null);

  const supportsTransfers = configs[0]?.supportsTransfers ?? false;
  const saved = [...payees].map((p) => p.name).sort((a, b) => a.localeCompare(b));
  const input = [styles.input, { backgroundColor: t.card, borderColor: t.line, color: t.ink }];

  async function submit(confirmed: boolean) {
    const name = payee.trim();
    const value = Number(amount);
    if (!name || amount.trim() === "") {
      setLast({ payee: name, amount: value, result: { outcome: "error", message: "Enter a payee and an amount.", rule: 0, viaWithdrawal: false } });
      return;
    }
    setBusy(true);
    try {
      const result = await requestTransfer({ payee: name, amount: value, memo: memo.trim(), confirmed: confirmed ? true : undefined });
      setLast({ payee: name, amount: value, result });
      if (result.outcome === "sent" || result.outcome === "held") {
        setAmount("");
        setMemo("");
      }
    } catch {
      setLast({ payee: name, amount: value, result: { outcome: "error", message: "Could not reach the bank. Try again.", rule: 0, viaWithdrawal: false } });
    }
    setBusy(false);
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Send money</SectionLabel>

      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: t.muted }]}>Payee</Text>
        <TextInput
          value={payee}
          onChangeText={setPayee}
          placeholder="Saved payee or a new name"
          placeholderTextColor={t.muted}
          autoCorrect={false}
          accessibilityLabel="Payee"
          style={input}
        />
        <View style={styles.chips}>
          {[...saved, CASH].map((name) => (
            <Pressable
              key={name}
              onPress={() => setPayee(name)}
              accessibilityRole="button"
              accessibilityLabel={`Pay ${name}`}
              style={[styles.chip, { borderColor: payee === name ? t.brand : t.line, backgroundColor: payee === name ? t.brandTint : t.sunken }]}
            >
              <Text style={{ color: t.ink, fontSize: 13, fontWeight: "500" }}>{name}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 2, gap: 6 }}>
          <Text style={[styles.label, { color: t.muted }]}>Amount ($)</Text>
          <TextInput
            value={amount}
            onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, ""))}
            placeholder="0"
            placeholderTextColor={t.muted}
            keyboardType="number-pad"
            accessibilityLabel="Amount in dollars"
            style={input}
          />
        </View>
        <View style={{ flex: 3, gap: 6 }}>
          <Text style={[styles.label, { color: t.muted }]}>Memo</Text>
          <TextInput value={memo} onChangeText={setMemo} placeholder="Optional" placeholderTextColor={t.muted} accessibilityLabel="Memo" style={input} />
        </View>
      </View>

      <Button variant="primary" label={busy ? "Sending…" : "Send"} onPress={() => void submit(false)} disabled={busy} />

      {!supportsTransfers && <Body muted style={{ fontSize: 12 }}>Money you send is posted as a withdrawal described “Transfer to payee”.</Body>}

      {last && <Result sent={last} busy={busy} onConfirm={() => void submit(true)} onCancel={() => setLast(null)} />}
    </View>
  );
}

function Result({ sent, busy, onConfirm, onCancel }: { sent: Sent; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { result } = sent;
  const what = `${usdCompact(sent.amount)} to ${sent.payee}`;

  if (result.outcome === "sent") {
    return (
      <Notice tone="good" icon="checkmark-circle" title={`Sent: ${what}`}>
        {result.message ? <Body>{result.message}</Body> : null}
        {result.viaWithdrawal ? <Body muted style={{ fontSize: 12 }}>Posted as a withdrawal described “Transfer to {sent.payee}”.</Body> : null}
      </Notice>
    );
  }
  if (result.outcome === "held") {
    return (
      <Notice tone="critical" icon="lock-closed" title={result.message}>
        <Body>{what} will not be sent unless a trusted contact approves it.</Body>
      </Notice>
    );
  }
  if (result.outcome === "needs_confirmation") {
    return (
      <Notice tone="warning" icon="warning" title={`Needs confirmation: ${what}`}>
        <Body>{result.message}</Body>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
          <Button label="Continue" onPress={onConfirm} disabled={busy} style={{ flex: 1 }} />
          <Button label="Cancel" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
        </View>
      </Notice>
    );
  }
  return (
    <Notice tone="neutral" icon="alert-circle" title="Not sent">
      <Body>{result.message}</Body>
    </Notice>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "500" },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
});
