import { execFileSync } from 'node:child_process';
import { hasStoredTransferId } from './nessie-transfer-id.ts';

const DB = process.env.SPACETIME_DATABASE ?? 'scamshield-dev';
const SERVER = (process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000').replace(/^ws/, 'http');

function call(name: string, json: string): void {
  execFileSync('spacetime', ['call', '--server', SERVER, '--no-config', DB, name, json], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function sql(query: string): Promise<unknown[][]> {
  const res = await fetch(`${SERVER}/v1/database/${DB}/sql`, { method: 'POST', body: query });
  const body = (await res.json()) as { rows: unknown[][] }[];
  return body[0]?.rows ?? [];
}

function tag(status: unknown): string {
  if (status && typeof status === 'object' && 'tag' in status) return String((status as { tag: string }).tag);
  if (Array.isArray(status)) return status[0] === 0 ? 'ActiveOrSome' : 'Other';
  return String(status);
}

function isHeld(status: unknown): boolean {
  if (status && typeof status === 'object' && 'tag' in status) return (status as { tag: string }).tag === 'Held';
  if (Array.isArray(status)) return status[0] === 2; // Pending=0, Approved=1, Held=2
  return false;
}

function isFailed(status: unknown): boolean {
  if (status && typeof status === 'object' && 'tag' in status) return (status as { tag: string }).tag === 'Failed';
  if (Array.isArray(status)) return status[0] === 4; // Pending=0, Approved=1, Held=2, Completed=3, Failed=4
  return false;
}

call('start_call_session', JSON.stringify({
  userId: 'demo-user',
  callerNumber: { some: '+1555' },
  twilioCallSid: { some: 'CA-accept' },
}));
const sessions = await sql('SELECT id, user_id, risk_score, status FROM call_sessions');
const sessionId = sessions.map((r) => Number(r[0])).sort((a, b) => b - a)[0];
if (!sessionId) throw new Error('start_call_session produced no call_sessions row');

call('record_risk_event', JSON.stringify({
  sessionId,
  signalType: 'payment_request',
  transcriptExcerpt: 'wire the money today',
  riskScoreAfter: 94,
  warningMessage: { some: 'Hang up' },
}));
call('request_transfer', JSON.stringify({
  userId: 'demo-user',
  amountCents: 200000,
  destinationAccount: 'scammer-account',
  memo: { some: 'urgent' },
}));
const demoIntents = await sql(
  "SELECT id, user_id, status, hold_reason, risk_score_at_decision FROM transfer_intents WHERE user_id = 'demo-user'"
);
const demo = demoIntents.at(-1);
if (!demo || !isHeld(demo[2])) throw new Error(`expected demo-user Held, got ${JSON.stringify(demo)}`);
if (!/Come to the bank/.test(JSON.stringify(demo[3]))) {
  throw new Error(`expected bank hold copy, got ${JSON.stringify(demo[3])}`);
}

call('request_transfer', JSON.stringify({
  userId: 'someone-else',
  amountCents: 5000,
  destinationAccount: 'other',
  memo: { none: [] },
}));
const other = (await sql("SELECT id, user_id, status FROM transfer_intents WHERE user_id = 'someone-else'")).at(-1);
if (!other || isHeld(other[2])) throw new Error(`someone-else should not be Held, got ${JSON.stringify(other)}`);
// The worker refuses to post any user other than demo-user to NESSIE_ACCOUNT_ID.
// fail_transfer only clears a still-Approved row when the worker is not running; it is not the debit gate.
try {
  call('fail_transfer', JSON.stringify({
    intentId: Number(other[0]),
    reason: 'acceptance: do not send',
  }));
} catch {
  // A running worker may already have failed this row without calling Nessie.
}
const failed = (await sql("SELECT id, status, nessie_transfer_id FROM transfer_intents WHERE user_id = 'someone-else'")).at(-1);
const sent = hasStoredTransferId(failed?.[2]);
if (!failed || Number(failed[0]) !== Number(other[0]) || !isFailed(failed[1]) || sent) {
  throw new Error(`someone-else must be Failed with no Nessie transfer id, got ${JSON.stringify(failed)}`);
}

let expireFailed = false;
try {
  call('expire_held_transfer', JSON.stringify({ intentId: Number(demo[0]) }));
} catch {
  expireFailed = true;
}
if (!expireFailed) throw new Error('expire_held_transfer must reject a hold that is still inside 4 hours');

console.log('acceptance ok', { sessionId, tag: tag(demo[2]) });
