import { DbConnection } from "@scamshield/bindings";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SpacetimeDBProvider } from "spacetimedb/react";
import { SPACETIME_DB, SPACETIME_URI } from "../lib/config";

// No login in the MVP: every device connects anonymously and sees the same account.
// Compression is off because React Native has no DecompressionStream.
const connectionBuilder = DbConnection.builder().withUri(SPACETIME_URI).withDatabaseName(SPACETIME_DB).withCompression("none");

export default function RootLayout() {
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </SpacetimeDBProvider>
  );
}
