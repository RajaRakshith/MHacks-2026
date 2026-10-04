import { useSyncExternalStore } from "react";

// SPEC-QUESTION: the spec puts login out of scope. This is a front door for
// the demo, not security: it is checked on the device, and the database still
// accepts anonymous connections. It lasts until the app is closed.
export const DEMO_USER = "margaret";
export const DEMO_PASSWORD = "demo1234";

let signedIn = false;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

export function signIn(user: string, password: string): boolean {
  if (user.trim().toLowerCase() !== DEMO_USER || password !== DEMO_PASSWORD) return false;
  signedIn = true;
  notify();
  return true;
}

export function signOut(): void {
  signedIn = false;
  notify();
}

export function useSignedIn(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => signedIn,
    () => signedIn,
  );
}
