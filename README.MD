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
