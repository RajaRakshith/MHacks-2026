import Ionicons from "@expo/vector-icons/Ionicons";
import { tables } from "@watchdog/bindings";
import { DEMO_USER_ID } from "@watchdog/core";
import { Tabs } from "expo-router";
import { useEffect, useRef } from "react";
import { Vibration } from "react-native";
import { useTable } from "spacetimedb/react";
import { useTheme } from "../../lib/theme";
import { useShield } from "../../lib/useShield";

export default function TabLayout() {
  const t = useTheme();
  const shield = useShield();
  const [intents] = useTable(tables.transferIntents);
  const waiting = intents.filter((row) => row.userId === DEMO_USER_ID && row.status.tag === "Held").length;

  // A short buzz the moment a call turns into "Scam likely".
  const previous = useRef(shield.state);
  useEffect(() => {
    if (shield.state === "scam_likely" && previous.current !== "scam_likely") Vibration.vibrate(400);
    previous.current = shield.state;
  }, [shield.state]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line },
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.ink,
        headerTitleStyle: { fontWeight: "700" },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: t.surface },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Account",
          headerTitle: "C1 Mockup",
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="shield"
        options={{
          title: "Watchdog",
          tabBarIcon: ({ color, size }) => <Ionicons name="shield-checkmark-outline" size={size} color={color} />,
          tabBarBadge: shield.state === "scam_likely" || shield.state === "caution" ? "!" : undefined,
          tabBarBadgeStyle: { backgroundColor: shield.state === "scam_likely" ? t.critical : t.warning, color: shield.state === "scam_likely" ? "#ffffff" : "#14201f" },
        }}
      />
      <Tabs.Screen
        name="held"
        options={{
          title: "Held",
          headerTitle: "Held transactions",
          tabBarIcon: ({ color, size }) => <Ionicons name="lock-closed-outline" size={size} color={color} />,
          tabBarBadge: waiting > 0 ? waiting : undefined,
          tabBarBadgeStyle: { backgroundColor: t.critical, color: "#ffffff" },
        }}
      />
    </Tabs>
  );
}
