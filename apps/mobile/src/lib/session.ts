import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

// Front door for the demo, not security: checked on the device, and the
// database still accepts anonymous connections. The flag persists across launches.
export const DEMO_USER = "margaret";
export const DEMO_PASSWORD = "demo1234";
const KEY = "c1mockup.signedIn";

let signedIn = false;
let ready = false;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

void AsyncStorage.getItem(KEY)
  .then((value) => {
    signedIn = value === "1";
  })
  .catch(() => {
    signedIn = false;
  })
  .finally(() => {
    ready = true;
    notify();
  });

export function signIn(user: string, password: string): boolean {
  if (user.trim().toLowerCase() !== DEMO_USER || password !== DEMO_PASSWORD) return false;
  signedIn = true;
  notify();
  void AsyncStorage.setItem(KEY, "1");
  return true;
}

export function signOut(): void {
  signedIn = false;
  notify();
  void AsyncStorage.removeItem(KEY);
}

export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, () => signedIn, () => signedIn);
}

export function useAuthReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready, () => ready);
}
