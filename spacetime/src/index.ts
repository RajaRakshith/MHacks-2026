/**
 * ScamShield module: reducers and procedures from section 6.2.
 *
 * Reducers only change state. Anything that calls an external API (Gemini,
 * Nessie) is a procedure, and every procedure follows the same shape:
 *   1. a short transaction to read what it needs,
 *   2. HTTP calls with no transaction open,
 *   3. a short transaction to write the results.
 */

import {
  ANALYSIS_WINDOW_MS, CAUTION_THRESHOLD, DIGITS_ALERT_MESSAGE, GUARD_ARM_MS, HOLD_TTL_MS, SCAM_THRESHOLD,
  amountProblem, availableBalance, buildActivity, buildBills, claimKey, crossed, digitsMatch, evaluateTransfer, hashLast4, isGuardArmed,
  isTrustedPayee, isoDay, last4Of, mergeAnalyzerOutputs, parseAnalyzerJson, redactAnalyzerOutput, redactDigits,
  scoreCall, stateForScore, transcriptWindow, transferKindFor, verifyClaim,
  type AnalyzerOutput, type Claim, type Tactic, type Verdict,
} from '@scamshield/core';
import { Timestamp } from 'spacetimedb';
import { SenderError, t, type InferSchema, type ProcedureCtx, type ReducerCtx } from 'spacetimedb/server';
import { DEFAULT_GEMINI_MODEL, analyzeWithGemini } from './gemini';
import { MOCK_REPORTED_NUMBERS, mockAccountData, type MockTxn } from './mock';
import { DEFAULT_NESSIE_BASE, fetchAccountData, fetchForClaims, sendMoney, withdrawalDescription, type AccountFetch, type NessieEnv } from './nessie';
import spacetimedb from './schema';

export default spacetimedb;

type Schema = InferSchema<typeof spacetimedb>;
type Tx = ReducerCtx<Schema>;
type Proc = ProcedureCtx<Schema>;

const SINGLETON = 0;
const OWNER = 'OWNER';

const toMs = (ts: Timestamp): number => Number(ts.microsSinceUnixEpoch / 1000n);
const fromMs = (ms: number): Timestamp => new Timestamp(BigInt(Math.round(ms)) * 1000n);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function requireOwner(ctx: Tx): void {
  const owner = ctx.db.secret.name.find(OWNER);
  if (!owner || owner.value !== ctx.sender.toHexString()) {
    throw new SenderError('Only the database owner can do this.');
  }
}

interface Env {
  mock: boolean;
  nessie: NessieEnv;
  geminiKey: string;
  geminiModel: string;
  supportsPurchases: boolean;
  supportsTransfers: boolean;
}

