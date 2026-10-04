# Grok STT + Gemini risk score (bridge)

Date: 2026-10-03
Branch: `backendcombotest`
Status: approved in conversation; awaiting spec review

## Goal

On `scamshield-bridge` only: Grok Voice transcribes the live Twilio audio stream. On each transcript flush, Gemini scores the full call so far (0–100). That score is written to SpacetimeDB. `request_transfer` remains the money gate. ElevenLabs TTS still speaks a one-time in-call warning at high risk. No STT failover, no scoring fallbacks.

## Current state (what we are changing)

Today the bridge streams Twilio µ-law to Grok Voice, which both transcribes and scores via a `report_risk` tool. If Grok dies, the call fails over to ElevenLabs Scribe; Grok text or a keyword heuristic then scores. ElevenLabs TTS already injects a warning when `risk >= TTS_WARNING_SCORE`.

SpacetimeDB already has `append_transcript_segment`, `record_risk_event` (updates `call_sessions.risk_score`), and `request_transfer` (holds if the user has an active session and score ≥ threshold, default 70).

## Pipeline

```
Twilio µ-law  →  bridge  →  Grok Voice (STT only)
                              │
                              │ flush: VAD completed, or text idle 1.5s
                              ▼
                       append_transcript_segment  →  SpacetimeDB
                              │
                              │ full transcript so far + previous score
                              ▼
                       Gemini (system prompt, JSON 0–100)
                              │
                              ▼
                       record_risk_event  →  call_sessions.risk_score
                              │
                  ┌───────────┴────────────┐
                  ▼                        ▼
       risk ≥ TTS_WARNING_SCORE    request_transfer
       ElevenLabs speaks once      Held if active call
                                   and score ≥ threshold
```

Rules:

- Bytes go only to Grok. Gemini sees text only, and only on flush.
- No 10s timer. No Gemini call if nothing new was transcribed.
- Grok does not score. ElevenLabs Scribe and all failover are removed.
- The Nessie app only subscribes and displays. It does not decide holds.

## Components

Scope: `scamshield-bridge/` plus root `.env.example` and the short README/docs lines that describe the old Grok-scores / ElevenLabs-STT path. Do not change `server/`, `Twilio/`, `spacetimedb/`, or `worker/`.

| Piece | Change |
|---|---|
| `engines/grok.js` | Keep byte streaming (`audio/pcmu` + `input_audio_buffer.append`) and transcript flush (`completed` or 1.5s idle). Remove `report_risk` tool, scoring instructions, and `onRisk`. |
| `callSession.js` | On flush: write transcript, then queue Gemini with the full transcript so far + last score. On Gemini success: `record_risk_event` + maybe TTS. Remove failover, `STT_ENGINE`, and ElevenLabs STT. If Grok dies: log error, stop transcribing that call. |
| New `src/gemini.js` | `fetch` to Gemini `generateContent` (no new SDK). System prompt = existing `SCORING_GUIDE`; user = previous score + joined transcript lines; JSON response matching `RISK_SCHEMA`. `normalizeRisk` on the way out. Timeouts and non-2xx are errors (no retry-as-success). CallSession already serializes scores on `scoreQueue` so overlapping flushes stay in order. |
| `risk.js` | Keep `SIGNALS`, `ACTIONS`, `SCORING_GUIDE`, `RISK_SCHEMA`, `normalizeRisk`. Delete `scoreTranscript`, Grok text scoring, and `heuristicScore`. |
| Delete | `src/engines/elevenlabs.js`, `src/elevenlabs.js` (Scribe), `test/elevenlabs.mjs`, `test/failover.mjs`. Delete `src/audio.js` if nothing remaining imports it (TTS has its own path). |
| Keep | `tts.js`, `integration.js`, `spacetime.js`, all Spacetime tables and reducers. |

Gemini call shape:

- **System:** existing scoring guide (0–20 normal … 81–100 active fraud). Scores should rarely go down.
- **User:** previous score + full transcript lines joined with newlines.
- **Out:** `{ score, signals, action, warning, evidence }` — same shape `record_risk_event` already consumes.

Model is pinned with `GEMINI_MODEL` (default `gemini-2.5-flash`) so it can be swapped without a code change.

## Error handling (fail loud)

No engine switch, no guessed score, no “success” if an API did not succeed.

**At process start.** Refuse to listen if `XAI_API_KEY`, `GEMINI_API_KEY`, or `ELEVENLABS_API_KEY` is missing. Print which one. (Tests set the keys themselves and do not boot `server.js`.)

**During a call.**

| API | If it is down / errors |
|---|---|
| Grok Voice | No ElevenLabs STT. Log the error. That call stops transcribing (no further text, no further Gemini). |
| Gemini | No heuristic, no Grok text score. Log the error. Do **not** write `record_risk_event`. Last score stays as-is. The transcript flush that triggered the call is still stored. |
| ElevenLabs TTS | Log the error. No spoken warning. Existing score / holds unchanged. |
| SpacetimeDB | Log the reducer error. Do not invent local success. |

Gemini or TTS failure does not crash the Node process or hang up Twilio. A missing key at boot does refuse to start.

## Config

Root `.env.example` (bridge reads repo-root `.env`):

- Add `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-2.5-flash`.
- Remove bridge STT/failover knobs: `STT_ENGINE`, `FAILOVER`, `ELEVENLABS_SCRIBE_MODEL`, `CHUNK_SECONDS`, `SILENCE_RMS`, and the Grok-text scoring comment on `XAI_CHAT_MODEL` as a bridge concern. Leave `server/`-only vars as they are (`XAI_STT_MODEL`, `ELEVENLABS_STT_MODEL`, `STT_FAILOVER_MS`, `RISK_MIN_CHARS`).
- Keep `ELEVENLABS_API_KEY` (TTS), `TTS_WARNING`, `TTS_WARNING_SCORE`, `ELEVENLABS_TTS_*`, `SCAM_WARNING_TEXT`.
- Keep `XAI_API_KEY` / `XAI_MODEL` for Grok Voice STT.

`GET /health` should report Gemini configured (boolean), not `STT_ENGINE` / failover.

## Tests

Still mocked; no live keys. `npm run bridge:test` must pass.

- **Grok path:** audio in → transcript flush → `append_transcript_segment`. No `report_risk`.
- **Gemini path:** flushed transcript → Gemini mock → `record_risk_event` with a 0–100 score.
- **TTS:** spoken once when score ≥ `TTS_WARNING_SCORE`.
- **Fail-loud:** Gemini HTTP error logs and writes no risk row; Grok down does not start ElevenLabs.

Delete `test/elevenlabs.mjs` and `test/failover.mjs`. Update `package.json` `test` script accordingly. Keep `test/tts.mjs` as the optional live TTS check.

## Out of scope

- `server/` and `Twilio/` (do not delete; do not update to Gemini).
- Spacetime schema / `request_transfer` behavior.
- Nessie worker and the bank/phone frontends.
- Neon, Fetch.ai, or any new tables.

## Success

A merged test call: Grok text appears in SpacetimeDB as the parties speak; Gemini scores arrive on each flush and move `call_sessions.risk_score`; a transfer during a high-score call is `Held`; at ≥ 85 the ElevenLabs warning plays once; killing Gemini or omitting its key never produces a heuristic/Grok score.
