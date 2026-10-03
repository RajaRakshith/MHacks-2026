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
| `pnpm mobile` | Start the iOS app's dev server (Expo). See "iOS app" below. |

**Real APIs:** copy `.env.example` to `.env`, set `MOCK=0` and the keys, run `pnpm seed` once, then `pnpm dev`. With `MOCK=0`, call analysis needs `GEMINI_API_KEY`: without it calls stay at Listening. For live calls, run `ngrok http 8787` and put the https URL in `PUBLIC_URL`.

## iOS app

`apps/mobile` is the same bank as a phone app: React Native with Expo (SDK 57), three tabs (Account, ScamShield, Held). It reads the same SpacetimeDB tables and calls the same reducers and procedures as the web dashboard, so both stay in sync live.

**On an iPhone, with Expo Go** (no Mac needed):

1. Install **Expo Go** from the App Store. Put the phone on the same Wi-Fi as your computer.
2. Start the demo server so the phone can reach it:

   ```bash
   pnpm dev --lan
   ```

3. In a second terminal, start the app and scan the QR code with the iPhone camera:

   ```bash
   pnpm mobile
   ```

The app finds the database (port 3000) and relay (port 8787) on the machine that served it. To point it somewhere else, set `EXPO_PUBLIC_SPACETIME_URI` and `EXPO_PUBLIC_RELAY_URL` before `pnpm mobile`.

`--lan` opens the demo database, which has no login, to everyone on the network. Use it on a network you trust.

**On WSL2,** the phone cannot reach WSL's ports by default. Set `networkingMode=mirrored` under `[wsl2]` in `%UserProfile%\.wslconfig`, run `wsl --shutdown`, and allow ports 3000, 8081, and 8787 through the Windows firewall.

**An installable build** needs Apple's tools: `npx eas-cli@latest build --platform ios` (cloud build, needs an Apple Developer account), or `npx expo run:ios` on a Mac with Xcode.

**To preview without a phone:** `pnpm --filter @scamshield/mobile web` runs the same app in a browser.

## Repo layout

```
apps/mobile     iOS app: Expo + React Native, same tables and procedures as the dashboard
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
| M3 Nessie procedures and seed | Done. Tested in mock mode and against the live Nessie API (seed, refresh, endpoint probe, transfer, cash withdrawal, hold approval). |
| M4 dashboard, M5 guard and holds, M6 simulated calls | Done, tested end to end in a browser with `MOCK=1` |
| M7 Gemini analyzer | Written, not run: needs `GEMINI_API_KEY` |
| M8 live calls (Twilio + ElevenLabs) | Written, not run: needs Twilio and ElevenLabs keys and a public URL |
| M9 FREE-WILi button | Bridge works in keyboard mode. The serial protocol follows Intrepid's Python library and has not been tried on a device. |
| M10 stretch (whisper, family alert, voice detection, `/ops`) | Not started |
| iOS app (not in the original spec) | Built with Expo. The iOS bundle builds, and the full demo was run through Expo's web target at iPhone size. It has not been run on an iPhone or a simulator: that needs a phone with Expo Go, or a Mac. |

Places where the spec was ambiguous are marked in the code with `// SPEC-QUESTION:`.

## What the live Nessie API does (checked 2026-10-03)

These answer the spec's open questions and shaped the code:

- **Balances never move.** Posting a deposit, withdrawal, purchase, or transfer leaves the account's `balance` unchanged. The dashboard balance is therefore the stored balance plus the activity. The seed opens Margaret's account at $6,750 and adds the $1,650 deposit, which shows as $8,400.
- **Per-account purchases and transfers both work.** A transfer takes no payee (`payee_id` and `medium` are rejected), so the payee goes in the description: "Transfer to Oakwood Apartments". An empty transfer list comes back as a 404.
- **Whole dollars only.** Amounts are truncated (12.34 becomes 12), so the dashboard refuses cents.
- **Always send `status`.** A withdrawal saved without one makes that account's withdrawal list fail afterwards.
- **Account numbers are assigned by the server**, and customers cannot be deleted. `pnpm seed --force` reuses the customer and replaces the accounts.
- `GET /enterprise/deposits` returned a 502 when tried, which matters for the stretch `/ops` view.

Also confirmed: SpacetimeDB 2.10.2 procedures can make outbound HTTPS calls (`ctx.http`), but not to localhost or private addresses. ElevenLabs realtime speech-to-text accepts Twilio's 8 kHz mu-law audio as is, per its API reference.