function readEnv(tx: Tx): Env {
  const config = tx.db.config.id.find(SINGLETON);
  const secret = (name: string): string => tx.db.secret.name.find(name)?.value ?? '';
  return {
    mock: config?.mock ?? true,
    nessie: { base: secret('NESSIE_BASE') || DEFAULT_NESSIE_BASE, key: secret('NESSIE_KEY'), accountId: config?.accountId ?? '' },
    geminiKey: secret('GEMINI_API_KEY'),
    geminiModel: secret('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL,
    supportsPurchases: config?.supportsPurchases ?? false,
    supportsTransfers: config?.supportsTransfers ?? false,
  };
}

const readMockTxns = (tx: Tx): MockTxn[] => [...tx.db.mockTxn.iter()];

function findPayee(tx: Tx, name: string) {
  const exact = tx.db.payee.name.find(name);
  if (exact) return exact;
  const wanted = name.toLowerCase();
  for (const row of tx.db.payee.iter()) if (row.name.toLowerCase() === wanted) return row;
  return null;
}

function extendGuard(tx: Tx): void {
  const until = fromMs(toMs(tx.timestamp) + GUARD_ARM_MS);
  const row = tx.db.guard.id.find(SINGLETON);
  if (!row) tx.db.guard.insert({ id: SINGLETON, armedUntil: until });
  else if (row.armedUntil.microsSinceUnixEpoch < until.microsSinceUnixEpoch) tx.db.guard.id.update({ ...row, armedUntil: until });
}

/** Holds expire after 24 hours. */
function expireHolds(tx: Tx): void {
  const now = tx.timestamp.microsSinceUnixEpoch;
  for (const row of [...tx.db.hold.iter()]) {
    if (row.status === 'held' && row.expiresAt.microsSinceUnixEpoch <= now) tx.db.hold.id.update({ ...row, status: 'expired' });
  }
}

// ---------------------------------------------------------------------------
// Account refresh (section 5)
// ---------------------------------------------------------------------------

function loadAccount(ctx: Proc, env: Env, sent: readonly MockTxn[]): AccountFetch | { error: string } {
  if (env.mock) {
    // Mock data mirrors the live API: purchases and transfers are both available.
    return { data: mockAccountData(toMs(ctx.timestamp), sent), supportsPurchases: true, supportsTransfers: true };
  }
  if (!env.nessie.key) return { error: 'NESSIE_KEY is not set.' };
  if (!env.nessie.accountId) return { error: 'No account id. Run `pnpm seed` first.' };
  return fetchAccountData(ctx.http, env.nessie);
}

/** Rewrites account_snapshot, activity, and bill, and records the probe results in config. */
function writeAccount(tx: Tx, fetched: AccountFetch): void {
  const { account, customer } = fetched.data;
  const snapshot = {
    id: SINGLETON,
    name: customer ? `${customer.first_name} ${customer.last_name}`.trim() : 'Customer',
    nickname: account.nickname || account.type || 'Account',
    // Only the last 4 digits are ever kept. The full number is never stored or logged.
    last4: last4Of(account.account_number ?? '') ?? '',
    balance: availableBalance(fetched.data),
  };
  if (tx.db.accountSnapshot.id.find(SINGLETON)) tx.db.accountSnapshot.id.update(snapshot);
  else tx.db.accountSnapshot.insert(snapshot);

  const known = new Map<string, number>();
  for (const old of tx.db.activity.iter()) known.set(old.id, old.sortIndex);
  const activity = buildActivity(fetched.data, 25, known).map((item, sortIndex) => ({ ...item, sortIndex }));
  const activityIds = new Set(activity.map((a) => a.id));
  for (const old of [...tx.db.activity.iter()]) if (!activityIds.has(old.id)) tx.db.activity.id.delete(old.id);
  for (const row of activity) {
    const old = tx.db.activity.id.find(row.id);
    if (!old) tx.db.activity.insert(row);
    else if (old.sortIndex !== row.sortIndex || old.amount !== row.amount || old.date !== row.date || old.description !== row.description || old.kind !== row.kind) {
      tx.db.activity.id.update(row);
    }
  }

  const bills = buildBills(fetched.data.bills);
  const billIds = new Set(bills.map((b) => b.id));
  for (const old of [...tx.db.bill.iter()]) if (!billIds.has(old.id)) tx.db.bill.id.delete(old.id);
  for (const row of bills) {
    const old = tx.db.bill.id.find(row.id);
    if (!old) tx.db.bill.insert(row);
    else if (old.amount !== row.amount || old.paymentDate !== row.paymentDate || old.status !== row.status || old.payee !== row.payee) {
      tx.db.bill.id.update(row);
    }
  }

  const config = tx.db.config.id.find(SINGLETON);
  if (config && (config.supportsPurchases !== fetched.supportsPurchases || config.supportsTransfers !== fetched.supportsTransfers)) {
    tx.db.config.id.update({ ...config, supportsPurchases: fetched.supportsPurchases, supportsTransfers: fetched.supportsTransfers });
  }

  expireHolds(tx);
}

function refresh(ctx: Proc): { ok: boolean; message: string } {
  const before = ctx.withTx((tx) => ({ env: readEnv(tx), sent: readMockTxns(tx) }));
  const fetched = loadAccount(ctx, before.env, before.sent);
  if ('error' in fetched) {
    console.warn(`refresh_account: ${fetched.error}`);
    return { ok: false, message: fetched.error };
  }
  ctx.withTx((tx) => writeAccount(tx, fetched));
  return { ok: true, message: 'Account refreshed.' };
}

// ---------------------------------------------------------------------------
// Lifecycle and owner-only setup
// ---------------------------------------------------------------------------

export const init = spacetimedb.init((ctx) => {
  ctx.db.secret.insert({ name: OWNER, value: ctx.sender.toHexString() });
  ctx.db.guard.insert({ id: SINGLETON, armedUntil: new Timestamp(0n) });
  ctx.db.config.insert({ id: SINGLETON, mock: true, accountId: '', supportsPurchases: false, supportsTransfers: false });
  for (const row of MOCK_REPORTED_NUMBERS) ctx.db.reportedNumber.insert({ number: row.number, reports: row.reports });
});

/** Stores an API key. Owner only: the relay calls this once at startup. */
export const setSecret = spacetimedb.reducer({ name: t.string(), value: t.string() }, (ctx, { name, value }) => {
  requireOwner(ctx);
  if (name === OWNER) throw new SenderError('That name is reserved.');
  const row = ctx.db.secret.name.find(name);
  if (row) ctx.db.secret.name.update({ name, value });
  else ctx.db.secret.insert({ name, value });
});

// SPEC-QUESTION: section 6.2 has no reducer that fills `config.mock` and
// `config.account_id`, or that seeds trusted payees. These two owner-only
// reducers do it; the relay calls them at startup, right after set_secret.
export const setConfig = spacetimedb.reducer({ mock: t.bool(), accountId: t.string() }, (ctx, { mock, accountId }) => {
  requireOwner(ctx);
  const row = ctx.db.config.id.find(SINGLETON);
  if (row) ctx.db.config.id.update({ ...row, mock, accountId });
  else ctx.db.config.insert({ id: SINGLETON, mock, accountId, supportsPurchases: false, supportsTransfers: false });
});

export const seedPayee = spacetimedb.reducer(
  { name: t.string(), nessieAccountId: t.string(), trusted: t.bool() },
  (ctx, { name, nessieAccountId, trusted }) => {
    requireOwner(ctx);
    const row = ctx.db.payee.name.find(name);
    if (row) ctx.db.payee.name.update({ ...row, nessieAccountId, trusted });
    else ctx.db.payee.insert({ name, nessieAccountId, trusted, timesPaid: 0 });
  }
);

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/** Creates a call in state `listening`. Any call still open is ended first: one customer, one phone. */
export const startCall = spacetimedb.reducer({ callerNumber: t.string() }, (ctx, { callerNumber }) => {
  for (const open of [...ctx.db.call.iter()]) {
    if (open.endedAt === undefined) ctx.db.call.id.update({ ...open, endedAt: ctx.timestamp });
  }
  const callerReported = ctx.db.reportedNumber.number.find(callerNumber) !== null;
  const score = scoreCall({ tactics: [], verdicts: [], callerReported, digitsMatched: false });
  ctx.db.call.insert({ id: 0n, callerNumber, startedAt: ctx.timestamp, endedAt: undefined, score, state: stateForScore(score) });
});

export const addTranscript = spacetimedb.reducer(
  { callId: t.u64(), speaker: t.string(), text: t.string(), atMs: t.u32(), labelsJson: t.option(t.string()) },
  (ctx, { callId, speaker, text, atMs, labelsJson }) => {
    if (!ctx.db.call.id.find(callId)) throw new SenderError(`No call ${callId}.`);
    if (speaker !== 'caller' && speaker !== 'customer') throw new SenderError('speaker must be "caller" or "customer".');
    const mock = ctx.db.config.id.find(SINGLETON)?.mock ?? true;
    // Labels are a mock-mode stand-in for Gemini. They are re-serialized so a
    // spoken card number never reaches the table in full.
    const labels = mock && labelsJson ? JSON.stringify(redactAnalyzerOutput(parseAnalyzerJson(labelsJson))) : undefined;
    ctx.db.transcript.insert({ id: 0n, callId, atMs, speaker, text: redactDigits(text), labelsJson: labels });
  }
);

export const endCall = spacetimedb.reducer({ callId: t.u64() }, (ctx, { callId }) => {
  const row = ctx.db.call.id.find(callId);
  if (!row) throw new SenderError(`No call ${callId}.`);
  if (row.endedAt === undefined) ctx.db.call.id.update({ ...row, endedAt: ctx.timestamp });
});

/** "I'm on a suspicious call": protects transfers for 4 hours without joining a call. */
export const armGuard = spacetimedb.reducer((ctx) => {
  extendGuard(ctx);
});

// ---------------------------------------------------------------------------
// analyze_call (sections 3.3 to 3.5)
// ---------------------------------------------------------------------------

const AnalyzeResult = t.object('AnalyzeResult', {
  ok: t.bool(),
  score: t.u32(),
  state: t.string(),
  message: t.string(),
});

export const analyzeCall = spacetimedb.procedure({ callId: t.u64() }, AnalyzeResult, (ctx, { callId }) => {
  // 1. Read.
  const input = ctx.withTx((tx) => {
    const call = tx.db.call.id.find(callId);
    if (!call) return null;
    const knownClaims: string[] = [];
    for (const row of tx.db.verdict.callId.filter(callId)) {
      try {
        knownClaims.push(claimKey(JSON.parse(row.claimJson) as Claim));
      } catch {
        // A row we cannot parse cannot collide with a new claim.
      }
    }
    return {
      env: readEnv(tx),
      call,
      lines: transcriptWindow([...tx.db.transcript.callId.filter(callId)], ANALYSIS_WINDOW_MS),
      knownClaims,
      last4: tx.db.accountSnapshot.id.find(SINGLETON)?.last4 ?? '',
      sent: readMockTxns(tx),
    };
  });
  if (!input) return { ok: false, score: 0, state: 'idle', message: `No call ${callId}.` };
  const { env, call, lines } = input;
  const nowMs = toMs(ctx.timestamp);

  // 2. Analyze. Mock mode uses the labels attached to fixture lines; real mode asks Gemini.
  let output: AnalyzerOutput;
  if (env.mock) {
    output = mergeAnalyzerOutputs(lines.map((l) => parseAnalyzerJson(l.labelsJson)));
  } else {
    if (!env.geminiKey) return { ok: false, score: call.score, state: call.state, message: 'GEMINI_API_KEY is not set.' };
    const result = analyzeWithGemini(ctx.http, env.geminiKey, env.geminiModel, call.callerNumber, lines);
    if (!result.ok) {
      console.warn(`analyze_call: ${result.error}`);
      return { ok: false, score: call.score, state: call.state, message: result.error };
    }
    output = result.output;
  }

  // 3. Verify claims we have not checked yet against the customer's own account.
  const known = new Set(input.knownClaims);
  const newClaims = output.claims.filter((c) => !known.has(claimKey(c)));
  const verdicts: Verdict[] = [];
  if (newClaims.length > 0) {
    const data = env.mock ? mockAccountData(nowMs, input.sent) : fetchForClaims(ctx.http, env.nessie, newClaims, env.supportsPurchases);
    for (const claim of newClaims) {
      const verdict = verifyClaim(claim, data, nowMs);
      if (verdict) verdicts.push(verdict);
    }
  }
  const accountHash = hashLast4(input.last4);
  const digitsMatched = !!output.digitsSpoken && accountHash !== null && digitsMatch(output.digitsSpoken, accountHash);

  // 4. Write tactics, verdicts, the new score, and any actions in one transaction.
  return ctx.withTx((tx) => {
    const current = tx.db.call.id.find(callId);
    if (!current) return { ok: false, score: 0, state: 'idle', message: `No call ${callId}.` };

    const tactics = new Set<string>();
    for (const row of tx.db.tacticHit.callId.filter(callId)) tactics.add(row.tactic);
    for (const tactic of output.tactics) {
      if (tactics.has(tactic)) continue;
      tactics.add(tactic);
      tx.db.tacticHit.insert({ id: 0n, callId, tactic });
    }

    const outcomes: { claimTrue: boolean }[] = [];
    const seen = new Set<string>();
    for (const row of tx.db.verdict.callId.filter(callId)) {
      outcomes.push({ claimTrue: row.claimTrue });
      try {
        seen.add(claimKey(JSON.parse(row.claimJson) as Claim));
      } catch {
        // See above.
      }
    }
    for (const verdict of verdicts) {
      const key = claimKey(verdict.claim);
      if (seen.has(key)) continue; // another analyze_call got there first
      seen.add(key);
      outcomes.push({ claimTrue: verdict.claimTrue });
      tx.db.verdict.insert({ id: 0n, callId, claimJson: JSON.stringify(verdict.claim), claimTrue: verdict.claimTrue, evidence: verdict.evidence });
    }

    let digitsAlerted = false;
    for (const row of tx.db.alert.callId.filter(callId)) if (row.kind === 'digits_match') digitsAlerted = true;
    if (digitsMatched && !digitsAlerted) {
      tx.db.alert.insert({ id: 0n, callId, kind: 'digits_match', message: DIGITS_ALERT_MESSAGE, createdAt: tx.timestamp });
      digitsAlerted = true;
    }

    const score = scoreCall({
      tactics: [...tactics] as Tactic[],
      verdicts: outcomes,
      callerReported: tx.db.reportedNumber.number.find(current.callerNumber) !== null,
      digitsMatched: digitsAlerted,
    });
    const state = stateForScore(score);

    if (crossed(current.score, score, SCAM_THRESHOLD)) {
      extendGuard(tx);
      tx.db.alert.insert({
        id: 0n, callId, kind: 'scam_likely', createdAt: tx.timestamp,
        message: 'This call looks like a scam. Hang up. Your transfers are protected for the next 4 hours.',
      });
    } else if (crossed(current.score, score, CAUTION_THRESHOLD)) {
      tx.db.alert.insert({
        id: 0n, callId, kind: 'caution', createdAt: tx.timestamp,
        message: 'Be careful. This call shows signs of a scam. Do not share codes or send money.',
      });
    }

    if (score !== current.score || state !== current.state) tx.db.call.id.update({ ...current, score, state });
    return { ok: true, score, state, message: '' };
  });
});

// ---------------------------------------------------------------------------
// Money (section 4). request_transfer is the only way money leaves from the dashboard.
// ---------------------------------------------------------------------------

const RefreshResult = t.object('RefreshResult', { ok: t.bool(), message: t.string() });

export const refreshAccount = spacetimedb.procedure(RefreshResult, (ctx) => refresh(ctx));

const TransferResult = t.object('TransferResult', {
  // sent | held | needs_confirmation | error
  outcome: t.string(),
  message: t.string(),
  // Which row of the rules table decided (1 to 7); 0 for errors and approvals.
  rule: t.u32(),
  // True when the payment was posted to Nessie as a withdrawal.
  viaWithdrawal: t.bool(),
});

interface Payment {
  env: Env;
  payeeName: string;
  cash: boolean;
  amount: number;
}

const errorResult = (message: string) => ({ outcome: 'error', message, rule: 0, viaWithdrawal: false });

const checkAmount = (tx: Tx, amount: number): string | null => amountProblem(amount, tx.db.accountSnapshot.id.find(SINGLETON)?.balance);

/** Sends a payment that has already passed the rules (or a family approval), then refreshes. */
function pay(ctx: Proc, p: Payment): { ok: true; viaWithdrawal: boolean } | { ok: false; error: string } {
  const date = isoDay(toMs(ctx.timestamp));
  const asTransfer = !p.cash && p.env.supportsTransfers;
  let viaWithdrawal = !p.cash && !asTransfer;
  if (!p.env.mock) {
    const sent = sendMoney(ctx.http, p.env.nessie, { amount: p.amount, date, payeeName: p.payeeName, cash: p.cash, supportsTransfers: p.env.supportsTransfers });
    if (!sent.ok) return sent;
    viaWithdrawal = sent.viaWithdrawal;
  }

  ctx.withTx((tx) => {
    if (p.env.mock) {
      tx.db.mockTxn.insert({ id: 0n, kind: asTransfer ? 'transfer' : 'withdrawal', date, description: withdrawalDescription(p.payeeName, p.cash), amount: p.amount });
    }
    if (p.cash) return;
    const row = findPayee(tx, p.payeeName);
    if (row) tx.db.payee.name.update({ ...row, timesPaid: row.timesPaid + 1 });
    else tx.db.payee.insert({ name: p.payeeName, nessieAccountId: '', trusted: false, timesPaid: 1 });
  });

  refresh(ctx);
  return { ok: true, viaWithdrawal };
}

// SPEC-QUESTION: `confirmed` is not in the spec's signature. Rule 6 asks
// "Continue?", so the dashboard needs a way to say yes: it calls again with confirmed = true.
export const requestTransfer = spacetimedb.procedure(
  { payee: t.string(), amount: t.f64(), memo: t.string(), confirmed: t.option(t.bool()) },
  TransferResult,
  (ctx, { payee, amount, memo, confirmed }) => {
    // The rules run against the current guard and payee rows BEFORE anything is sent to Nessie.
    const plan = ctx.withTx((tx) => {
      const name = payee.trim();
      if (!name) return { step: 'done' as const, result: errorResult('Choose or type a payee.') };
      const amountError = checkAmount(tx, amount);
      if (amountError) return { step: 'done' as const, result: errorResult(amountError) };

      const row = findPayee(tx, name);
      const payeeName = row?.name ?? name;
      const kind = transferKindFor(name);
      const guard = tx.db.guard.id.find(SINGLETON);
      const decision = evaluateTransfer(
        { payee: payeeName, amount, memo, kind },
        { guardArmed: guard ? isGuardArmed(toMs(guard.armedUntil), toMs(tx.timestamp)) : false, payeeTrusted: isTrustedPayee(row) }
      );

      if (decision.decision === 'hold') {
        tx.db.hold.insert({
          id: 0n, payee: payeeName, amount, memo, reason: decision.message, status: 'held',
          createdAt: tx.timestamp, expiresAt: fromMs(toMs(tx.timestamp) + HOLD_TTL_MS),
        });
        return { step: 'done' as const, result: { outcome: 'held', message: decision.message, rule: decision.rule, viaWithdrawal: false } };
      }
      if (decision.decision === 'needs_confirmation' && confirmed !== true) {
        return { step: 'done' as const, result: { outcome: 'needs_confirmation', message: decision.message, rule: decision.rule, viaWithdrawal: false } };
      }
      return {
        step: 'send' as const,
        rule: decision.rule,
        warning: decision.decision === 'allow' ? decision.message ?? '' : '',
        payment: { env: readEnv(tx), payeeName, cash: kind === 'cash_withdrawal', amount },
      };
    });
    if (plan.step === 'done') return plan.result;

    const sent = pay(ctx, plan.payment);
    if (!sent.ok) return errorResult(`The payment did not go through. ${sent.error}`);
    return { outcome: 'sent', message: plan.warning, rule: plan.rule, viaWithdrawal: sent.viaWithdrawal };
  }
);

/** Sends a held transfer to Nessie. In the MVP, Approve stands in for family approval. */
export const approveHold = spacetimedb.procedure({ holdId: t.u64() }, TransferResult, (ctx, { holdId }) => {
  const plan = ctx.withTx((tx) => {
    expireHolds(tx);
    const row = tx.db.hold.id.find(holdId);
    if (!row) return { error: `No hold ${holdId}.` };
    if (row.status !== 'held') return { error: `This transfer is already ${row.status}.` };
    const amountError = checkAmount(tx, row.amount);
    if (amountError) return { error: amountError };
    // Marked approved before sending so two approvals cannot both send it.
    tx.db.hold.id.update({ ...row, status: 'approved' });
    return { payment: { env: readEnv(tx), payeeName: row.payee, cash: transferKindFor(row.payee) === 'cash_withdrawal', amount: row.amount } };
  });
  if (!plan.payment) return errorResult(plan.error);

  const sent = pay(ctx, plan.payment);
  if (!sent.ok) {
    ctx.withTx((tx) => {
      const row = tx.db.hold.id.find(holdId);
      if (row && row.status === 'approved') tx.db.hold.id.update({ ...row, status: 'held' });
    });
    return errorResult(`The payment did not go through. ${sent.error}`);
  }
  return { outcome: 'sent', message: '', rule: 0, viaWithdrawal: sent.viaWithdrawal };
});

export const rejectHold = spacetimedb.reducer({ holdId: t.u64() }, (ctx, { holdId }) => {
  const row = ctx.db.hold.id.find(holdId);
  if (!row) throw new SenderError(`No hold ${holdId}.`);
  if (row.status !== 'held') throw new SenderError(`This transfer is already ${row.status}.`);
  ctx.db.hold.id.update({ ...row, status: 'rejected' });
});
