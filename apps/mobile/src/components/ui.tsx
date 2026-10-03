import Ionicons from "@expo/vector-icons/Ionicons";
import { SHIELD_STATE_LABELS, type ShieldState } from "@scamshield/core";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useTheme, type Theme } from "../lib/theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** A scrolling tab screen on the app's surface color. */
export function Screen({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.surface }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.sectionLabel, { color: t.muted }]}>{children}</Text>;
}

export function Empty({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.empty, { backgroundColor: t.sunken }]}>
      <Text style={{ color: t.muted, fontSize: 14, textAlign: "center" }}>{children}</Text>
    </View>
  );
}

type Variant = "primary" | "secondary" | "danger";

export function Button({
  label,
  onPress,
  variant = "secondary",
  disabled = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const colors: Record<Variant, { bg: string; border: string; text: string }> = {
    primary: { bg: t.brand, border: t.brand, text: t.onBrand },
    secondary: { bg: t.card, border: t.line, text: t.ink },
    danger: { bg: t.card, border: t.critical, text: t.ink },
  };
  const c = colors[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: c.bg, borderColor: c.border, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {icon && <Ionicons name={icon} size={18} color={c.text} />}
      <Text style={{ color: c.text, fontSize: 16, fontWeight: "600", textAlign: "center", flexShrink: 1 }}>{label}</Text>
    </Pressable>
  );
}

export function shieldColors(t: Theme, state: ShieldState): { dot: string; fill: string } {
  switch (state) {
    case "listening":
      return { dot: t.good, fill: t.goodTrack };
    case "caution":
      return { dot: t.warning, fill: t.warningTrack };
    case "scam_likely":
      return { dot: t.critical, fill: t.criticalTrack };
    default:
      return { dot: t.idle, fill: t.idleTrack };
  }
}

/** Idle, Listening, Caution, or Scam likely. The label carries the meaning; the color backs it up. */
export function StatusPill({ state }: { state: ShieldState }) {
  const t = useTheme();
  const c = shieldColors(t, state);
  return (
    <View style={[styles.pill, { backgroundColor: c.fill }]} accessibilityRole="text" accessibilityLabel={`ScamShield status: ${SHIELD_STATE_LABELS[state]}`}>
      <View style={[styles.dot, { backgroundColor: c.dot }]} />
      <Text style={{ color: t.ink, fontSize: 13, fontWeight: "700" }}>{SHIELD_STATE_LABELS[state]}</Text>
    </View>
  );
}

type Tone = "good" | "warning" | "critical" | "brand" | "neutral";

/** A bordered message box: an icon, a bold title, and optional detail. */
export function Notice({ tone, icon, title, children }: { tone: Tone; icon: IconName; title: string; children?: ReactNode }) {
  const t = useTheme();
  const tones: Record<Tone, { bg: string; border: string; icon: string }> = {
    good: { bg: t.goodTrack, border: t.good, icon: t.good },
    warning: { bg: t.warningTrack, border: t.warning, icon: t.ink },
    critical: { bg: t.criticalTrack, border: t.critical, icon: t.ink },
    brand: { bg: t.brandTint, border: t.brandTint, icon: t.brandStrong },
    neutral: { bg: t.sunken, border: t.line, icon: t.ink },
  };
  const c = tones[tone];
  return (
    <View style={[styles.notice, { backgroundColor: c.bg, borderColor: c.border }]} accessibilityRole="alert">
      <Ionicons name={icon} size={18} color={c.icon} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: t.ink, fontSize: 15, fontWeight: "600", lineHeight: 20 }}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

export function Body({ children, muted = false, style }: { children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: muted ? t.muted : t.ink, fontSize: 14, lineHeight: 20 }, style]}>{children}</Text>;
}

/** A thin rule between list rows. */
export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line }} />;
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 16, paddingBottom: 32 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  sectionLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  empty: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 16 },
  button: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pill: { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  notice: { flexDirection: "row", gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 11 },
});
