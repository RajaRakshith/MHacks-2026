# ScamShield

## What it is

ScamShield is a real-time scam-call defense system. It joins your suspicious calls as a silent third participant, transcribes and analyzes what's being said, warns you live as social-engineering tactics escalate — and, crucially, it sits in front of your money: a mock banking app routes every transfer through ScamShield's policy engine, which holds transfers while a high-risk call is active.

## What it's meant to do

- Detect social engineering from conversation content (impersonation, urgency, threats, payment/OTP requests), not just caller ID.
- Show live, escalating risk to the victim mid-call (transcript + risk meter + specific warnings like "DO NOT SHARE THE CODE").
- Prevent the actual loss: any transfer attempted during a high-risk call is held, with the reason shown. The demo proves the money can't move, not just that a warning appeared.

## Architecture

1. **Call ingestion:** User receives suspicious call → Add Call → dial ScamShield's Twilio number → Merge. Twilio Media Streams pipes live audio to your server over websocket.
2. **Transcription:** Grok Voice transcribes the call live. ElevenLabs TTS speaks a one-time warning into the call at critical risk ("This is a scam call, please hang up.").
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

## Biggest risks to de-risk early

Twilio merge + Media Streams setup is the hardest infra piece — get a basic "third participant hears audio" working first. Then STT latency/chunking, then the policy gate, then polish. False-positive handling (user override with explicit confirm) is worth mentioning to judges so it doesn't look naive.

## Repo layout

| Folder | What it is | Came from branch |
|--------|------------|------------------|
| `scamshield-bridge/` | **The call server.** Twilio webhook + Media Stream → Grok Voice transcribes; Gemini scores each flush; ElevenLabs TTS warning only → SpacetimeDB reducers | `LocalServer`, `elevenlabs` |
| `spacetimedb/` | SpacetimeDB module: `call_sessions`, `risk_events`, `transcript_segments`, `transfer_intents`, `config` + the atomic `request_transfer` money gate | `spacetime` |
| `worker/` | Transfer worker: subscribes to approved `transfer_intents`, executes them on Nessie | `spacetime` |
| `server/` | Alternative TypeScript ingestion server (realtime-socket STT via the SpacetimeDB SDK). Not needed to run the demo; see [docs/INGESTION.md](docs/INGESTION.md) | `spacetime` |
| `Twilio/` | Standalone Twilio Media Streams proof of concept that records call audio to `.ulaw` files | `twilio` |

```
Twilio ──POST /twilio/voice──▶ scamshield-bridge ──▶ Grok Voice (transcribes)
       ──wss /media-stream──▶        │ Gemini scores each flush; ElevenLabs TTS warning only
                                     │ HTTP reducers: start_call_session / append_transcript_segment
                                     ▼                record_risk_event / end_call_session
                               SpacetimeDB (spacetimedb/) ◀── request_transfer ── bank app
                                     │ approved intents
                                     ▼
                               worker/ ──▶ Nessie
```

## Running it locally

Needs Node 22.9+ (`winget install OpenJS.NodeJS.LTS`), the SpacetimeDB CLI (see [docs/SPACETIMEDB.md](docs/SPACETIMEDB.md)), and ngrok.

```powershell
npm install                       # installs every workspace (bridge, module, worker, server)
copy .env.example .env            # one .env at the repo root, read by bridge + worker + server
notepad .env                      # XAI_API_KEY, GEMINI_API_KEY, ELEVENLABS_API_KEY, NESSIE_API_KEY, ...

# terminal 1 — local SpacetimeDB on :3000
spacetime start
# terminal 2 — publish the module and generate client bindings for the worker
npm run spacetime:publish:local
npm run spacetime:generate
# terminal 3 — call server on :8080
npm run bridge:dev
# terminal 4 — Nessie transfer worker
npm run worker:dev
# terminal 5 — expose the call server to Twilio
ngrok http 8080
```

Point your Twilio number's **A call comes in** webhook at `https://YOUR-NGROK-HOST/twilio/voice?userId=demo-user` (HTTP POST). The `userId` must be the same one the bank app passes to `request_transfer`.

`npm run bridge:test` runs the call server's mocked tests (no keys or SpacetimeDB needed). Details: [scamshield-bridge/README.md](scamshield-bridge/README.md), [docs/SPACETIMEDB.md](docs/SPACETIMEDB.md).
