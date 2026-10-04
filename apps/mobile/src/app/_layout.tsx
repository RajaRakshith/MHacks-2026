import { DbConnection } from "@watchdog/bindings";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { SpacetimeDBProvider } from "spacetimedb/react";
import { Login } from "../components/Login";
import { SPACETIME_DB, useEndpoints } from "../lib/config";
import { useSignedIn } from "../lib/session";

export default function RootLayout() {
  const signedIn = useSignedIn();
  const endpoints = useEndpoints();
  const uri = endpoints?.spacetimeUri;
  // Every device connects to the database anonymously and sees the same account.
  // Compression is off because React Native has no DecompressionStream.
  const connectionBuilder = useMemo(
    () => (uri ? DbConnection.builder().withUri(uri).withDatabaseName(SPACETIME_DB).withCompression("none") : null),
    [uri],
  );

  if (!connectionBuilder) return <View style={{ flex: 1 }} />;

  return (
    // Keyed by address: when a tunnel moves, the whole tree reconnects to the new one.
    <SpacetimeDBProvider key={uri} connectionBuilder={connectionBuilder}>
      {/* The tabs stay mounted behind the sign-in screen so the data is ready the moment it closes. */}
      <Stack screenOptions={{ headerShown: false }} />
      {!signedIn && (
        <View style={StyleSheet.absoluteFill}>
          <Login />
        </View>
      )}
      <StatusBar style="auto" />
    </SpacetimeDBProvider>
  );
}
