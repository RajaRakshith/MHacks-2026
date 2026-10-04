# scamshield-bridge — TTS skeleton

This folder is a **thin ElevenLabs TTS layer** that merges into the full
`scamshield-bridge` on the `LocalServer` / `twilio` branch later.

The main bridge (Twilio WS → Grok STT → SpacetimeDB) lives on that branch.
This branch only adds:

| File | Purpose |
|------|---------|
| `src/tts.js` | Synthesize + stream scam warning (µ-law 8 kHz) |
| `src/integration.js` | Hooks to wire into `CallSession` after merge |
| `test/tts.mjs` | Smoke test (writes `scam-warning.ulaw`) |
| `docs/MERGE.md` | Step-by-step merge instructions |

## Setup

```bash
cp .env.example .env   # add your ELEVENLABS_API_KEY
npm run test:tts
```

## After merge

See [docs/MERGE.md](docs/MERGE.md) for wiring `onScamDetected()` to your
future call-score pipeline.
