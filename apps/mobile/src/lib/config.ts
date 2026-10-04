import Constants from "expo-constants";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

/**
 * Where the database and the relay are. Both run on the developer's machine.
 *
 * On the same network, the app reaches them on the machine that served it.
 * Through `pnpm phone` they sit behind tunnels whose addresses can change
 * while the app is running, so the app asks the dev server for the current
 * ones (see metro.config.js) and keeps checking.
 */
export interface Endpoints {
  spacetimeUri: string;
  relayUrl: string;
}

export const SPACETIME_DB = process.env.EXPO_PUBLIC_SPACETIME_DB ?? "scamshield";

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
  relayUrl: (process.env.EXPO_PUBLIC_RELAY_URL ?? `http://${devHost()}:8787`).replace(/\/+$/, ""),
};

let current: Endpoints | null = null;
const listeners = new Set<() => void>();

async function refresh(): Promise<void> {
  let next = fallback;
  try {
    const res = await fetch(`${devOrigin()}/scamshield-endpoints.json`, { cache: "no-store" });
    const body = (await res.json()) as Partial<Endpoints>;
    if (typeof body.spacetimeUri === "string" && typeof body.relayUrl === "string") {
      next = { spacetimeUri: body.spacetimeUri, relayUrl: body.relayUrl.replace(/\/+$/, "") };
    }
  } catch {
    // The dev server is unreachable or has no tunnel addresses: keep what we have, or the fallback.
    if (current) return;
  }
  if (!current || current.spacetimeUri !== next.spacetimeUri || current.relayUrl !== next.relayUrl) {
    current = next;
    listeners.forEach((l) => l());
  }
}

void refresh();
setInterval(() => void refresh(), 8000);

/** The current addresses, or null until the first lookup finishes. Re-renders when a tunnel moves. */
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

export const relayUrl = (): string => (current ?? fallback).relayUrl;
