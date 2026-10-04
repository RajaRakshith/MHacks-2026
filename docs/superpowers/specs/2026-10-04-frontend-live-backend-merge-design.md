# Frontend + live backend merge

Date: 2026-10-04
Branch: `main`
Status: approved in conversation; awaiting spec review

## Goal

The C1 Mockup dashboard and phone app subscribe to the live money-gate module (`spacetimedb/`). A real incoming Twilio call, transcribed and scored by the existing bridge, is what the UI shows. Send Money is held or approved only by `request_transfer` on that module. Nessie is required for the bank shell. There is no scripted simulate, no mock ledger, and no fake screen when something is down.

## Current state (what we are changing)

Two stacks share the repo and do not share a runtime.

- **Live:** Twilio → `scamshield-bridge` → Grok → Gemini → ElevenLabs. State is `call_sessions`, `transcript_segments`, `risk_events`, `transfer_intents` in `spacetimedb/`. `request_transfer` holds when `userId` has an active session and `risk_score ≥` config threshold (default 70). The worker executes Approved intents. There is no dashboard on this path. If `NESSIE_API_KEY` is missing, the worker currently invents a mock transfer id — that goes away.
- **Dashboard:** `apps/web` and `apps/mobile` subscribe to a second module (`spacetime/`) with `call`, `transcript`, `hold`, `guard`, claim verdicts, and a mock Margaret ledger. Protect / Simulate go through `apps/relay`. Transfers use trusted-payee / 4-hour-guard rules, not live `risk_score`. `pnpm dev` publishes `spacetime/` to database `scamshield` and starts the relay.

The user places and merges the call themselves. The dashboard only watches.

## Architecture

One SpacetimeDB: `spacetimedb/`. The bridge keeps writing calls into it. The dashboard and phone app subscribe to it. The worker is the only process that calls Nessie.

```
User phone ──merge──▶ Twilio number ──▶ scamshield-bridge
                                          │ Grok / Gemini / ElevenLabs
                                          ▼
                                    SpacetimeDB (spacetimedb/)
                                          ▲
                    subscribe + request_transfer
                                          │
                              apps/web + apps/mobile
                                          ▲
                    Nessie refresh + execute approved
                                          │
                                      worker/
                                          ▼
                                       Nessie
```

**Identity.** Every session and every transfer uses `userId = "demo-user"` (`DEFAULT_USER_ID`). The Margaret login stays a demo door and does not change the user id.

**Local database name.** `scamshield-dev` (existing `spacetime.dev.json` / live publish). Web and mobile `VITE_SPACETIME_DB` (and the Expo equivalent) point at that name. Drop the extra `SPACETIME_DB=scamshield` split. Maincloud remains `scamshield`.

## Components

### `spacetimedb/` (source of truth)

Keep the existing call and money-gate tables and reducers. Add a thin bank shell. Do not add claim, guard, tactic, or mock tables.

**New public tables**

| Table | Fields | Purpose |
|---|---|---|
| `account_snapshot` | singleton `id: u8`, `name`, `nickname`, `last4`, `balance: f64`, `updatedAt` | Nessie account shown on Account |
| `activity` | `id: string` PK, `kind`, `date`, `description`, `amount: f64`, `sortIndex: u32` | Recent ledger, display only |
| `payees` | `name` PK, `nessieAccountId`, `trusted: bool` | Send Money destinations. `trusted` is unused by policy; kept only so a seeded landlord can be labeled in the form. |

**New reducers** (worker-only; the UI does not call them)

- `upsert_account_snapshot({ name, nickname, last4, balance })`
- `replace_activity(rows)` — one reducer that deletes existing activity and inserts the latest Nessie list
- `upsert_payee({ name, nessieAccountId, trusted })`

Existing reducers stay: `start_call_session`, `end_call_session`, `update_risk_score`, `record_risk_event`, `append_transcript_segment`, `request_transfer`, `complete_transfer`, `fail_transfer`, `release_held_transfer`, `set_risk_hold_threshold`.

`request_transfer` is still a reducer (no return payload). Hold rule is unchanged: active session for that `userId` and `riskScore >= threshold` → `Held`, else `Approved`.

### `worker/`

Two jobs, both fail-stop:

1. **Refresh.** On startup and again after `complete_transfer` or `fail_transfer`, GET the Nessie account (`NESSIE_ACCOUNT_ID`), customer name, and recent deposits / withdrawals / transfers. Upsert snapshot, activity, and payees. Adapt the existing fetch in `spacetime/src/nessie.ts` / `packages/core` into the worker as Node `fetch` (the worker does not use Spacetime `ctx.http`). Do not call Nessie from the browser or from a Spacetime procedure in this merge. No periodic timer and no UI-triggered refresh in this merge.
2. **Execute.** Subscribe to `transfer_intents` with status Approved. POST to Nessie. Success → `complete_transfer` and refresh snapshot. Failure → `fail_transfer` with the API error.

If `NESSIE_API_KEY` or `NESSIE_ACCOUNT_ID` is missing, or Nessie errors, the worker stays running, logs the error, writes no snapshot, and must not return `ok: true` with a `mock-…` transfer id. Delete that simulation path. The dashboard then shows “Nessie account not loaded.”

Payees come from `scripts/seed.ts` output (`.seed.json` landlord / other accounts) plus any extra Nessie accounts the refresh can see. Send Money can also use a typed destination account id.

### `scamshield-bridge/`

Unchanged call pipeline. It does not learn about the bank.

### `packages/bindings`

Regenerate from `spacetimedb/`, not `spacetime/`. Web and mobile both import this package. Worker bindings stay in `worker/src/module_bindings` (already generated from the live module). `spacetime generate` for the dashboard must use `--module-path spacetimedb`.

### Dashboard (`apps/web`) and phone (`apps/mobile`)

Same tables, same reducers.

| Surface | After the merge |
|---|---|
| Login | Unchanged demo door (`margaret` / `demo1234`). Not a user id. |
| Account | Name, last4, Nessie balance. Recent activity from the worker refresh. No snapshot → error, Send Money disabled. |
| Send Money | Payee (list or typed Nessie account id) → `request_transfer({ userId: "demo-user", amountCents, destinationAccount, memo })`. Watch the new `transfer_intents` row for Held / Approved / Completed / Failed. Dollars in the form become integer cents. No confirmation step. No trusted-payee or 4-hour-guard rules. |
| ScamShield | Risk meter from `call_sessions.risk_score`. Transcript from `transcript_segments` (no speaker field; show as a single stream). Warnings / signals from `risk_events`. Idle when there is no active session. Static help: how to dial / merge the ScamShield Twilio number. **No Protect, no Simulate, no scenario dropdown, no relay client.** |
| Held | Lists `transfer_intents`. “Money protected” = sum of Held amounts (cents → dollars). After the call is Ended or score is under threshold, Release calls `release_held_transfer({ intentId, force: false })`. No family Approve / Reject. Force override is not on the demo UI. |
| Account analysis / `/try` | Removed. |

Status pill is display-only, derived from the live score: no active session → idle; active and `< 40` → listening; `40–69` → caution; `≥ 70` → scam-likely. It does not decide holds.

### Running path

`pnpm dev` / `scripts/dev.mjs` publishes `spacetimedb/` to `scamshield-dev`, generates `packages/bindings` from that module, starts the **worker** (not the relay), and starts the dashboard. `MOCK` is removed.

Remove from the running path: `spacetime/` publish, `apps/relay`, Protect / Simulate, fixture playback, `postRelay`, `MOCK=1`. Delete the web/mobile relay clients and the Protect / Simulate / `/try` / Account analysis UI so they cannot be launched by accident. Do not delete the `spacetime/` or `apps/relay` trees in this merge; `pnpm dev` must not publish or start them.

`apps/button`, `server/`, and `Twilio/` stay out of this merge.

## Data flow

**Boot.** Worker starts → Nessie fetch → upsert snapshot / activity / payees. UI connects and subscribes to `call_sessions`, `transcript_segments`, `risk_events`, `transfer_intents`, `account_snapshot`, `activity`, `payees`, `config`.

**Live call.** User merges the ScamShield number (`userId=demo-user`). Bridge: `start_call_session` → Grok flush → `append_transcript_segment` → Gemini → `record_risk_event`. Hangup → `end_call_session`. UI paints those rows. Help copy does not start a call.

**Send Money.** UI calls `request_transfer`. The reducer reads the active session in the same transaction and inserts Held or Approved.

- **Held:** worker does nothing. Nessie is untouched. Held panel totals it.
- **Approved:** worker sends to Nessie. Success → `complete_transfer` + snapshot refresh. Nessie error → `fail_transfer`. UI shows Failed, not Sent.

