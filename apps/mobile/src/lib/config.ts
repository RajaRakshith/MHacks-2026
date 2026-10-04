import Constants from "expo-constants";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

/**
 * Where the database is. It runs on the developer's machine.
 *
 * On the same network, the app reaches it on the machine that served the app.
 * Through `pnpm phone` the database sits behind a tunnel whose address can change
 * while the app is running, so the app asks the dev server for the current
 * address (see metro.config.js) and keeps checking.
 */
export interface Endpoints {
  spacetimeUri: string;
}

export const SPACETIME_DB = process.env.EXPO_PUBLIC_SPACETIME_DB ?? "scamshield-dev";

/** The dev server this app was loaded from, e.g. "https://abc-8081.exp.direct" or "http://192.168.1.20:8081". */
function devOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  const hostUri = Constants.expoConfig?.hostUri ?? "localhost:8081";
  return /\.exp\.direct$/.test(hostUri.split(":")[0] ?? "") ? `https://${hostUri.split(":")[0]}` : `http://${hostUri}`;
}

function devHost(): string {
  try {
    return new URL(devOrigin()).hostname;
  } catch {
    return "localhost";
  }
}

const fallback: Endpoints = {
  spacetimeUri: process.env.EXPO_PUBLIC_SPACETIME_URI ?? `ws://${devHost()}:3000`,
};

let current: Endpoints | null = null;
const listeners = new Set<() => void>();

async function refresh(): Promise<void> {
  let next = fallback;
  try {
    const res = await fetch(`${devOrigin()}/scamshield-endpoints.json`, { cache: "no-store" });
    const body = (await res.json()) as Partial<Endpoints>;
    if (typeof body.spacetimeUri === "string") {
      next = { spacetimeUri: body.spacetimeUri };
    }
  } catch {
    // The dev server is unreachable or has no tunnel address: keep what we have, or the fallback.
    if (current) return;
  }
  if (!current || current.spacetimeUri !== next.spacetimeUri) {
    current = next;
    listeners.forEach((l) => l());
  }
}

void refresh();
setInterval(() => void refresh(), 8000);

/** The current database address, or null until the first lookup finishes. Re-renders when a tunnel moves. */
export function useEndpoints(): Endpoints | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}
