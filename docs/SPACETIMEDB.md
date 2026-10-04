# ScamShield SpacetimeDB Backend

SpacetimeDB is the **single source of truth** for live call state and transfer policy. It replaces three things you'd otherwise hand-roll: the live state store, pub/sub fan-out, and the atomic policy check.

## Architecture

```
┌─────────────────┐     recordRiskEvent      ┌──────────────────────────────┐
│  Risk Engine    │ ────────────────────────► │         SpacetimeDB          │
│  (Grok / bridge)│     updateRiskScore       │  call_sessions               │
└─────────────────┘                           │  risk_events                 │
                                              │  transfer_intents            │
┌─────────────────┐     requestTransfer       │                              │
│  Mock Bank App  │ ────────────────────────► │  request_transfer reducer    │
│  (Nessie UI)    │     (atomic risk gate)    │  reads active session +      │
└─────────────────┘                           │  risk_score in ONE txn       │
                                              └──────────────┬───────────────┘
┌─────────────────┐  subscribe call_sessions                 │
│  Phone App UI   │ ◄──────────────────────────────────────┤
│  (risk meter)   │  subscribe risk_events                   │
└─────────────────┘                                          │
┌─────────────────┐  subscribe approved intents              │
│ Transfer Worker │ ◄────────────────────────────────────────┘
│ (Nessie exec)   │ ──► completeTransfer / failTransfer
└─────────────────┘
```

### Why the atomic gate matters

`request_transfer` reads the user's **active** `call_sessions` row and the current `risk_score` in the same transaction that writes the `transfer_intents` row. There is no gap where risk spikes to 94% after you checked and the transfer still goes through — the policy lives in the data layer.

## Tables

| Table | Purpose |
|-------|---------|
| `call_sessions` | One row per monitored call: `user_id`, `started_at`, `risk_score`, `status` |
| `risk_events` | Append-only signal log: `signal_type`, `transcript_excerpt`, `risk_score_after` |
| `transfer_intents` | Every bank transfer request: `pending → approved / held → completed` |
| `config` | Tunable `risk_hold_threshold` (default **70**) |

## Reducers

| Reducer | Caller | What it does |
|---------|--------|--------------|
| `start_call_session` | Call ingestion (Twilio worker) | Opens a session, ends any prior active one |
| `end_call_session` | Call ingestion | Marks session ended |
| `update_risk_score` | Risk engine | Bumps live score on active session |
| `record_risk_event` | Risk engine | Appends timeline row + updates score atomically |
| **`request_transfer`** | **Mock bank app** | **Atomic money gate — approves or holds** |
| `complete_transfer` | Transfer worker | After Nessie succeeds |
| `fail_transfer` | Transfer worker | After Nessie fails |
| `release_held_transfer` | Bank app / user override | Re-evaluates or force-releases a held transfer |
| `set_risk_hold_threshold` | Admin / demo tuning | Changes hold threshold |

## Setup

### 1. Install SpacetimeDB CLI

**Windows (PowerShell):**
```powershell
iwr https://windows.spacetimedb.com -useb | iex
```

**macOS / Linux:**
```bash
curl -sSf https://install.spacetimedb.com | sh
```

**Important:** Close and reopen your terminal after install so `PATH` reloads.

Verify the CLI is found (not "term not recognized"):
```powershell
spacetime version list
```

If PowerShell still can't find `spacetime`, either open a **new terminal** or run:
```powershell
.\scripts\setup-spacetime.ps1
```

Or call it by full path:
```powershell
& "$env:LOCALAPPDATA\SpacetimeDB\spacetime.exe" version list
```

### 2. Install dependencies

```bash
npm install
```

### 3. Agent / Cursor setup (one time)

