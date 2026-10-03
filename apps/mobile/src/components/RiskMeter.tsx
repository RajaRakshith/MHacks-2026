import { CAUTION_THRESHOLD, SCAM_THRESHOLD, meterBand } from "@scamshield/core";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

const BAND_LABEL = { green: "Low risk", amber: "Caution", red: "Scam likely" } as const;

/**
 * Risk meter, 0 to 100. Green below 40, amber 40 to 69, red 70 and up.
 * The fill carries the severity and the track is a lighter step of the same
 * color. The number and the band label are always shown, so color never
 * carries the meaning alone.
 */
export function RiskMeter({ score, active }: { score: number; active: boolean }) {
  const t = useTheme();
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const band = meterBand(value);
  const fill = { green: t.good, amber: t.warning, red: t.critical }[band];
  const track = { green: t.goodTrack, amber: t.warningTrack, red: t.criticalTrack }[band];

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Scam risk"
      accessibilityValue={{ min: 0, max: 100, now: active ? value : 0, text: active ? `${value} out of 100, ${BAND_LABEL[band]}` : "No call in progress" }}
    >
      <View style={styles.header}>
        <View style={styles.scoreRow}>
          <Text style={[styles.score, { color: t.ink }]}>{active ? value : "–"}</Text>
          <Text style={{ color: t.muted, fontSize: 15 }}>/ 100 risk</Text>
        </View>
        <Text style={{ color: t.ink, fontSize: 15, fontWeight: "600" }}>{active ? BAND_LABEL[band] : "No call"}</Text>
      </View>

      <View style={[styles.track, { backgroundColor: active ? track : t.idleTrack }]}>
        <View style={[styles.fill, { width: `${active ? value : 0}%`, backgroundColor: active ? fill : t.idle }]} />
        {/* Threshold ticks: a 2px gap in the card color at 40 and 70. */}
        <View style={[styles.tick, { left: `${CAUTION_THRESHOLD}%`, backgroundColor: t.card }]} />
        <View style={[styles.tick, { left: `${SCAM_THRESHOLD}%`, backgroundColor: t.card }]} />
      </View>

      <View style={styles.scale} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={[styles.scaleText, { color: t.muted, left: 0 }]}>0</Text>
        <Text style={[styles.scaleText, styles.scaleMid, { color: t.muted, left: `${CAUTION_THRESHOLD}%` }]}>{CAUTION_THRESHOLD}</Text>
        <Text style={[styles.scaleText, styles.scaleMid, { color: t.muted, left: `${SCAM_THRESHOLD}%` }]}>{SCAM_THRESHOLD}</Text>
        <Text style={[styles.scaleText, { color: t.muted, right: 0 }]}>100</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  scoreRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  score: { fontSize: 40, fontWeight: "700", lineHeight: 44 },
  track: { marginTop: 12, height: 14, borderRadius: 7, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 7 },
  tick: { position: "absolute", top: 0, bottom: 0, width: 2 },
  scale: { marginTop: 4, height: 16 },
  scaleText: { position: "absolute", fontSize: 11 },
  scaleMid: { width: 24, marginLeft: -12, textAlign: "center" },
});
