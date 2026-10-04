/**
 * Button bridge (section 7).
 *   Press       POST /protect on the relay: the customer's phone rings from Watchdog.
 *   Long press  arm_guard(): protects transfers without starting a call.
 *   Screen      the live Watchdog state from the `call` table.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DbConnection } from "@watchdog/bindings";
import type { ShieldState } from "@watchdog/core";
import { config as loadDotenv } from "dotenv";
import { openDevice, type Device } from "./device";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: resolve(ROOT, ".env"), quiet: true });

const SPACETIME_URI = process.env.SPACETIME_URI?.trim() || "ws://127.0.0.1:3000";
const SPACETIME_DB = process.env.SPACETIME_DB?.trim() || "watchdog";
const RELAY_URL = (process.env.RELAY_URL?.trim() || `http://localhost:${process.env.RELAY_PORT?.trim() || 8787}`).replace(/\/+$/, "");

let conn: DbConnection | null = null;
let device: Device | null = null;
let shown: ShieldState | null = null;

/** The open call's state, or idle when no call is in progress. */
function currentState(db: DbConnection): ShieldState {
  let open: { id: bigint; state: string } | null = null;
  for (const call of db.db.call.iter()) {
    if (call.endedAt === undefined && (!open || call.id > open.id)) open = call;
  }
  return open ? (open.state as ShieldState) : "idle";
}

function render(): void {
  if (!conn || !device) return;
  const state = currentState(conn);
  if (state === shown) return;
  shown = state;
  device.show(state);
}

async function onPress(): Promise<void> {
  console.log("[button] Press: asking Watchdog to join the call");
  try {
    const res = await fetch(`${RELAY_URL}/protect`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = (await res.json()) as { ok?: boolean; error?: string; message?: string };
    console.log(`[button] /protect: ${body.ok ? body.message ?? "ok" : body.error ?? res.status}`);
  } catch {
    console.warn(`[button] The relay at ${RELAY_URL} is not reachable.`);
  }
}

async function onLongPress(): Promise<void> {
  console.log("[button] Long press: arming the guard");
  try {
    if (!conn) throw new Error("not connected");
    await conn.reducers.armGuard({});
  } catch (e) {
    console.warn(`[button] arm_guard failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function connect(): void {
  DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(SPACETIME_DB)
    .onConnect((db) => {
      console.log(`[button] Connected to ${SPACETIME_URI} / ${SPACETIME_DB}`);
      db.db.call.onInsert(render);
      db.db.call.onUpdate(render);
      db.db.call.onDelete(render);
      db.subscriptionBuilder()
        .onApplied(() => {
          conn = db;
          shown = null;
          render();
        })
        .subscribe("SELECT * FROM call");
    })
    .onConnectError(() => {
      console.warn(`[button] Waiting for SpacetimeDB at ${SPACETIME_URI}`);
      setTimeout(connect, 2000);
    })
    .onDisconnect(() => {
      conn = null;
      console.warn("[button] Lost the SpacetimeDB connection. Reconnecting...");
      setTimeout(connect, 2000);
    })
    .build();
}

device = await openDevice({ onPress: () => void onPress(), onLongPress: () => void onLongPress() }, process.argv.includes("--keyboard"));
connect();

process.on("SIGINT", () => {
  device?.close();
  process.exit(0);
});