Per [spacetimedb.com/agent-setup.md](https://spacetimedb.com/agent-setup.md):

- SpacetimeDB CLI on PATH (see step 1)
- Cursor MCP configured at `~/.cursor/mcp.json` (points at `spacetime mcp`)
- **Reload Cursor** after setup (Settings → Tools & Integrations)

Install official skills (optional, if `npx` works on your network):
```bash
npx -y skills add https://github.com/clockworklabs/SpacetimeDB/tree/master/skills --skill '*' --yes --global
```

### 4. Login (Maincloud only)

Redeem credits on the website, then in a **new terminal**:
```bash
spacetime login
```

### 5. Local dev (`spacetime dev`)

Terminal A:
```bash
spacetime start
```

Terminal B (repo root — auto-publish + generate bindings on save):
```bash
npm run spacetime:dev
```

Or one-shot publish to local dev DB (`scamshield-dev` via `spacetime.dev.json`):
```bash
npm run spacetime:publish:local
```

For Maincloud (demo / judges):

> **Stop here for credits:** Before `spacetime login`, go to [spacetimedb.com/settings/buy-energy](https://spacetimedb.com/settings/buy-energy) (or the promo/redeem page in your sponsor email) and enter your free-credits code. Then log in and publish.

```bash
spacetime login
npm run spacetime:publish:cloud
```

After login, set `SPACETIME_URI=wss://maincloud.spacetimedb.com` in your local `.env` (never commit this file — see `.gitignore`).

### 6. Generate TypeScript client bindings

`spacetime dev` does this automatically. Manual:
```bash
npm run spacetime:generate
```

Bindings go to `worker/src/module_bindings/`.

### 7. Run the transfer worker

```bash
cp .env.example .env
npm run worker:dev
```

The worker subscribes to `transfer_intents` with `status = Approved`, calls Nessie, then invokes `complete_transfer` or `fail_transfer`.

## Demo flow (CLI smoke test)

With the module published locally:

```bash
# Start a call session
spacetime call scamshield start_call_session '{"userId":"demo-user"}'

# Escalate risk (simulating Grok output)
spacetime call scamshield record_risk_event '{
  "sessionId": 1,
  "signalType": "otp_request",
  "transcriptExcerpt": "Please read me the verification code on your screen.",
  "riskScoreAfter": 94,
  "warningMessage": "DO NOT SHARE THE CODE"
}'

# Bank app requests transfer — should be HELD
spacetime call scamshield request_transfer '{
  "userId": "demo-user",
  "amountCents": 200000,
  "destinationAccount": "scammer-account",
  "memo": "urgent wire"
}'

spacetime sql scamshield "SELECT id, status, hold_reason, risk_score_at_decision FROM transfer_intents"
```

End the call and release (or force override):

```bash
spacetime call scamshield end_call_session '{"sessionId": 1}'

spacetime call scamshield release_held_transfer '{"intentId": 1, "force": false}'
```

## Integration contracts for other teammates

### Risk engine → SpacetimeDB

After each Grok scoring pass on a transcript chunk:
```typescript
connection.reducers.recordRiskEvent({
  sessionId,
  signalType: 'otp_request',       // from structured Grok output
  transcriptExcerpt: chunk.text,
  riskScoreAfter: 94,
  warningMessage: 'DO NOT SHARE THE CODE',
});
```

### Phone app → SpacetimeDB

Subscribe to the user's active session and risk events (see `worker/src/client.ts` for SQL). Risk meter binds directly to `call_sessions.risk_score`.

### Mock bank app → SpacetimeDB

Never call Nessie directly. Always:
```typescript
connection.reducers.requestTransfer({
  userId,
  amountCents: 200000n,
  destinationAccount: 'payee-id',
  memo: 'wire',
});
```

Then subscribe to the inserted `transfer_intents` row — status will be `Held` or `Approved` immediately.

### Call ingestion → SpacetimeDB

On Twilio merge connect: `startCallSession`. On hangup: `endCallSession`.

## Environment variables

Copy `.env.example` to `.env` locally. **Do not commit `.env`** — it may hold `SPACETIME_TOKEN`, `NESSIE_API_KEY`, and other secrets. `.gitignore` already excludes `.env` and `.env.*`.

Key values:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SPACETIME_URI` | `ws://127.0.0.1:3000` | WebSocket endpoint |
| `SPACETIME_DATABASE` | `scamshield` | Database name |
| `NESSIE_API_KEY` | — | Capital One Nessie API key |

## File layout

```
spacetimedb/
  src/
    schema.ts      # Tables + enums
    constants.ts   # Default threshold
    helpers.ts     # Active session lookup, hold reason builder
    index.ts       # All reducers
worker/
  src/
    transfer-worker.ts   # Nessie execution loop
    nessie-client.ts     # Nessie API stub
    client.ts            # Subscription SQL helpers for frontends
    module_bindings/     # Generated — do not edit
```
