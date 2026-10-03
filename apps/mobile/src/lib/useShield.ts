import { tables } from "@scamshield/bindings";
import type { Call } from "@scamshield/bindings/types";
import { isGuardArmed, type ShieldState } from "@scamshield/core";
import { useTable } from "spacetimedb/react";
import { useNow } from "./useNow";

export interface Shield {
  /** The open call if there is one, otherwise the most recent call. */
  call: Call | null;
  /** True while a call is in progress. */
  live: boolean;
  state: ShieldState;
  /** Transfers are protected until this time. */
  armed: boolean;
  armedUntil: Date | undefined;
  mock: boolean;
}

/** ScamShield state shared by the tab bar, the account banner, and the ScamShield tab. */
export function useShield(): Shield {
  const [calls] = useTable(tables.call);
  const [guards] = useTable(tables.guard);
  const [configs] = useTable(tables.config);
  const now = useNow();

  let open: Call | null = null;
  let latest: Call | null = null;
  for (const call of calls) {
    if (!latest || call.id > latest.id) latest = call;
    if (call.endedAt === undefined && (!open || call.id > open.id)) open = call;
  }
  const call = open ?? latest;
  const live = open !== null;
  const armedUntil = guards[0]?.armedUntil.toDate();

  return {
    call,
    live,
    state: live && call ? (call.state as ShieldState) : "idle",
    armed: armedUntil !== undefined && isGuardArmed(armedUntil.getTime(), now),
    armedUntil,
    mock: configs[0]?.mock ?? true,
  };
}
