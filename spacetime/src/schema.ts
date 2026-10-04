import { schema, table, t } from 'spacetimedb/server';

// Tables from section 6.1. Everything is public except `secret` and `mockTxn`.

const call = table(
  { name: 'call', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    callerNumber: t.string(),
    startedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
    score: t.u32(),
    state: t.string(),
  }
);

const transcript = table(
  { name: 'transcript', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.u64().index('btree'),
    atMs: t.u32(),
    speaker: t.string(),
    text: t.string(),
    // Mock only: the fixture line's labels, used instead of Gemini.
    labelsJson: t.option(t.string()),
  }
);

const tacticHit = table(
  { name: 'tactic_hit', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.u64().index('btree'),
    // Unique per call; enforced in analyze_call.
    tactic: t.string(),
  }
);

const verdict = table(
  { name: 'verdict', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.u64().index('btree'),
    claimJson: t.string(),
    claimTrue: t.bool(),
    evidence: t.string(),
  }
);

const alert = table(
  { name: 'alert', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.u64().index('btree'),
    kind: t.string(),
    message: t.string(),
    createdAt: t.timestamp(),
  }
);

// Singleton (id 0). Armed while armedUntil is in the future.
const guard = table(
  { name: 'guard', public: true },
  {
    id: t.u8().primaryKey(),
    armedUntil: t.timestamp(),
  }
);

// Singleton (id 0).
const accountSnapshot = table(
  { name: 'account_snapshot', public: true },
  {
    id: t.u8().primaryKey(),
    name: t.string(),
    nickname: t.string(),
    last4: t.string(),
    balance: t.f64(),
  }
);

const activity = table(
  { name: 'activity', public: true },
  {
    id: t.string().primaryKey(),
    kind: t.string(),
    date: t.string(),
    description: t.string(),
    amount: t.f64(),
    // 0 is the newest. Nessie dates only have day precision, so the order is stored.
    sortIndex: t.u32(),
  }
);

const bill = table(
  { name: 'bill', public: true },
  {
    id: t.string().primaryKey(),
    payee: t.string(),
    amount: t.f64(),
    paymentDate: t.string(),
    status: t.string(),
  }
);

const payee = table(
  { name: 'payee', public: true },
  {
    name: t.string().primaryKey(),
    // Empty when the payee has no Nessie account.
    nessieAccountId: t.string(),
    trusted: t.bool(),
    timesPaid: t.u32(),
  }
);

const hold = table(
  { name: 'hold', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    payee: t.string(),
    amount: t.f64(),
    memo: t.string(),
    reason: t.string(),
    // held | approved | rejected | expired
    status: t.string(),
    createdAt: t.timestamp(),
    expiresAt: t.timestamp(),
  }
);

const reportedNumber = table(
  { name: 'reported_number', public: true },
  {
    number: t.string().primaryKey(),
    reports: t.u32(),
  }
);

// Singleton (id 0).
const config = table(
  { name: 'config', public: true },
  {
    id: t.u8().primaryKey(),
    mock: t.bool(),
    accountId: t.string(),
    supportsPurchases: t.bool(),
    supportsTransfers: t.bool(),
  }
);

// PRIVATE. API keys, written by the owner-only set_secret reducer. Never make this public.
// The OWNER row holds the publisher's identity, which is how "owner only" is checked.
const secret = table(
  { name: 'secret' },
  {
    name: t.string().primaryKey(),
    value: t.string(),
  }
);

// PRIVATE. Mock mode only: money sent from the dashboard, so the mock balance
// and activity change the way the real account would.
// SPEC-QUESTION: not in the spec's table list. Mock transfers need to live
// somewhere, and module memory does not survive a restart.
const mockTxn = table(
  { name: 'mock_txn' },
  {
    id: t.u64().primaryKey().autoInc(),
    // transfer | withdrawal
    kind: t.string(),
    date: t.string(),
    description: t.string(),
    amount: t.f64(),
  }
);

const spacetimedb = schema({
  call,
  transcript,
  tacticHit,
  verdict,
  alert,
  guard,
  accountSnapshot,
  activity,
  bill,
  payee,
  hold,
  reportedNumber,
  config,
  secret,
  mockTxn,
});

export default spacetimedb;
