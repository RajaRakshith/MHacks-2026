# ScamShield

## What it is

ScamShield is a real-time scam-call defense system. It joins your suspicious calls as a silent third participant, transcribes and analyzes what's being said, warns you live as social-engineering tactics escalate — and, crucially, it sits in front of your money: a mock banking app routes every transfer through ScamShield's policy engine, which holds transfers while a high-risk call is active.

## What it's meant to do

- Detect social engineering from conversation content (impersonation, urgency, threats, payment/OTP requests), not just caller ID.
- Show live, escalating risk to the victim mid-call (transcript + risk meter + specific warnings like "DO NOT SHARE THE CODE").
- Prevent the actual loss: any transfer attempted during a high-risk call is held, with the reason shown. The demo proves the money can't move, not just that a warning appeared.

## Architecture

1. **Call ingestion:** User receives suspicious call → Add Call → dial ScamShield's Twilio number → Merge. Twilio Media Streams pipes live audio to your server over websocket.
2. **Transcription:** Grok Voice transcribes the call live. ElevenLabs TTS speaks a one-time warning into the call at critical risk.
3. **Risk engine:** Gemini scores each flush — risk score 0–100, detected signals, recommended action, victim-facing warning.
4. **Real-time state (SpacetimeDB):** one module, `spacetimedb/`, published as `scamshield-dev`. `call_sessions` holds live risk per user; `transfer_intents` holds every transfer. A high-risk transfer is **Held** (come to the bank, 4 hours) and then **Expired** — it is not released from the dashboard. The phone app and the policy engine both subscribe — no polling.
5. **Money gate:** The mock Capital One bank app (Nessie underneath for accounts, balances, ledger) never calls Nessie transfers directly. It calls the `request_transfer` reducer, which checks for an active high-risk call session (risk ≥ 70 by default) in the same transaction that records the intent. No code path moves money without the check.
6. **Durable store (Neon Postgres):** users, devices, call history, held-transfer audit log, signal timelines for the post-call report.

## APIs and connectors needed

Twilio (Programmable Voice + Media Streams + a phone number), xAI Grok (Grok Voice STT), ElevenLabs (TTS warning), Gemini (risk score), SpacetimeDB (live backend), Nessie/Capital One (mock banking ledger), Neon (Postgres + auth).

**Stretch:** register the risk analyzer on Fetch.ai Agentverse so other agents can query call risk via ASI:One.

## Prize targeting

- **Tracks:** Actually Intelligent and FinTech ($2,500 each) — it's genuinely both, not shoehorned.
- **Sponsor:** Best Use of Nessie ($300/member for 1st — the mock bank app is core, not decorative), Best Project Built with ElevenLabs, Best Use of Spacetime ($1,000 — live call state + transfer gating is exactly what they ask for), Best Use of Neon Backend, MLH Best Use of Gemini. Fetch.ai challenge as a stretch if the agent registration works.
- **Grand prize narrative:** "a bank that defends you while you're being scammed."

## Demo script (3 minutes)

Teammate plays the scammer ("fraud department," urgent, demands a wire + OTP). Victim merges ScamShield; audience screen shows transcript with risk climbing 20 → 60 → 94% and warnings firing. Victim opens the mock bank app — risk banner is already there — attempts the transfer, gets **HELD**. Call ends; post-call report shows the signal timeline and the held transfer with "you would have lost $2,000."

## Repo layout

