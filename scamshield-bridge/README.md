# ScamShield bridge

Local Node.js server: Twilio (call audio) → Grok Voice (live transcript + risk score) → SpacetimeDB (live state),
with ElevenLabs as the redundancy if Grok goes down.

```
                      ┌────────── primary ──────────┐
Twilio ──POST /twilio/voice──▶ TwiML <Stream>       │
Twilio ──wss /media-stream──▶ CallSession ──wss──▶ Grok Voice ── transcript + report_risk()
                                  │                                    │
                                  │ Grok fails (connect/error/drop)    ▼
                                  └──▶ ElevenLabs Scribe ──▶ Grok text scoring ──▶ SpacetimeDB reducers
                                        (failover)          (keyword heuristic      start_call / append_transcript
                                                             if that's down too)    update_risk / end_call
```
- Grok's audio is never sent back to Twilio, so it can't speak on the call.
- Failover is per call and one-way: once a call switches to ElevenLabs it stays there. Transcript `seq` and the risk score carry over.
- Risk always arrives in the same shape: `score 0-100, signals[], action (none|monitor|warn|hold_transfers), warning, evidence`.

## Run locally (Windows)

1. Install Node 20+ (`winget install OpenJS.NodeJS.LTS`, then reopen the terminal; `node -v` to check).
2. In this folder:
   ```powershell
   npm install
   copy .env.example .env
   notepad .env        # fill XAI_API_KEY, ELEVENLABS_API_KEY, SPACETIME_DB (+ SPACETIME_TOKEN if reducers check identity)
   npm test            # mocked tests (Grok path, ElevenLabs path, failover), no keys needed
   npm start           # http://localhost:8080   (npm run dev = auto-restart on edits)
   ```
   `http://localhost:8080/health` shows which keys are loaded and any live calls.
3. Expose it to Twilio (Twilio can't reach localhost):
   ```powershell
   ngrok http 8080
   ```
4. In the Twilio console, set your number's **A call comes in** webhook to
   `https://YOUR-NGROK-HOST/twilio/voice?userId=USER_ID` (HTTP POST). The server answers with TwiML that streams the call to `/media-stream`.
5. Publish the SpacetimeDB module: put `spacetime-module/lib.rs` into your module's `src/lib.rs`, then
   `spacetime publish --server maincloud <SPACETIME_DB>`.

Watch the terminal on a test call: `grok connected`, `#N [grok] transcript: ...`, `risk NN (grok-voice) [...]`.
To rehearse the failover, set `XAI_REALTIME_URL=ws://localhost:1` and you'll see `failing over to elevenlabs`.

## Files
- `src/server.js` — HTTP routes (`/twilio/voice`, `/health`) + the `/media-stream` websocket
- `src/callSession.js` — one per call: picks the engine, does failover, writes to SpacetimeDB in order
- `src/engines/grok.js` — Grok Voice realtime (prompt is `INSTRUCTIONS` at the top)
- `src/engines/elevenlabs.js` — ElevenLabs Scribe, batched every `CHUNK_SECONDS`
- `src/risk.js` — shared risk schema/scoring guide, Grok text scorer, keyword heuristic
- `src/elevenlabs.js`, `src/audio.js`, `src/spacetime.js` — API clients and mu-law → WAV helpers
- `spacetime-module/lib.rs` — tables + reducers
