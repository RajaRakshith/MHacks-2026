import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

loadDotenv({ path: resolve(REPO_ROOT, ".env"), quiet: true });

const text = (name: string): string => (process.env[name] ?? "").trim();
const flag = (value: string): boolean => /^(1|true|yes|on)$/i.test(value);

export const env = {
  // Mock first: with MOCK unset the relay still runs the whole demo from fixtures.
  mock: text("MOCK") === "" ? true : flag(text("MOCK")),
  spacetimeUri: text("SPACETIME_URI") || "ws://127.0.0.1:3000",
  spacetimeDb: text("SPACETIME_DB") || "scamshield",
  // SPEC-QUESTION: set_secret is owner only, so the relay has to connect as the
  // identity that published the module. `pnpm dev` passes the CLI's token here;
  // when it is unset the relay asks the `spacetime` CLI for it.
  spacetimeToken: text("SPACETIME_TOKEN"),
  nessieKey: text("NESSIE_KEY"),
  nessieBase: text("NESSIE_BASE"),
  geminiKey: text("GEMINI_API_KEY"),
  geminiModel: text("GEMINI_MODEL"),
  elevenLabsKey: text("ELEVENLABS_API_KEY"),
  twilioSid: text("TWILIO_ACCOUNT_SID"),
  twilioToken: text("TWILIO_AUTH_TOKEN"),
  twilioNumber: text("TWILIO_NUMBER"),
  customerPhone: text("CUSTOMER_PHONE"),
  publicUrl: text("PUBLIC_URL").replace(/\/+$/, ""),
  port: Number(text("RELAY_PORT") || 8787),
};

export interface Seed {
  customerId: string;
  accountId: string;
  payees: { name: string; nessieAccountId: string; trusted: boolean }[];
}

/** Mock mode reads the bundled seed; real mode reads .seed.json written by `pnpm seed`. */
export function loadSeed(): Seed | null {
  const path = env.mock ? resolve(REPO_ROOT, "fixtures/nessie/seed.json") : resolve(REPO_ROOT, ".seed.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Seed;
}
