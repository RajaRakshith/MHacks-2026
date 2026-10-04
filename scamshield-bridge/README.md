# ScamShield bridge (call server)

Twilio (call audio) → Grok Voice (live transcript) → Gemini (risk score) → SpacetimeDB module in [`../spacetimedb`](../spacetimedb).
ElevenLabs is TTS for the spoken warning only.

```
Twilio ──POST /twilio/voice──▶ TwiML <Stream>
Twilio ──wss /media-stream──▶ CallSession ──wss──▶ Grok Voice (transcript only)
                                  │
                                  ▼ each flush
                               Gemini score ──▶ SpacetimeDB reducers (HTTP)
                                                start_call_session
                                                append_transcript_segment
                                                record_risk_event
                                                end_call_session
                                  risk ≥ TTS_WARNING_SCORE ──▶ ElevenLabs TTS
                                  (once per call)              spoken into the call
```
- Grok Voice transcribes. Gemini scores each flush. ElevenLabs TTS is the warning only.
- `record_risk_event` sets `call_sessions.risk_score`, which `request_transfer` checks, so a high score here is what holds the transfer.
- Grok's own audio is never sent back to Twilio. The only audio the bridge sends into the call is the one-time ElevenLabs TTS warning.
- If Grok's socket dies, the call logs the failure and does not switch engines.
- `start_call_session` doesn't return an id, so the bridge looks up the new `call_sessions` row by Twilio CallSid over the SQL endpoint.

## Run

Config lives in the **repo-root** `.env` (copy `../.env.example`). A `scamshield-bridge/.env` is also read and takes precedence.

From the repo root:
```powershell
npm install
npm run bridge:test   # mocked tests: Grok STT, Gemini score, fail-loud scoring, boot keys (no keys needed)
npm run bridge:dev    # http://localhost:8080, restarts on edits
```
`npm run test:tts --workspace=scamshield-bridge` synthesizes the warning with your real ElevenLabs key and writes `scam-warning.ulaw`.

The process exits before listen if `XAI_API_KEY`, `GEMINI_API_KEY`, or `ELEVENLABS_API_KEY` is missing or empty.

SpacetimeDB must be running with the module published (`spacetime start`, then `npm run spacetime:publish:local`); see the root README.
Twilio webhook: `https://YOUR-NGROK-HOST/twilio/voice?userId=demo-user` (HTTP POST).

| Endpoint | |
|---|---|
| `POST /twilio/voice` | Twilio voice webhook; returns TwiML streaming the call to `/media-stream` |
| `WS /media-stream` | Twilio Media Stream |
| `GET /health` | loaded keys (xAI, Gemini, ElevenLabs), SpacetimeDB target, live calls (with their `call_sessions.id`) |
| `POST /calls/:callSid/warn` | speak the TTS warning into a live call right now (demo/testing) |

Watch the terminal on a test call: `grok connected`, `spacetime call_sessions.id=N`, `#N [grok] transcript: ...`, `risk NN (gemini) [...]`.

## Files
- `src/server.js` — HTTP routes + the `/media-stream` websocket; refuses to listen without required API keys
- `src/keys.js` — `missingApiKeys()` for `XAI_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`
- `src/env.js` — loads `scamshield-bridge/.env` then the repo-root `.env`
- `src/callSession.js` — one per call: Grok STT, Gemini score on each flush, writes to SpacetimeDB in order, triggers the TTS warning
- `src/engines/grok.js` — Grok Voice realtime STT (prompt is `INSTRUCTIONS` at the top)
- `src/gemini.js` — Gemini risk score on each transcript flush
- `src/risk.js` — shared risk schema and scoring guide
- `src/spacetime.js` — reducer + SQL calls against the `spacetimedb/` module
- `src/tts.js`, `src/integration.js` — ElevenLabs TTS → µ-law → Twilio stream
