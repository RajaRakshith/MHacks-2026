import { tables } from "@scamshield/bindings";
import type { CallSessions } from "@scamshield/bindings/types";
import { DEMO_USER_ID, shieldState, type ShieldState } from "@scamshield/core";
import { useMemo } from "react";
import { useTable } from "spacetimedb/react";

export interface Shield {
  /** The open call session for the demo user, if one is active. */
  callSession: CallSessions | null;
  /** True while a call session is active. */
  live: boolean;
  state: ShieldState;
}

/** ScamShield state shared by the tab bar, the account banner, and the ScamShield tab. */
export function useShield(): Shield {
  const [sessions] = useTable(tables.callSessions);

  const callSession = useMemo(() => {
    let active: CallSessions | null = null;
    for (const row of sessions) {
      if (row.userId !== DEMO_USER_ID || row.status.tag !== "Active") continue;
      if (!active || row.id > active.id) active = row;
    }
    return active;
  }, [sessions]);

  const live = callSession !== null;
  return {
    callSession,
    live,
    state: shieldState(live, callSession?.riskScore ?? 0),
  };
}
