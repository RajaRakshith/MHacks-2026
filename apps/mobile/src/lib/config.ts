import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * The database and the relay run on the developer's machine. In Expo Go the
 * app already knows that machine's address (it loaded the bundle from it), so
 * the same host is used unless EXPO_PUBLIC_* says otherwise.
 */
function devHost(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.hostname;
  const hostUri = Constants.expoConfig?.hostUri ?? "";
  return hostUri.split(":")[0] || "localhost";
}

export const SPACETIME_URI = process.env.EXPO_PUBLIC_SPACETIME_URI ?? `ws://${devHost()}:3000`;
export const SPACETIME_DB = process.env.EXPO_PUBLIC_SPACETIME_DB ?? "scamshield";
export const RELAY_URL = (process.env.EXPO_PUBLIC_RELAY_URL ?? `http://${devHost()}:8787`).replace(/\/+$/, "");
