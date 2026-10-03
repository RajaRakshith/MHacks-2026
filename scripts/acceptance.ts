/**
 * End-to-end acceptance check (section 8), against a running `pnpm dev`.
 *
 *   pnpm acceptance            # all four scenarios at 8x, then the demo flow
 *   pnpm acceptance --speed 1  # real time
 *
 * It resets nothing: run `pnpm reset` first for a clean database.
 */

import { execFileSync } from "node:child_process";

const RELAY = process.env.RELAY_URL ?? "http://localhost:8787";
const DB = process.env.SPACETIME_DB ?? "scamshield";
const SERVER = (process.env.SPACETIME_URI ?? "ws://127.0.0.1:3000").replace(/^ws/, "http");
const speedArg = process.argv.indexOf("--speed");
const SPEED = speedArg > 0 ? Number(process.argv[speedArg + 1]) : 8;

interface Verdict { claim: { kind: string; amount?: number; payee?: string; merchant?: string }; claimTrue: boolean; evidence: string }
interface SimResult { ok: boolean; completed: boolean; score: number; state: string; verdicts: Verdict[]; error?: string }

interface Expectation {
  scenario: string;
  state: string;
  check: (r: SimResult) => string | null;
}

const oneFalse = (kind: string, extra?: (v: Verdict) => boolean) => (r: SimResult): string | null => {
  if (r.verdicts.length !== 1) return `expected 1 verdict, got ${r.verdicts.length}`;
  const v = r.verdicts[0]!;
  if (v.claim.kind !== kind) return `expected a ${kind} claim, got ${v.claim.kind}`;
  if (v.claimTrue) return `expected the ${kind} claim to be false`;
  if (extra && !extra(v)) return `unexpected evidence: ${v.evidence}`;
  return null;
};

const EXPECTED: Expectation[] = [
  { scenario: "refund-overpayment", state: "scam_likely", check: oneFalse("deposit", (v) => v.claim.amount === 900 && v.evidence === "No $900 deposit in the last 30 days.") },
  { scenario: "fake-fraud-alert", state: "scam_likely", check: oneFalse("charge") },
  { scenario: "utility-shutoff", state: "scam_likely", check: oneFalse("bill", (v) => v.evidence.includes("$94")) },
  { scenario: "legit-pharmacy", state: "listening", check: (r) => (r.verdicts.length === 0 && r.score < 40 ? null : `expected no verdicts and a score under 40, got ${r.verdicts.length} and ${r.score}`) },
];

let failures = 0;
const pass = (msg: string): void => console.log(`  ok    ${msg}`);
const fail = (msg: string): void => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};

async function simulate(scenario: string, endWhenDone: boolean): Promise<SimResult> {
  const res = await fetch(`${RELAY}/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario, speed: SPEED, wait: true, endWhenDone }),
  });
  return (await res.json()) as SimResult;
}

function call(name: string, ...args: string[]): unknown[] {
  const out = execFileSync("spacetime", ["call", "--server", SERVER, "--no-config", DB, name, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const line = out.split("\n").reverse().find((l) => l.trim().startsWith("["));
  return line ? (JSON.parse(line) as unknown[]) : [];
}

async function sql(query: string): Promise<unknown[][]> {
  const res = await fetch(`${SERVER}/v1/database/${DB}/sql`, { method: "POST", body: query });
  const body = (await res.json()) as { rows: unknown[][] }[];
  return body[0]?.rows ?? [];
}

console.log(`Scenarios at ${SPEED}x (relay ${RELAY})`);
for (const expected of EXPECTED) {
  const r = await simulate(expected.scenario, true);
  if (!r.ok) {
    fail(`${expected.scenario}: ${r.error ?? "simulate failed"}`);
    continue;
  }
  const problems = [
    r.completed ? null : "playback did not complete",
    r.state === expected.state ? null : `state ${r.state}, expected ${expected.state}`,
    expected.check(r),
  ].filter(Boolean);
  if (problems.length) fail(`${expected.scenario}: ${problems.join("; ")}`);
  else pass(`${expected.scenario}: ${r.state}, score ${r.score}${r.verdicts[0] ? `, "${r.verdicts[0].evidence}"` : ""}`);
}

console.log("Demo flow: scam call, then $2,000 to Account Services");
const demo = await simulate("refund-overpayment", false);
if (demo.state === "scam_likely") pass("refund-overpayment reaches scam_likely with the call still open");
else fail(`demo call ended in ${demo.state}`);

const protectedBefore = (await sql("SELECT amount FROM hold WHERE status = 'held'")).length;
const transfer = call("request_transfer", '"Account Services"', "2000", '"refund"', '{"none":[]}');
if (transfer[0] === "held" && transfer[1] === "Held: new payee during a suspicious call") pass(`transfer came back Held: "${String(transfer[1])}"`);
else fail(`transfer came back ${JSON.stringify(transfer)}`);

const held = await sql("SELECT amount FROM hold WHERE status = 'held'");
if (held.length === protectedBefore + 1 && held.some((row) => row[0] === 2000)) pass("the $2,000 hold is in the Held panel");
else fail(`expected one more held row, found ${held.length - protectedBefore}`);

const trusted = call("request_transfer", '"Oakwood Apartments"', "5", '"test"', '{"none":[]}');
if (trusted[0] === "sent") pass("a trusted payee is still paid while the guard is armed");
else fail(`trusted payee transfer came back ${JSON.stringify(trusted)}`);

console.log(failures === 0 ? "\nAll acceptance checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
