import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DEMO_PASSWORD, DEMO_USER, signIn } from "../lib/session";
import { useTheme } from "../lib/theme";
import { Button } from "./ui";

export function Login() {
  const t = useTheme();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = [styles.input, { backgroundColor: t.card, borderColor: t.line, color: t.ink }];

  function submit() {
    if (!signIn(user, password)) setError("That username and password don't match. Use the demo sign-in shown below.");
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <View style={styles.brand}>
            <View style={[styles.logo, { backgroundColor: t.brand }]}>
              <Ionicons name="business" size={22} color={t.onBrand} />
            </View>
            <Text style={[styles.wordmark, { color: t.ink }]}>
              C1 <Text style={{ color: "#d03027" }}>Mockup</Text>
            </Text>
          </View>

          <Text style={[styles.title, { color: t.ink }]} accessibilityRole="header">Sign in</Text>
          <Text style={{ color: t.muted, fontSize: 15, marginBottom: 6 }}>Mobile banking with ScamShield built in.</Text>

          <Text style={[styles.label, { color: t.muted }]}>Username</Text>
          <TextInput
            value={user}
            onChangeText={setUser}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            accessibilityLabel="Username"
            returnKeyType="next"
            style={input}
          />
          <Text style={[styles.label, { color: t.muted }]}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            accessibilityLabel="Password"
            returnKeyType="go"
            onSubmitEditing={submit}
            style={input}
          />
          {error && <Text style={{ color: t.ink, fontSize: 14 }} accessibilityRole="alert">{error}</Text>}
          <Button variant="primary" label="Sign in" onPress={submit} style={{ marginTop: 6 }} />

          <View style={[styles.hint, { backgroundColor: t.sunken }]}>
            <Text style={{ color: t.muted, fontSize: 13 }}>
              Demo sign-in: <Text style={{ color: t.ink, fontWeight: "700" }}>{DEMO_USER}</Text> / <Text style={{ color: t.ink, fontWeight: "700" }}>{DEMO_PASSWORD}</Text>
            </Text>
          </View>
        </View>
        <Text style={{ color: t.muted, fontSize: 12, textAlign: "center", marginTop: 16 }}>Demo app. Mock data from the Capital One Nessie hackathon API.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: 20 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 22, gap: 8 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  logo: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  wordmark: { fontSize: 22, fontWeight: "700" },
  title: { fontSize: 20, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "500", marginTop: 6 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  hint: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
});
