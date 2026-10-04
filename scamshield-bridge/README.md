# ScamShield bridge (call server)

Twilio (call audio) → Grok Voice (live transcript + risk score) → SpacetimeDB module in [`../spacetimedb`](../spacetimedb),
with ElevenLabs as the redundancy if Grok goes down and ElevenLabs TTS for the spoken warning.

```
Twilio ──POST /twilio/voice──▶ TwiML <Stream>
Twilio ──wss /media-stream──▶ CallSession ──wss──▶ Grok Voice ── transcript + report_risk()
                                  │                                    │
                                  │ Grok fails (connect/error/drop)    ▼
                                  └──▶ ElevenLabs Scribe ──▶ Grok text scoring ──▶ SpacetimeDB reducers (HTTP)
                                        (failover)          (keyword heuristic      start_call_session
                                                             if that's down too)    append_transcript_segment
                                                                                    record_risk_event
                                  risk ≥ TTS_WARNING_SCORE ──▶ ElevenLabs TTS ──▶   end_call_session
                                  (once per call)              spoken into the call
```
- `record_risk_event` sets `call_sessions.risk_score`, which `request_transfer` checks, so a high score here is what holds the transfer.
- Grok's own audio is never sent back to Twilio. The only audio the bridge sends into the call is the one-time ElevenLabs TTS warning.
- Failover is per call and one-way: once a call switches to ElevenLabs it stays there. The risk score carries over.
- `start_call_session` doesn't return an id, so the bridge looks up the new `call_sessions` row by Twilio CallSid over the SQL endpoint.

## Run

Config lives in the **repo-root** `.env` (copy `../.env.example`). A `scamshield-bridge/.env` is also read and takes precedence.

From the repo root:
```powershell
npm install
npm run bridge:test   # mocked tests: Grok path, ElevenLabs path, failover, TTS warning (no keys needed)
npm run bridge:dev    # http://localhost:8080, restarts on edits
```
`npm run test:tts --workspace=scamshield-bridge` synthesizes the warning with your real ElevenLabs key and writes `scam-warning.ulaw`.

SpacetimeDB must be running with the module published (`spacetime start`, then `npm run spacetime:publish:local`); see the root README.
Twilio webhook: `https://YOUR-NGROK-HOST/twilio/voice?userId=demo-user` (HTTP POST).

| Endpoint | |
|---|---|
| `POST /twilio/voice` | Twilio voice webhook; returns TwiML streaming the call to `/media-stream` |
| `WS /media-stream` | Twilio Media Stream |
| `GET /health` | loaded keys, SpacetimeDB target, live calls (with their `call_sessions.id`) |
| `POST /calls/:callSid/warn` | speak the TTS warning into a live call right now (demo/testing) |

Watch the terminal on a test call: `grok connected`, `spacetime call_sessions.id=N`, `#N [grok] transcript: ...`, `risk NN (grok-voice) [...]`.
To rehearse the failover, set `XAI_REALTIME_URL=ws://localhost:1` and you'll see `failing over to elevenlabs`.

## Files
- `src/server.js` — HTTP routes + the `/media-stream` websocket
- `src/env.js` — loads `scamshield-bridge/.env` then the repo-root `.env`
- `src/callSession.js` — one per call: picks the engine, does failover, writes to SpacetimeDB in order, triggers the TTS warning
- `src/engines/grok.js` — Grok Voice realtime (prompt is `INSTRUCTIONS` at the top)
- `src/engines/elevenlabs.js` — ElevenLabs Scribe, batched every `CHUNK_SECONDS`
- `src/risk.js` — shared risk schema/scoring guide, Grok text scorer, keyword heuristic
- `src/spacetime.js` — reducer + SQL calls against the `spacetimedb/` module
- `src/tts.js`, `src/integration.js` — ElevenLabs TTS → µ-law → Twilio stream
- `src/elevenlabs.js`, `src/audio.js` — Scribe client and mu-law → WAV helpers
