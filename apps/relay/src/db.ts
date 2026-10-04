import { execFileSync } from "node:child_process";
import { DbConnection } from "@watchdog/bindings";
import { env, loadSeed } from "./env";

export type Db = DbConnection;

let current: Db | null = null;

/** The live connection. Throws while the relay is (re)connecting. */
export function db(): Db {
  if (!current) throw new Error("Not connected to SpacetimeDB yet.");
  return current;
}

export const isConnected = (): boolean => current !== null;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function ownerToken(): string | undefined {
  if (env.spacetimeToken) return env.spacetimeToken;
  try {
    const out = execFileSync("spacetime", ["login", "show", "--token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /auth token[^\n]*\bis\s+(\S+)/i.exec(out)?.[1];
  } catch {
    return undefined;
  }
}

function connectOnce(token: string | undefined): Promise<Db> {
  return new Promise((resolve, reject) => {
    const conn = DbConnection.builder()
      .withUri(env.spacetimeUri)
      .withDatabaseName(env.spacetimeDb)
      .withToken(token)
      .onConnect((connected) => {
        connected
          .subscriptionBuilder()
          .onApplied(() => resolve(connected))
          .onError(() => reject(new Error("Subscription failed.")))
          .subscribe(["SELECT * FROM call", "SELECT * FROM config", "SELECT * FROM verdict"]);
      })
      .onConnectError((_ctx, error) => reject(error))
      .onDisconnect(() => {
        // Only the connection in use triggers a reconnect, not a stale one closing late.
        if (current === conn) {
          console.warn("[relay] Lost the SpacetimeDB connection. Reconnecting...");
          current = null;
          void connectForever();
        }
      })
      .build();
  });
}

let onReady: ((conn: Db) => Promise<void>) | null = null;

async function connectForever(): Promise<void> {
  const token = ownerToken();
  for (let attempt = 1; ; attempt++) {
    try {
      const conn = await connectOnce(token);
      current = conn;
      console.log(`[relay] Connected to ${env.spacetimeUri} / ${env.spacetimeDb}`);
      try {
        await setup(conn);
        if (onReady) await onReady(conn);
      } catch (e) {
        console.error(`[relay] Startup setup failed: ${e instanceof Error ? e.message : String(e)}`);
        console.error("[relay] set_secret is owner only. Run the relay with `pnpm dev`, or set SPACETIME_TOKEN to the publisher's token.");
      }
      return;
    } catch (e) {
      if (attempt === 1 || attempt % 10 === 0) {
        console.warn(`[relay] Waiting for SpacetimeDB at ${env.spacetimeUri} (${e instanceof Error ? e.message : String(e)})`);
      }
      await sleep(1500);
    }
  }
}

/** Connects (and keeps reconnecting). `ready` runs after every successful connect and setup. */
export async function connect(ready: (conn: Db) => Promise<void>): Promise<void> {
  onReady = ready;
  await connectForever();
}

/**
 * Runs once per connection: API keys into the private `secret` table, then
 * config and trusted payees, then the first account refresh.
 */
async function setup(conn: Db): Promise<void> {
  const secrets: Record<string, string> = {
    NESSIE_KEY: env.nessieKey,
    NESSIE_BASE: env.nessieBase,
    GEMINI_API_KEY: env.geminiKey,
    GEMINI_MODEL: env.geminiModel,
  };
  for (const [name, value] of Object.entries(secrets)) {
    if (value) await conn.reducers.setSecret({ name, value });
  }

  const seed = loadSeed();
  if (!seed && !env.mock) console.warn("[relay] No .seed.json. Run `pnpm seed` to create Margaret's account in Nessie.");
  await conn.reducers.setConfig({ mock: env.mock, accountId: seed?.accountId ?? "" });
  for (const payee of seed?.payees ?? []) await conn.reducers.seedPayee(payee);

  await refreshAccount(conn);
}

export async function refreshAccount(conn: Db = db()): Promise<void> {
  const result = await conn.procedures.refreshAccount({});
  if (!result.ok) console.warn(`[relay] refresh_account: ${result.message}`);
}