**Release.** `release_held_transfer` without force after the session is no longer high-risk. Worker may then send.

## Error handling

Fail-stop: if a dependency did not succeed, say so. No mock call, no mock Margaret ledger, no guessed score, no “Sent” unless Nessie completed.

| Process / moment | Failure | What happens |
|---|---|---|
| Bridge boot | Missing `XAI_API_KEY`, `GEMINI_API_KEY`, or `ELEVENLABS_API_KEY` | Already refuses to listen. Unchanged. |
| Worker boot | Missing `NESSIE_API_KEY` or `NESSIE_ACCOUNT_ID`, or Nessie error | Stays up, logs, writes no snapshot. No mock transfer ids. |
| Dashboard | SpacetimeDB unreachable | Offline banner. No placeholder account or call. |
| Dashboard | Connected, no snapshot | Account error: Nessie account not loaded. Send Money disabled. |
| In call | Grok / Gemini / TTS / Spacetime write fails | Same as the live bridge spec. Last real rows stay on screen. No scripted conversation. |
| Send Money | Reducer errors | Alert with the error. No local held/sent chip. |
| Send Money | Approved, Nessie fails | Row is Failed with the worker reason. Balance unchanged. |
| Send Money | Held | Held + `holdReason`. Success of the gate, not a failure. |

## Config

Root `.env.example`:

- Keep `DEFAULT_USER_ID=demo-user`, Spacetime URI, live call keys, `TTS_*`, `NESSIE_API_KEY`, `NESSIE_BASE_URL`.
- Add `NESSIE_ACCOUNT_ID` (from `pnpm seed` / `.seed.json`).
- Remove `MOCK`, `RELAY_PORT`, and the duplicate `NESSIE_KEY` / `NESSIE_BASE` pair. Seed and worker both use `NESSIE_API_KEY` + `NESSIE_BASE_URL`.
- `SPACETIME_DATABASE=scamshield-dev` is the local name the UI also uses. Drop the conflicting `SPACETIME_DB=scamshield` default for `pnpm dev`.

`scripts/seed.ts` still creates the Nessie customer / account / landlord payee. It writes `NESSIE_ACCOUNT_ID` into `.seed.json` (and the operator copies that id into `.env`). Seed is required before the bank shell works.

## Tests

Keep `npm run bridge:test`. Do not loosen Grok / Gemini fail-stop, SATS-JSON, or TTS checks.

**New automated checks**

1. **Money gate.** Active session + score ≥ threshold + `request_transfer("demo-user")` → Held, worker does not call Nessie. No active high-risk session → Approved. A different `userId` is not held by `demo-user`’s call.
2. **Worker Nessie fail-stop.** Missing key / account id or Nessie error → no `account_snapshot` write; Approved intent → `fail_transfer`, never `complete_transfer`. No `mock-` transfer ids.
3. **UI wiring.** ScamShield has no Protect / Simulate / relay import. Send Money calls `request_transfer` with `demo-user` and integer cents. Held panel reads `transfer_intents`.

Replace `scripts/acceptance.ts` (four fixture scenarios against `spacetime/`) with a live-module check: start a session, record a high score, request a transfer, assert Held.

Delete dashboard tests that require Simulate, claims, or the 4-hour guard. Keep pure `packages/core` unit tests that do not boot a call.

**Manual (browser) before done**

- Spacetime down → Offline banner, no fake account.
- Worker / Nessie down → Account error, Send Money disabled.
- Idle, no call → idle shield, Nessie balance visible.
- Live incoming call as `demo-user` → transcript and score appear; Send Money at score ≥ 70 → Held; balance unchanged.
- After hangup, Release → Approved → Nessie moves or Failed with a real error.

## Out of scope

- Changing Grok / Gemini / ElevenLabs TTS behavior on the bridge.
- Claim verification, 4-hour guard, trusted-payee hold rules, fixture simulate.
- Neon, Fetch.ai, `server/`, `Twilio/`, `apps/button`.
- Force-release on the demo UI.
- Putting the Nessie API key in the browser or in a public Spacetime table.

## Success

On one database (`scamshield-dev` locally): an incoming merged call as `demo-user` updates the dashboard transcript and risk live; Send Money during score ≥ 70 is Held and Nessie does not move; after the call, Release then Nessie (or a visible Failed); if Spacetime, Nessie, or the worker is down, the UI alerts and does not show a mock bank or a scripted call.
