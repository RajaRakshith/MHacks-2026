# ScamShield

## What it is

ScamShield is a real-time scam-call defense system. It joins your suspicious calls as a silent third participant, transcribes and analyzes what's being said, warns you live as social-engineering tactics escalate — and, crucially, it sits in front of your money: a mock banking app routes every transfer through ScamShield's policy engine, which holds transfers while a high-risk call is active.

## What it's meant to do

- Detect social engineering from conversation content (impersonation, urgency, threats, payment/OTP requests), not just caller ID.
- Show live, escalating risk to the victim mid-call (transcript + risk meter + specific warnings like "DO NOT SHARE THE CODE").
- Prevent the actual loss: any transfer attempted during a high-risk call is held, with the reason shown. The demo proves the money can't move, not just that a warning appeared.

## Architecture

1. **Call ingestion:** User receives suspicious call → Add Call → dial ScamShield's Twilio number → Merge. Twilio Media Streams pipes live audio to your server over websocket.
2. **Transcription:** ElevenLabs (Scribe) converts audio to real-time text. Optional: ElevenLabs TTS injects a spoken warning into the call at critical risk ("Warning: this call shows signs of fraud").
3. **Risk engine:** Transcript chunks go to an LLM (Gemini) with structured output — risk score 0–100, detected signals, recommended action. Scores update as the conversation evolves.
4. **Real-time state (SpacetimeDB):** `call_sessions` table holds live risk per user; `transfer_intents` table holds every transfer as pending → held / released. The phone app and the policy engine both subscribe — no polling.
5. **Money gate:** The mock Capital One bank app (Nessie underneath for accounts, balances, ledger) never calls Nessie transfers directly. It submits transfer intents to ScamShield's policy endpoint, which checks for an active high-risk call session before executing. No code path moves money without the check.
6. **Durable store (Neon Postgres):** users, devices, call history, held-transfer audit log, signal timelines for the post-call report.

## APIs and connectors needed

Twilio (Programmable Voice + Media Streams + a phone number), ElevenLabs (STT, optionally TTS), Google Gemini (risk scoring), SpacetimeDB (live backend), Nessie/Capital One (mock banking ledger), Neon (Postgres + auth).

**Stretch:** register the risk analyzer on Fetch.ai Agentverse so other agents can query call risk via ASI:One.

## Prize targeting

- **Tracks:** Actually Intelligent and FinTech ($2,500 each) — it's genuinely both, not shoehorned.
- **Sponsor:** Best Use of Nessie ($300/member for 1st — the mock bank app is core, not decorative), Best Project Built with ElevenLabs, Best Use of Spacetime ($1,000 — live call state + transfer gating is exactly what they ask for), Best Use of Neon Backend, MLH Best Use of Gemini. Fetch.ai challenge as a stretch if the agent registration works.
- **Grand prize narrative:** "a bank that defends you while you're being scammed."

## Demo script (3 minutes)

Teammate plays the scammer ("fraud department," urgent, demands a wire + OTP). Victim merges ScamShield; audience screen shows transcript with risk climbing 20 → 60 → 94% and warnings firing. Victim opens the mock bank app — risk banner is already there — attempts the transfer, gets **HELD**. Call ends; post-call report shows the signal timeline and the held transfer with "you would have lost $2,000."

## Biggest risks to de-risk early

Twilio merge + Media Streams setup is the hardest infra piece — get a basic "third participant hears audio" working first. Then STT latency/chunking, then the policy gate, then polish. False-positive handling (user override with explicit confirm) is worth mentioning to judges so it doesn't look naive.

---

## Running the demo

The dashboard is a mock bank called **C1 Mockup** with ScamShield built in. Everything below runs with `MOCK=1`: no Twilio, ElevenLabs, Gemini, or Nessie keys.

**You need:** Node 20, pnpm 9, and the SpacetimeDB CLI.

```bash
curl -sSf https://install.spacetimedb.com | sh
```

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev` starts a local SpacetimeDB (if one is not already running), publishes the module, regenerates the client bindings, and starts the relay (port 8787) and the dashboard (http://localhost:5173).

**The 60-second demo, mock mode**

1. Open http://localhost:5173. Margaret's balance is $8,400 and ScamShield is Idle.
2. Press **Protect this call**. A scripted scam call plays in real time; the status goes to Listening.
3. About 9 seconds in, the caller claims a $900 deposit. The claim check shows **False**: "No $900 deposit in the last 30 days."
4. About 17 seconds in, the meter turns red (Scam likely) and transfers are protected for 4 hours.
5. Send $2,000 to "Account Services". It comes back **Held**, and Money protected shows $2,000.

Other scenarios are in the dropdown next to **Simulate call**: fake fraud alert, utility shutoff, and a legitimate pharmacy call that stays green.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start everything |
| `pnpm reset` | Republish the module with a clean database (clears calls, holds, mock transfers) |
| `pnpm test` | Unit tests for scoring, transaction rules, and claim verifiers |
| `pnpm acceptance` | End-to-end check of all four scenarios and the held transfer, against a running `pnpm dev` |
| `pnpm seed` | Create Margaret in the real Nessie API and write `.seed.json` (needs `NESSIE_KEY`) |
| `pnpm --filter @scamshield/button keyboard` | Button bridge without the hardware: Enter is a press, `l` + Enter is a long press |

**Real APIs:** copy `.env.example` to `.env`, set `MOCK=0` and the keys, run `pnpm seed` once, then `pnpm dev`. For live calls, run `ngrok http 8787` and put the https URL in `PUBLIC_URL`.

## Repo layout

```
apps/web        Dashboard: Vite + React + Tailwind, renders SpacetimeDB table subscriptions
apps/relay      Fastify relay: /simulate, /protect, Twilio webhook and media stream, ElevenLabs STT
apps/button     FREE-WILi bridge (USB serial), with a keyboard fallback
spacetime       SpacetimeDB TypeScript module: all state, scoring, rules, Gemini and Nessie calls
packages/core   Pure logic with unit tests: types, scoring, transaction rules, verifiers
packages/bindings  Generated SpacetimeDB client bindings (do not edit)
fixtures        Scripted calls and mock Nessie data
scripts         dev, seed, acceptance
```

## What is built and what is not

| Milestone | Status |
| --- | --- |
| M0 scaffold, M1 core engine, M2 module | Done, tested |
| M3 Nessie procedures and seed | Mock mode done and tested. Real mode is written but has not been run against the live API. |
| M4 dashboard, M5 guard and holds, M6 simulated calls | Done, tested end to end in a browser with `MOCK=1` |
| M7 Gemini analyzer | Written, not run: needs `GEMINI_API_KEY` |
| M8 live calls (Twilio + ElevenLabs) | Written, not run: needs Twilio and ElevenLabs keys and a public URL |
| M9 FREE-WILi button | Bridge works in keyboard mode. The serial protocol follows Intrepid's Python library and has not been tried on a device. |
| M10 stretch (whisper, family alert, voice detection, `/ops`) | Not started |

Places where the spec was ambiguous are marked in the code with `// SPEC-QUESTION:`.
