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
4. **Real-time state (SpacetimeDB):** `call_sessions` table holds live risk per user; `transfer_intents` table holds every transfer as pending → held / released. The phone app and the policy engine both subscribe — no polling.
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
| `apps/web` | C1 Mockup dashboard (Vite + React + Tailwind) |
| `apps/mobile` | Same bank as an Expo / React Native phone app |
| `apps/relay` | Fastify relay for simulated / protected calls |
| `apps/button` | FREE-WILi bridge (USB serial), with a keyboard fallback |
| `spacetime/` | Dashboard SpacetimeDB module (scoring, holds, Nessie). `pnpm dev` publishes this path |
| `packages/core` | Pure scoring / rules / verifiers with unit tests |
| `packages/bindings` | Generated client bindings for the dashboard module |
| `fixtures` | Scripted calls and mock Nessie data |

```
Twilio ──POST /twilio/voice──▶ scamshield-bridge ──▶ Grok Voice (transcribes)
       ──wss /media-stream──▶        │ Gemini scores each flush; ElevenLabs TTS warning
                                     │ HTTP reducers: start_call_session / append_transcript_segment
                                     ▼                record_risk_event / end_call_session
                               SpacetimeDB (spacetimedb/) ◀── request_transfer ── bank app
                                     │ approved intents
                                     ▼
                               worker/ ──▶ Nessie

C1 Mockup UI (apps/web, apps/mobile) ──▶ spacetime/ module + apps/relay
```

## Running the live call pipeline

Needs Node 22.9+ (`winget install OpenJS.NodeJS.LTS`), the SpacetimeDB CLI (see [docs/SPACETIMEDB.md](docs/SPACETIMEDB.md)), and ngrok.

```powershell
npm install                       # installs every npm workspace (bridge, module, worker, server)
copy .env.example .env            # one .env at the repo root
notepad .env                      # XAI_API_KEY, GEMINI_API_KEY, ELEVENLABS_API_KEY, NESSIE_API_KEY, ...

# terminal 1 — local SpacetimeDB on :3000
spacetime start
# terminal 2 — publish the live money-gate module
npm run spacetime:publish:local
npm run spacetime:generate
# terminal 3 — call server on :8080
npm run bridge:dev
# terminal 4 — Nessie transfer worker
npm run worker:dev
# terminal 5 — stable public URL (set NGROK_DOMAIN in .env first)
npm run tunnel
```

Point your Twilio number's **A call comes in** webhook at `https://YOUR-NGROK-HOST/twilio/voice?userId=demo-user` (HTTP POST). The `userId` must be the same one the bank app passes to `request_transfer`.

`npm run bridge:test` runs the call server's mocked tests (no keys or SpacetimeDB needed). Details: [scamshield-bridge/README.md](scamshield-bridge/README.md), [docs/SPACETIMEDB.md](docs/SPACETIMEDB.md).

## Running the C1 Mockup dashboard

The dashboard is a mock bank with ScamShield built in. With `MOCK=1` it needs no Twilio, ElevenLabs, Gemini, or Nessie keys.

**You need:** Node 20+, pnpm 9, and the SpacetimeDB CLI.

```bash
curl -sSf https://install.spacetimedb.com | sh
pnpm install
pnpm dev
```

`pnpm dev` starts a local SpacetimeDB (if one is not already running), publishes the **dashboard** module in `spacetime/`, regenerates client bindings, and starts the relay (port 8787) and the dashboard (http://localhost:5173).

**The 60-second demo, mock mode**

1. Open http://localhost:5173. Margaret's balance is $8,400 and ScamShield is Idle.
2. Press **Protect this call**. A scripted scam call plays in real time; the status goes to Listening.
3. About 9 seconds in, the caller claims a $900 deposit. The claim check shows **False**: "No $900 deposit in the last 30 days."
4. About 17 seconds in, the meter turns red (Scam likely) and transfers are protected for 4 hours.
5. Send $2,000 to "Account Services". It comes back **Held**, and Money protected shows $2,000.

Other scenarios are in the dropdown next to **Simulate call**: fake fraud alert, utility shutoff, and a legitimate pharmacy call that stays green.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dashboard stack |
| `pnpm reset` | Republish the dashboard module with a clean database |
| `pnpm test:dashboard` | Unit tests for scoring, transaction rules, and claim verifiers |
| `pnpm acceptance` | End-to-end check of all four scenarios against a running `pnpm dev` |
| `pnpm seed` | Create Margaret in the real Nessie API (needs `NESSIE_KEY`) |
| `pnpm phone` | Run the iOS app in Expo Go over tunnels |
| `pnpm mobile` | Start the Expo dev server for a phone on the same network |

**Real APIs:** copy `.env.example` to `.env`, set `MOCK=0` and the keys, run `pnpm seed` once, then `pnpm dev`. For live calls through the relay, run `ngrok http 8787` and put the https URL in `PUBLIC_URL`.

## iOS app

`apps/mobile` is the same bank as a phone app: React Native with Expo (SDK 57), three tabs (Account, ScamShield, Held). It reads the same SpacetimeDB tables and calls the same reducers as the web dashboard.

**On an iPhone, with Expo Go:**

1. Install **Expo Go** from the App Store.
2. With `pnpm dev` running in one terminal, run `pnpm phone` in a second one and scan the QR code.

`pnpm phone` opens public tunnels to the database and the relay. While it runs, anyone who has the tunnel URLs can reach the demo database.

**On the same Wi-Fi, without tunnels:** `pnpm dev --lan` then `pnpm mobile`. The app finds the database (port 3000) and relay (port 8787) on the machine that served it. `--lan` opens the demo database to everyone on the network.

To preview without a phone: `pnpm --filter @scamshield/mobile web`.