| Folder | What it is |
|--------|------------|
| `scamshield-bridge/` | **Live call server.** Twilio webhook + Media Stream → Grok Voice transcribes; Gemini scores each flush; ElevenLabs TTS warning → SpacetimeDB reducers |
| `spacetimedb/` | Live money-gate module: `call_sessions`, `risk_events`, `transcript_segments`, `transfer_intents`, `config` + atomic `request_transfer` |
| `worker/` | Transfer worker: subscribes to approved `transfer_intents`, executes them on Nessie |
| `server/` | Alternative TypeScript ingestion server. See [docs/INGESTION.md](docs/INGESTION.md) |
| `Twilio/` | Standalone Twilio Media Streams proof of concept |
| `apps/web` | Bank dashboard (Vite + React + Tailwind) |
| `apps/mobile` | Same bank as an Expo / React Native phone app |
| `apps/relay` | Old simulated-call relay. `pnpm dev` does not start it |
| `apps/button` | FREE-WILi bridge (USB serial), with a keyboard fallback |
| `spacetime/` | Old dashboard module. `pnpm dev` does not publish it |
| `packages/core` | Shared scoring and live-call helpers, with unit tests |
| `packages/bindings` | Generated client bindings for the live module |
| `fixtures` | Scripted calls and mock Nessie data (not on the running path) |

```
Twilio ──POST /twilio/voice──▶ scamshield-bridge ──▶ Grok Voice (transcribes)
       ──wss /media-stream──▶        │ Gemini scores each flush; ElevenLabs TTS warning
                                     │ HTTP reducers: start_call_session / append_transcript_segment
                                     ▼                record_risk_event / end_call_session
                               SpacetimeDB (spacetimedb/) ◀── request_transfer ── bank app
                                     │ approved intents
                                     ▼
                               worker/ ──▶ Nessie (approved intents only; Held expires unsent)

Dashboard (apps/web, apps/mobile) ──▶ SpacetimeDB database scamshield-dev
```

## Running

One stack. You need Node 20+, pnpm 9, and the SpacetimeDB CLI (`curl -sSf https://install.spacetimedb.com | sh`). Copy `.env.example` to `.env` and fill in the Nessie and live-call keys.

```bash
spacetime start
# .env has Nessie + live call keys
pnpm seed   # once; copy NESSIE_ACCOUNT_ID into .env
pnpm dev    # live module + worker + dashboard
npm run bridge:dev
npm run tunnel
```

`pnpm dev` publishes `spacetimedb/` to `scamshield-dev`, regenerates bindings, and starts the worker and the dashboard (http://localhost:5173). It does not publish `spacetime/` or start the relay.

Point the Twilio number's **A call comes in** webhook at `https://HOST/twilio/voice?userId=demo-user` (HTTP POST).

Merge ScamShield on the phone; the dashboard watches. Send $2000 during a high-risk call → Held, come to the bank, 4 hours. The balance does not move, and there is no Release button.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Publish the live module and start the worker and dashboard |
| `pnpm reset` | Republish `spacetimedb/` to `scamshield-dev` with a clean database |
| `npm test` | Bridge, policy, worker, UI wiring, and remaining core tests (no Twilio) |
| `pnpm acceptance` | Live hold check against published `scamshield-dev` (needs `spacetime start`) |
| `pnpm seed` | Create the Nessie customer once; copy `NESSIE_ACCOUNT_ID` into `.env` |
| `pnpm phone` | Run the iOS app in Expo Go over a tunnel |
| `pnpm mobile` | Start the Expo dev server for a phone on the same network |

`npm test` does not need Twilio or a running database. Details: [scamshield-bridge/README.md](scamshield-bridge/README.md), [docs/SPACETIMEDB.md](docs/SPACETIMEDB.md).

## iOS app

`apps/mobile` is the same bank as a phone app: React Native with Expo (SDK 57), three tabs (Account, ScamShield, Held). It reads the same `scamshield-dev` tables and calls the same reducers as the web dashboard.

**On an iPhone, with Expo Go:**

1. Install **Expo Go** from the App Store.
2. With `pnpm dev` running in one terminal, run `pnpm phone` in a second one and scan the QR code.

`pnpm phone` opens a public tunnel to the database. While it runs, anyone who has the tunnel URL can reach the demo database. The phone app does not use the relay.

**On the same Wi-Fi, without tunnels:** `pnpm dev --lan` then `pnpm mobile`. The app finds the database (port 3000) on the machine that served it. `--lan` opens the demo database to everyone on the network.

To preview without a phone: `pnpm --filter @scamshield/mobile web`.
