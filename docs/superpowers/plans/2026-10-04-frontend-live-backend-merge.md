# Frontend + Live Backend Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point the dashboard and phone app at the live `spacetimedb/` module so a real incoming call drives transcript/risk, and Send Money is held for 4 hours with a come-to-the-bank message (then Expired, never sent).

**Architecture:** `spacetimedb/` is the only database. The bridge is unchanged. The worker is the only Nessie client: it refreshes the account shell, executes Approved intents, and expires Held intents after 4 hours. Web and mobile subscribe to the live tables. No relay, no simulate, no mock ledger.

**Tech Stack:** SpacetimeDB TypeScript module, Node 20+ worker (`tsx`, `fetch`), Vite React dashboard, Expo phone app, generated `@watchdog/bindings`, Nessie HTTP, existing Grok/Gemini/ElevenLabs bridge.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-04-frontend-live-backend-merge-design.md`
- Canonical `userId` is `demo-user` (`DEFAULT_USER_ID`). Margaret login is a demo door only.
- Local database name is `watchdog-dev`. Maincloud remains `watchdog`.
- Fail-stop: no mock Margaret ledger, no `mock-` Nessie transfer ids, no scripted call, no “Sent” unless Nessie completed.
- Held copy (exact): `Come to the bank to complete this transfer. Watchdog is holding it for 4 hours because this call looks like a scam.`
- `HOLD_TTL_MS = 4 * 60 * 60 * 1000`. After expiry the intent is `Expired` and still not sent. No Release / Approve / force on the demo UI.
- Do not change Grok / Gemini / ElevenLabs behavior on `watchdog-bridge/`. `npm run bridge:test` must still pass.
- Do not delete the `spacetime/` or `apps/relay` trees. `pnpm dev` must not publish or start them.
- Do not put `NESSIE_API_KEY` in the browser or a public Spacetime table.
- Nessie is required for the bank shell. Worker stays up on Nessie errors and writes no snapshot.

## File structure

| File | Responsibility |
|---|---|
| Create: `spacetimedb/src/policy.ts` | Pure hold/expire policy (no Spacetime imports) |
| Create: `spacetimedb/test/policy.test.ts` | Node tests for hold + 4-hour expire |
| Create: `packages/core/src/live.ts` | `DEMO_USER_ID`, `dollarsToCents`, `shieldState` |
| Create: `packages/core/test/live.test.ts` | Vitest for those helpers |
| Create: `worker/src/account.ts` | Nessie GET → snapshot / activity / payee rows |
| Create: `worker/src/expire.ts` | Pick Held rows whose `expiresAt` is past |
| Create: `worker/test/nessie-client.test.ts` | No mock transfer ids |
| Create: `worker/test/expire.test.ts` | Due-hold selection |
| Create: `scripts/check-ui-wiring.mjs` | Grep: no Protect / Simulate / postRelay / `/try` / AnalysisPanel |
| Modify: `spacetimedb/src/schema.ts` | `Expired`, `expiresAt`, `account_snapshot`, `activity`, `payees` |
| Modify: `spacetimedb/src/constants.ts` | Re-export `HOLD_TTL_MS` |
| Modify: `spacetimedb/src/helpers.ts` | `buildHoldReason` → bank copy |
| Modify: `spacetimedb/src/index.ts` | Hold expiry fields; `expire_held_transfer`; bank upsert reducers |
| Modify: `worker/src/nessie-client.ts` | Real Nessie send; fail if key/account missing |
| Modify: `worker/src/transfer-worker.ts` | Refresh, execute, 60s expire |
| Modify: `scripts/dev.mjs` | Publish `spacetimedb/`, generate both binding dirs, start worker + web |
| Modify: `scripts/seed.ts` | `NESSIE_API_KEY` / `NESSIE_BASE_URL` |
| Modify: `scripts/acceptance.ts` | Live-module hold check |
| Modify: `.env.example`, `README.MD` | One stack, no MOCK |
| Modify: `package.json` | `test` includes policy + worker + UI wiring |
| Modify: `spacetime.json` | Generate bindings to `packages/bindings/src` as well |
| Modify: `apps/web/src/**` | Live tables; drop relay / analysis / try |
| Modify: `apps/mobile/src/**` | Same tables; drop relay |
| Delete: `apps/web/src/lib/relay.ts`, `apps/web/src/components/TryPage.tsx`, `apps/web/src/components/AnalysisPanel.tsx` | Dead dashboard path |
| Delete: `apps/mobile/src/lib/relay.ts` | Dead phone path |
| Keep: `watchdog-bridge/**`, `spacetime/**`, `apps/relay/**` | Bridge unchanged; old module/relay unpublished |

---

### Task 1: Hold policy (pure functions)

**Files:**
- Create: `spacetimedb/src/policy.ts`
- Create: `spacetimedb/test/policy.test.ts`
- Modify: `spacetimedb/src/constants.ts`
- Modify: `package.json` (add `test:policy`)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:

```ts
export const HOLD_TTL_MS = 4 * 60 * 60 * 1000;
export const BANK_HOLD_REASON =
  'Come to the bank to complete this transfer. Watchdog is holding it for 4 hours because this call looks like a scam.';

export function shouldHold(
  hasActiveSession: boolean,
  riskScore: number,
  threshold: number
): boolean;

export function holdExpiresAtMs(requestedAtMs: number): number; // requestedAtMs + HOLD_TTL_MS

export function canExpireHeld(
  status: 'Held' | 'Approved' | 'Expired' | 'Completed' | 'Failed' | 'Released' | 'Pending',
  expiresAtMs: number | null,
  nowMs: number
): boolean; // true only when status === 'Held' && expiresAtMs !== null && nowMs >= expiresAtMs
```

- [ ] **Step 1: Write the failing test**

```ts
// spacetimedb/test/policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANK_HOLD_REASON,
  HOLD_TTL_MS,
  canExpireHeld,
  holdExpiresAtMs,
  shouldHold,
} from '../src/policy.ts';

test('holds only an active session at or above threshold', () => {
  assert.equal(shouldHold(true, 70, 70), true);
  assert.equal(shouldHold(true, 69, 70), false);
  assert.equal(shouldHold(false, 94, 70), false);
});

test('expiry is 4 hours after request', () => {
  assert.equal(HOLD_TTL_MS, 4 * 60 * 60 * 1000);
  assert.equal(holdExpiresAtMs(1_000), 1_000 + HOLD_TTL_MS);
});

test('can expire only a Held row whose time is up', () => {
  assert.equal(canExpireHeld('Held', 50, 50), true);
  assert.equal(canExpireHeld('Held', 51, 50), false);
  assert.equal(canExpireHeld('Approved', 0, 99), false);
  assert.equal(canExpireHeld('Held', null, 99), false);
});

test('bank hold copy is exact', () => {
  assert.equal(
    BANK_HOLD_REASON,
    'Come to the bank to complete this transfer. Watchdog is holding it for 4 hours because this call looks like a scam.'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test spacetimedb/test/policy.test.ts`

Expected: FAIL (cannot find `../src/policy.ts`)

- [ ] **Step 3: Write minimal implementation**

```ts
// spacetimedb/src/policy.ts
export const HOLD_TTL_MS = 4 * 60 * 60 * 1000;
export const BANK_HOLD_REASON =
  'Come to the bank to complete this transfer. Watchdog is holding it for 4 hours because this call looks like a scam.';

export function shouldHold(hasActiveSession: boolean, riskScore: number, threshold: number): boolean {
  return hasActiveSession && riskScore >= threshold;
}

export function holdExpiresAtMs(requestedAtMs: number): number {
  return requestedAtMs + HOLD_TTL_MS;
}

export function canExpireHeld(
  status: string,
  expiresAtMs: number | null,
  nowMs: number
): boolean {
  return status === 'Held' && expiresAtMs !== null && nowMs >= expiresAtMs;
}
```

In `spacetimedb/src/constants.ts` add:

```ts
export { HOLD_TTL_MS, BANK_HOLD_REASON } from './policy';
```

In root `package.json` scripts add: `"test:policy": "tsx --test spacetimedb/test/policy.test.ts"`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:policy`

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add spacetimedb/src/policy.ts spacetimedb/src/constants.ts spacetimedb/test/policy.test.ts package.json
git commit -m "Add pure hold-and-expire policy for the live money gate."
```

---

### Task 2: Schema and reducers

**Files:**
- Modify: `spacetimedb/src/schema.ts`
- Modify: `spacetimedb/src/helpers.ts`
- Modify: `spacetimedb/src/index.ts`

**Interfaces:**
- Consumes: `shouldHold`, `BANK_HOLD_REASON`, `HOLD_TTL_MS`, `canExpireHeld` from `./policy`
- Produces: tables `account_snapshot`, `activity`, `payees`; enum tag `Expired`; field `transfer_intents.expiresAt`; reducers `expire_held_transfer`, `upsert_account_snapshot`, `replace_activity`, `upsert_payee`
- `request_transfer` still `(userId, amountCents, destinationAccount, memo)`. When holding: `status.Held`, `holdReason = BANK_HOLD_REASON`, `expiresAt` set. When approving: `expiresAt` unset.
- `expire_held_transfer({ intentId: u64 })` — `SenderError` unless `canExpireHeld` is true using `ctx.timestamp`. Then `status = { tag: 'Expired' }`.
- Do not call `release_held_transfer` from new code. Leave the reducer in the module.

- [ ] **Step 1: Extend the schema**

In `TransferIntentStatus` **append** `Expired: t.unit()` after `Released` so existing SATS indexes stay: Pending=0, Approved=1, Held=2.

On `transferIntent` add `expiresAt: t.option(t.timestamp())`.

After `config`, add:

```ts
export const accountSnapshot = table(
  { name: 'account_snapshot', public: true },
  {
    id: t.u8().primaryKey(),
    name: t.string(),
    nickname: t.string(),
    last4: t.string(),
    balance: t.f64(),
    updatedAt: t.timestamp(),
  }
);

export const activity = table(
  { name: 'activity', public: true },
  {
    id: t.string().primaryKey(),
    kind: t.string(),
    date: t.string(),
    description: t.string(),
    amount: t.f64(),
    sortIndex: t.u32(),
  }
);

export const payee = table(
  { name: 'payees', public: true },
  {
    name: t.string().primaryKey(),
    nessieAccountId: t.string(),
    trusted: t.bool(),
  }
);
```

Pass `accountSnapshot`, `activity`, `payee` into `schema(...)`.

- [ ] **Step 2: Point `buildHoldReason` at the bank copy**

In `spacetimedb/src/helpers.ts`:

```ts
import { BANK_HOLD_REASON } from './policy';

export function buildHoldReason(_riskScore: number, _threshold: number): string {
  return BANK_HOLD_REASON;
}
```

- [ ] **Step 3: Update `request_transfer` and add new reducers**

In `spacetimedb/src/index.ts`, import `shouldHold`, `HOLD_TTL_MS`, `canExpireHeld` from `./policy`.

Replace the hold decision:

```ts
const shouldHoldNow = shouldHold(activeSession !== null, riskScore, threshold);
```

When inserting, set:

```ts
expiresAt: shouldHoldNow
  ? Timestamp.fromDate(new Date(ctx.timestamp.toDate().getTime() + HOLD_TTL_MS))
  : undefined,
```

If `Timestamp.fromDate` / `toDate` is not on this SDK version, use `TimeDuration` / micros the same way `spacetime/src` converts timestamps (`toMs` / `fromMs`). Do not invent a different TTL.

Add:

```ts
spacetimedb.reducer('expire_held_transfer', { intentId: t.u64() }, (ctx, { intentId }) => {
  const intent = requireTransferIntent(ctx, intentId);
  const expiresAtMs = intent.expiresAt ? intent.expiresAt.toDate().getTime() : null;
  if (!canExpireHeld(intent.status.tag, expiresAtMs, ctx.timestamp.toDate().getTime())) {
    throw new SenderError('Transfer is not a due hold');
  }
  intent.status = { tag: 'Expired' };
  ctx.db.transferIntents.id.update(intent);
});

spacetimedb.reducer(
  'upsert_account_snapshot',
  { name: t.string(), nickname: t.string(), last4: t.string(), balance: t.f64() },
  (ctx, args) => {
    const row = ctx.db.accountSnapshot.id.find(0);
    const next = { id: 0, ...args, updatedAt: ctx.timestamp };
    if (row) ctx.db.accountSnapshot.id.update({ ...row, ...next });
    else ctx.db.accountSnapshot.insert(next);
  }
);

const ActivityRow = t.object('ActivityRow', {
  id: t.string(),
  kind: t.string(),
  date: t.string(),
  description: t.string(),
  amount: t.f64(),
  sortIndex: t.u32(),
});

spacetimedb.reducer('replace_activity', { rows: t.array(ActivityRow) }, (ctx, { rows }) => {
  for (const old of [...ctx.db.activity.iter()]) ctx.db.activity.id.delete(old.id);
  for (const row of rows) ctx.db.activity.insert(row);
});

spacetimedb.reducer(
  'upsert_payee',
  { name: t.string(), nessieAccountId: t.string(), trusted: t.bool() },
  (ctx, { name, nessieAccountId, trusted }) => {
    const row = ctx.db.payee.name.find(name);
    if (row) ctx.db.payee.name.update({ ...row, nessieAccountId, trusted });
    else ctx.db.payee.insert({ name, nessieAccountId, trusted });
  }
);
```

Use the generated table accessor names (`accountSnapshot` / `payee`) that match the schema exports.

- [ ] **Step 4: Typecheck the module**

Run: `npx tsc -p spacetimedb --noEmit` (add a `tsconfig.json` only if the package already has one; otherwise `npx tsc --noEmit --esModuleInterop --module nodenext --moduleResolution nodenext spacetimedb/src/index.ts` is enough to catch signature errors)

Expected: no errors related to the new fields. If `Timestamp.fromDate` is missing, switch to the repo’s existing timestamp helpers before continuing.

- [ ] **Step 5: Commit**

```bash
git add spacetimedb/src/schema.ts spacetimedb/src/helpers.ts spacetimedb/src/index.ts
git commit -m "Hold transfers for 4 hours and expire them unsent."
```

---

### Task 3: Worker Nessie fail-stop (no mock ids)

**Files:**
- Modify: `worker/src/nessie-client.ts`
- Create: `worker/test/nessie-client.test.ts`
- Modify: `worker/package.json` (add `"test": "tsx --test test/*.test.ts"`)

**Interfaces:**
- Consumes: env `NESSIE_API_KEY`, `NESSIE_BASE_URL` (default `http://api.nessieisreal.com`), `NESSIE_ACCOUNT_ID`
- Produces: `executeNessieTransfer` returns `{ ok: false, error }` when key or account id is missing — never `{ ok: true, transferId: 'mock-…' }`
- Send: `POST {base}/accounts/{NESSIE_ACCOUNT_ID}/transfers?key=` with `{ transaction_date, status: 'completed', amount: Number(amountCents)/100, description: memo || 'Transfer to ' + destinationAccount }`
- If transfers 403/404, retry as withdrawal on the same source account with `medium: 'balance'` and `status: 'completed'` (same pattern as `spacetime/src/nessie.ts` `sendMoney`). Non-2xx → `{ ok: false, error: 'Nessie ${status}: ${text}' }`
- Response must include `_id` or `id`, else `{ ok: false, error: 'Nessie response missing transfer id' }`

- [ ] **Step 1: Write the failing test**

```ts
// worker/test/nessie-client.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeNessieTransfer } from '../src/nessie-client.ts';

test('missing NESSIE_API_KEY does not invent a mock transfer', async () => {
  const prevKey = process.env.NESSIE_API_KEY;
  const prevAcct = process.env.NESSIE_ACCOUNT_ID;
  delete process.env.NESSIE_API_KEY;
  process.env.NESSIE_ACCOUNT_ID = 'acc-1';
  const result = await executeNessieTransfer({
    intentId: 1n,
    userId: 'demo-user',
    amountCents: 200000n,
    destinationAccount: 'payee-1',
    memo: 'refund',
  });
  process.env.NESSIE_API_KEY = prevKey;
  process.env.NESSIE_ACCOUNT_ID = prevAcct;
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /NESSIE_API_KEY/);
  if (result.ok) assert.doesNotMatch(result.transferId, /^mock-/);
});

test('missing NESSIE_ACCOUNT_ID fails', async () => {
  process.env.NESSIE_API_KEY = 'k';
  delete process.env.NESSIE_ACCOUNT_ID;
  const result = await executeNessieTransfer({
    intentId: 2n,
    userId: 'demo-user',
    amountCents: 100n,
    destinationAccount: 'payee-1',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /NESSIE_ACCOUNT_ID/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test worker/test/nessie-client.test.ts`

Expected: FAIL — current client returns `{ ok: true, transferId: 'mock-…' }` when the key is missing.

- [ ] **Step 3: Write minimal implementation**

Delete the `if (!apiKey) { return { ok: true, transferId: \`mock-...\` } }` branch.

At the top of `executeNessieTransfer`:

```ts
const apiKey = process.env.NESSIE_API_KEY;
const accountId = process.env.NESSIE_ACCOUNT_ID;
if (!apiKey) return { ok: false, error: 'NESSIE_API_KEY is not set' };
if (!accountId) return { ok: false, error: 'NESSIE_ACCOUNT_ID is not set' };
```

POST to `/accounts/${accountId}/transfers` (source account), not `/accounts/${destinationAccount}/transfers`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test worker/test/nessie-client.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/nessie-client.ts worker/test/nessie-client.test.ts worker/package.json
git commit -m "Fail Nessie transfers when the key or account id is missing."
```

---

### Task 4: Worker account refresh

**Files:**
- Create: `worker/src/account.ts`
- Create: `worker/test/account.test.ts`
- Modify: `worker/src/transfer-worker.ts`

**Interfaces:**
- Consumes: `upsert_account_snapshot`, `replace_activity`, `upsert_payee` from Task 2; Nessie GET `/accounts/{id}` and `/customers/{customer_id}`; lists `/deposits`, `/withdrawals`, `/transfers`
- Produces:

```ts
export type SnapshotRow = { name: string; nickname: string; last4: string; balance: number };
export type ActivityRow = { id: string; kind: string; date: string; description: string; amount: number; sortIndex: number };
export type PayeeRow = { name: string; nessieAccountId: string; trusted: boolean };

export async function fetchNessieAccount(env: {
  apiKey: string;
  baseUrl: string;
  accountId: string;
}): Promise<{ snapshot: SnapshotRow; activity: ActivityRow[]; payees: PayeeRow[] }>;
```

- `fetchNessieAccount` throws if the account GET is not ok. It does not write Spacetime rows (the worker calls reducers after).
- Name: `first_name + ' ' + last_name` from the customer, or `"Account"` if customer GET fails (account GET must still succeed).
- `last4`: last 4 of `account_number` if present, else last 4 of `_id`.
- Activity: map deposits (positive), withdrawals and transfers (negative). `id` is Nessie `_id`. Sort newest first (`sortIndex` 0 = newest). Cap at 20 rows.
- Payees: read `.seed.json` at repo root if present (`payees: [{ name, nessieAccountId, trusted }]`) and return those rows. Do not invent Margaret mock payees when the file is missing (return `[]`).
- Worker `refreshAccount(conn)`: if key or account id missing, `console.error` and return without calling reducers. On fetch throw, log and return. On success call the three reducers.

- [ ] **Step 1: Write the failing test**

```ts
// worker/test/account.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchNessieAccount } from '../src/account.ts';

test('account GET failure throws and does not invent a snapshot', async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = (async () => new Response('nope', { status: 404 })) as typeof fetch;
  await assert.rejects(
    () => fetchNessieAccount({ apiKey: 'k', baseUrl: 'http://nessie.test', accountId: 'acc' }),
    /Nessie/
  );
  globalThis.fetch = prev;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test worker/test/account.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Write `fetchNessieAccount` and wire refresh into the worker**

Implement GET helpers with `fetch(`${baseUrl}${path}?key=${apiKey}`)`.

In `transfer-worker.ts`, after `onConnect`, call `void refreshAccount(conn)` once. After `completeTransfer` / `failTransfer`, call it again.

Default `DATABASE_NAME` to `process.env.SPACETIME_DATABASE ?? 'watchdog-dev'`.

- [ ] **Step 4: Run tests**

Run: `npx tsx --test worker/test/account.test.ts worker/test/nessie-client.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/account.ts worker/src/transfer-worker.ts worker/test/account.test.ts
git commit -m "Refresh the Nessie account snapshot from the worker only."
```

---

### Task 5: Worker 60-second hold expiry

**Files:**
- Create: `worker/src/expire.ts`
- Create: `worker/test/expire.test.ts`
- Modify: `worker/src/transfer-worker.ts`

**Interfaces:**
- Consumes: `canExpireHeld` from `../../spacetimedb/src/policy.ts` (import that file; do not copy the function).
- Produces:

```ts
export function dueHoldIds(
  rows: { id: bigint; status: { tag: string }; expiresAtMs: number | null }[],
  nowMs: number
): bigint[];
```

- Worker: subscribe to `transfer_intents` (Approved **and** Held). Keep the Approved execute handlers. `setInterval(..., 60_000)` walks cached Held rows and calls `expireHeldTransfer({ intentId })` for each `dueHoldIds` id. Never call Nessie for those ids.

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { dueHoldIds } from '../src/expire.ts';

test('only due Held rows expire', () => {
  const ids = dueHoldIds(
    [
      { id: 1n, status: { tag: 'Held' }, expiresAtMs: 10 },
      { id: 2n, status: { tag: 'Held' }, expiresAtMs: 30 },
      { id: 3n, status: { tag: 'Approved' }, expiresAtMs: 10 },
    ],
    20
  );
  assert.deepEqual(ids, [1n]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test worker/test/expire.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement `dueHoldIds` and the interval**

```ts
import { canExpireHeld } from '../../spacetimedb/src/policy.ts';

export function dueHoldIds(
  rows: { id: bigint; status: { tag: string }; expiresAtMs: number | null }[],
  nowMs: number
): bigint[] {
  return rows.filter((r) => canExpireHeld(r.status.tag, r.expiresAtMs, nowMs)).map((r) => r.id);
}
```

In the worker, keep an in-memory `Map` of Held rows from `onInsert` / `onUpdate`. Every 60s, expire due ids.

- [ ] **Step 4: Run tests**

Run: `npx tsx --test worker/test/*.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/expire.ts worker/src/transfer-worker.ts worker/test/expire.test.ts
git commit -m "Expire held transfers after 4 hours without sending them."
```

---

### Task 6: Dev path, env, bindings

**Files:**
- Modify: `scripts/dev.mjs`
- Modify: `spacetime.json`
- Modify: `.env.example`
- Modify: `scripts/seed.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: live module path `spacetimedb`, database `watchdog-dev`
- Produces: `pnpm dev` publishes live module, generates `packages/bindings/src` and `worker/src/module_bindings`, starts worker + web. No relay. No `MOCK`.

- [ ] **Step 1: Point publish/generate at the live module**

In `scripts/dev.mjs`:

- Change `--module-path spacetime` to `--module-path spacetimedb` (both publish and generate).
- Default `database` to `env.SPACETIME_DATABASE || env.SPACETIME_DB || "watchdog-dev"`.
- After generating `packages/bindings/src`, also generate `worker/src/module_bindings` (second `spacetime generate` call).
- Replace `start("relay", ...)` with `start("worker", "npm", ["run", "worker:dev"])`.
- Delete the `mock` / `Mode: MOCK` log.
- Pass `VITE_SPACETIME_URI` and `VITE_SPACETIME_DB` (the same `database` string) into the web process.

If `spacetime.json` `generate` accepts a second `out-dir`, add `packages/bindings/src` there too so `npm run spacetime:generate` stays consistent.

- [ ] **Step 2: Unify env and seed**

`.env.example`:

- Remove `MOCK=1`, `RELAY_PORT`, `NESSIE_KEY`, `NESSIE_BASE`.
- Set `SPACETIME_DATABASE=watchdog-dev`. Remove the `SPACETIME_DB=watchdog` default (optional comment: web now uses `SPACETIME_DATABASE` via `VITE_SPACETIME_DB`).
- Add `NESSIE_ACCOUNT_ID=`.
- Keep `DEFAULT_USER_ID=demo-user`, `NESSIE_API_KEY`, `NESSIE_BASE_URL`.

`scripts/seed.ts`: `const KEY = (env.NESSIE_API_KEY ?? "").trim();` — no `NESSIE_KEY` fallback. If empty, exit with `NESSIE_API_KEY is not set`. `const BASE = (env.NESSIE_BASE_URL || "https://prod-api.nessieisreal.com").replace(/\/+$/, "")` (create needs the prod host the seed already uses). Write `accountId` into `.seed.json` as today, and print `Put NESSIE_ACCOUNT_ID=<accountId> in .env`.

- [ ] **Step 3: Smoke the script without starting forever**

Run: `node --check scripts/dev.mjs && node --check scripts/seed.ts`

Expected: no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/dev.mjs scripts/seed.ts spacetime.json .env.example package.json
git commit -m "Publish the live module from pnpm dev and drop the relay."
```

---

### Task 7: Shared live UI helpers

**Files:**
- Create: `packages/core/src/live.ts`
- Create: `packages/core/test/live.test.ts`
- Modify: `packages/core/src/index.ts` (export `./live`)

**Interfaces:**
- Consumes: `stateForScore` from `./score`
- Produces:

```ts
export const DEMO_USER_ID = 'demo-user';
export function dollarsToCents(dollars: number): bigint;
export function shieldState(active: boolean, score: number): 'idle' | 'listening' | 'caution' | 'scam_likely';
```

- `dollarsToCents` throws `Error('Amount must be a positive number.')` if not a finite number `> 0`. Returns `BigInt(Math.round(dollars * 100))`.
- `shieldState`: `active ? stateForScore(score) : 'idle'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { DEMO_USER_ID, dollarsToCents, shieldState } from '../src/live';

describe('live helpers', () => {
  it('uses demo-user', () => expect(DEMO_USER_ID).toBe('demo-user'));
  it('turns dollars into integer cents', () => expect(dollarsToCents(2000)).toBe(200000n));
  it('rejects bad amounts', () => expect(() => dollarsToCents(0)).toThrow(/positive/));
  it('is idle when there is no active call', () => expect(shieldState(false, 94)).toBe('idle'));
  it('maps 70 to scam_likely', () => expect(shieldState(true, 70)).toBe('scam_likely'));
  it('maps 40 to caution', () => expect(shieldState(true, 40)).toBe('caution'));
  it('maps 10 to listening', () => expect(shieldState(true, 10)).toBe('listening'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @watchdog/core exec vitest run test/live.test.ts`

Expected: FAIL (cannot find `./live`)

- [ ] **Step 3: Implement and export**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @watchdog/core exec vitest run test/live.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/live.ts packages/core/src/index.ts packages/core/test/live.test.ts
git commit -m "Add shared live-call helpers for the bank UI."
```

---

### Task 8: Web dashboard — live tables

**Files:**
- Modify: `apps/web/src/main.tsx` — default database `watchdog-dev`
- Modify: `apps/web/src/App.tsx` — drop `/try` and `AnalysisPanel`; Offline banner stays
- Modify: `apps/web/src/components/ShieldPanel.tsx`
- Modify: `apps/web/src/components/AccountPanel.tsx`
- Modify: `apps/web/src/components/SendMoney.tsx`
- Modify: `apps/web/src/components/HeldPanel.tsx`
- Delete: `apps/web/src/lib/relay.ts`, `apps/web/src/components/TryPage.tsx`, `apps/web/src/components/AnalysisPanel.tsx`
- Create: `scripts/check-ui-wiring.mjs`

**Interfaces:**
- Consumes: generated `tables` / `reducers` from `@watchdog/bindings` after Task 6 generate; `DEMO_USER_ID`, `dollarsToCents`, `shieldState` from `@watchdog/core`
- Produces: dashboard that compiles against live tables. No `procedures`, no `tables.call`, no `postRelay`.

**ShieldPanel**
- `useTable(tables.callSession)`, `transcriptSegment`, `riskEvent`
- Active session: `status.tag === 'Active'`
- Score: `session.riskScore`. State: `shieldState(live, score)`
- Transcript: filter `sessionId === session.id`, sort by `occurredAt` / `id`. Single-column stream (no speaker)
- Warnings: `riskEvent` rows for that session with `warningMessage` set, newest first
- Signals: unique `signalType` chips
- Empty copy: `No call yet. Add Watchdog to a live call (Add Call, then Merge) using the Twilio number.`
- Help `<details>`:

```
How to add Watchdog
Place or receive the call on your phone. Add a call to the Watchdog Twilio number, then Merge. This screen only watches that call — it does not start one.
```

- Remove Protect, Simulate, scenario dropdown, End call, I'm on a suspicious call, tactics, claim checks, guard banner

**AccountPanel**
- `account_snapshot` + `activity` only. No bills.
- No snapshot after ready: `Nessie account not loaded.` (error tone). Do not render `SendMoney` in that state.
- Drop “Is the relay running?”

**SendMoney**
- `useReducer(reducers.requestTransfer)` (not a procedure)
- Submit: `requestTransfer({ userId: DEMO_USER_ID, amountCents: dollarsToCents(Number(amount)), destinationAccount: payee.trim(), memo: memo.trim() || undefined })`. If generated types require `Option<string>` as `{ tag: 'some', value: string } | undefined`, use that. Do not guess a `{ some: string }` shape unless that is what generate emitted.
- Catch reducer errors and show `role="alert"` with the message. Do not invent Held/Sent locally.
- After submit, show the newest `transfer_intents` row for `demo-user` (subscription). Map tags: Held / Approved / Completed / Failed / Expired.

**HeldPanel**
- `useTable(tables.transferIntent)`
- Waiting: `status.tag === 'Held'`
- Decided: Completed / Failed / Expired / Released
- Money protected: sum of Held + Expired `amountCents / 100`
- Show `holdReason` and time left until `expiresAt`
- No Approve / Reject / Release buttons

**App**
- Remove `onTry` / `TryPage` / `AnalysisPanel`
- Connection error copy: `Cannot reach the database. Start everything with pnpm dev.`
- Drop the Mock mode pill

**main.tsx**
- `import.meta.env.VITE_SPACETIME_DB ?? "watchdog-dev"`

**Wiring check** — `scripts/check-ui-wiring.mjs` in full:

```js
import { execFileSync } from 'node:child_process';

const needles = ['Protect this call', 'Simulate call', 'postRelay', 'AnalysisPanel', 'TryPage'];
let failed = false;
for (const n of needles) {
  let out = '';
  try {
    out = execFileSync('rg', ['-n', '--glob', '!**/node_modules/**', n, 'apps/web', 'apps/mobile'], {
      encoding: 'utf8',
    });
  } catch (e) {
    if (e.status === 1) continue;
    throw e;
  }
  if (out.trim()) {
    failed = true;
    console.error(`forbidden "${n}":\n${out}`);
  }
}
process.exit(failed ? 1 : 0);
```

Add root script `"test:ui-wiring": "node scripts/check-ui-wiring.mjs"`.

- [ ] **Step 1: Write `scripts/check-ui-wiring.mjs` and run it (expect FAIL while old UI exists)**

Run: `node scripts/check-ui-wiring.mjs`

Expected: FAIL listing Protect / Simulate / postRelay / AnalysisPanel / TryPage

- [ ] **Step 2: Generate live bindings, then rewrite the web files and delete the three dead files**

```bash
spacetime generate --lang typescript --out-dir packages/bindings/src --module-path spacetimedb --yes
```

This requires the live module published (Task 6 / `pnpm dev` or `npm run spacetime:publish:local`). Bindings names: `tables.callSession`, `tables.transcriptSegment`, `tables.riskEvent`, `tables.transferIntent`, `tables.accountSnapshot`, `tables.payee`, `reducers.requestTransfer`. The UI does not call `expireHeldTransfer`.

- [ ] **Step 3: Run wiring check and web typecheck**

Run: `node scripts/check-ui-wiring.mjs && pnpm --filter @watchdog/web typecheck`

Expected: wiring PASS. Typecheck PASS once bindings exist. If typecheck fails only because bindings are stale, publish + generate, then re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/web scripts/check-ui-wiring.mjs package.json
git commit -m "Point the web dashboard at the live call and money-gate tables."
```

---

### Task 9: Phone app

**Files:**
- Modify: `apps/mobile/src/lib/config.ts` — `SPACETIME_DB` default `watchdog-dev`; drop `relayUrl` from required endpoints
- Modify: `apps/mobile/src/lib/useShield.ts` — `callSession` instead of `call` / `guard`
- Modify: `apps/mobile/src/app/(tabs)/shield.tsx` — same Shield behavior as web (help, no Protect/Simulate)
- Modify: `apps/mobile/src/app/(tabs)/index.tsx` — snapshot + activity; Nessie error copy; no bills
- Modify: `apps/mobile/src/app/(tabs)/held.tsx` and `apps/mobile/src/components/SendMoney.tsx` — `transferIntent` / `requestTransfer` / `DEMO_USER_ID`
- Delete: `apps/mobile/src/lib/relay.ts`

**Interfaces:**
- Consumes: same bindings and `@watchdog/core` live helpers as Task 8
- Produces: three tabs still work; no relay

- [ ] **Step 1: Run wiring check (mobile still has postRelay — FAIL until this task)**

If Task 8 already deleted web matches, this step fails on mobile paths only.

- [ ] **Step 2: Port the same table/reducer wiring as web. Remove scenario / protect / simulate / claims / tactics / armGuard.**

Empty account copy: `Nessie account not loaded.` not `Is the relay running?`

- [ ] **Step 3: Run wiring check**

Run: `node scripts/check-ui-wiring.mjs`

Expected: PASS (no matches in `apps/web` or `apps/mobile`)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile
git commit -m "Point the phone app at the live module and drop the relay."
```

---

### Task 10: Acceptance, tests, docs

**Files:**
- Modify: `scripts/acceptance.ts`
- Modify: `package.json` (`test`, `acceptance`)
- Modify: `README.MD`
- Delete or stop running: `packages/core/test/rules.test.ts` (4-hour guard / trusted-payee policy the UI no longer uses). Keep `packages/core/test/score.test.ts` and `packages/core/test/live.test.ts`. Delete `packages/core/test/verify.test.ts` and `packages/core/test/analyzer.test.ts` only if they exist solely for claim/simulate playback (they do — delete both). Keep `insights.test.ts` only if nothing in the merged UI imports insights; if Account analysis is gone, delete `insights.test.ts` too so `pnpm test:dashboard` cannot pass on leftover analysis.

**Interfaces:**
- Consumes: published live module `watchdog-dev` on local Spacetime
- Produces: acceptance that asserts Held + bank reason, not fixture scenarios

- [ ] **Step 1: Replace `scripts/acceptance.ts`**

```ts
import { execFileSync } from 'node:child_process';

const DB = process.env.SPACETIME_DATABASE ?? 'watchdog-dev';
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
const other = (await sql("SELECT user_id, status FROM transfer_intents WHERE user_id = 'someone-else'")).at(-1);
if (!other || isHeld(other[1])) throw new Error(`someone-else should not be Held, got ${JSON.stringify(other)}`);

let expireFailed = false;
try {
  call('expire_held_transfer', JSON.stringify({ intentId: Number(demo[0]) }));
} catch {
  expireFailed = true;
}
if (!expireFailed) throw new Error('expire_held_transfer must reject a hold that is still inside 4 hours');

console.log('acceptance ok', { sessionId, tag: tag(demo[2]) });
```

Do not call the relay.

- [ ] **Step 2: Point root `test` at the automated suite that does not need Twilio**

```json
"test": "npm run bridge:test && npm run test:policy && npm run test:worker && npm run test:ui-wiring && pnpm --filter @watchdog/core test"
```

Add `"test:worker": "tsx --test worker/test/*.test.ts"`.

- [ ] **Step 3: Rewrite the README “two stacks” section**

One running path:

```
spacetime start
# .env has Nessie + live call keys
pnpm seed   # once; copy NESSIE_ACCOUNT_ID into .env
pnpm dev    # live module + worker + dashboard
npm run bridge:dev
npm run tunnel
```

Twilio webhook still `https://HOST/twilio/voice?userId=demo-user`.

Delete the “60-second demo, mock mode” / Simulate call instructions. Add: merge Watchdog on the phone; dashboard watches; Send $2000 during a high-risk call → Held, come to the bank, 4 hours.

- [ ] **Step 4: Run automated tests**

Run: `npm test`

Expected: PASS (bridge + policy + worker + ui-wiring + remaining core tests). `pnpm acceptance` needs a published module — run it if `spacetime start` is already up; otherwise document it as the manual/e2e command.

- [ ] **Step 5: Manual browser check (required before calling the merge done)**

1. Spacetime down → Offline banner, no fake account.
2. Worker / Nessie down → `Nessie account not loaded.`, Send Money hidden.
3. Idle → idle shield, real Nessie balance.
4. Live incoming call `demo-user` → transcript + score; Send Money at ≥ 70 → Held + bank copy; balance unchanged; no Release button.
5. Do not wait 4 hours in the demo; optionally SQL-update `expires_at` into the past and confirm the worker expires the row unsent.

- [ ] **Step 6: Commit**

```bash
git add scripts/acceptance.ts package.json README.MD packages/core/test
git commit -m "Accept live holds and document the single running stack."
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| One DB `spacetimedb/` / `watchdog-dev` | 6 |
| Bridge unchanged | (no task touches it) |
| Incoming-only + help copy | 8, 9 |
| No simulate / relay / MOCK | 6, 8, 9, 10 |
| Nessie required, worker-only | 3, 4 |
| No mock transfer ids | 3 |
| `account_snapshot` / `activity` / `payees` + upsert reducers | 2, 4 |
| `request_transfer` live gate + `demo-user` | 1, 2, 8 |
| 4-hour hold + bank copy + `Expired` | 1, 2, 5, 8 |
| No UI Release | 8, 9 |
| Worker 60s expire | 5 |
| Bindings from live module | 6 |
| Web + mobile | 8, 9 |
| Fail-stop UI banners | 8, 9, 10 |
| Acceptance Held + wrong userId | 10 |
| Delete claim/guard/simulate tests | 10 |
| README one stack | 10 |
| Do not delete `spacetime/` or `apps/relay` trees | 6 (unpublished only) |
