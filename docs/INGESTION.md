# Call Ingestion Server

> **The demo call server is [`scamshield-bridge/`](../scamshield-bridge/README.md)** (`npm run bridge:dev`). It calls the same
> reducers listed below. This page documents `server/`, an alternative TypeScript implementation that uses realtime STT sockets
> and the SpacetimeDB SDK. Run only one of them: both listen on port 8080 and serve `/twilio/voice`.

Twilio Media Streams → redundant STT (Grok primary, ElevenLabs backup) → Grok risk scoring → SpacetimeDB.

## Architecture

```
Twilio call
    │  µ-law 8kHz (base64 over WS)
    ▼
server/twilio/media-stream-handler
    │
    ├─► Grok STT (primary)     wss://api.x.ai/v1/stt?encoding=mulaw&sample_rate=8000
    └─► ElevenLabs (backup)    wss://api.elevenlabs.io/v1/speech-to-text/realtime
              │ failover if Grok errors/idle > STT_FAILOVER_MS
              ▼
         final transcript utterance
              │
              ├─► append_transcript_segment  (live UI)
              └─► Grok chat (risk JSON) → record_risk_event  (risk meter + timeline)
```

## Setup

1. Publish SpacetimeDB module and generate bindings:
   ```bash
   spacetime start
   npm run spacetime:publish:local
   npm run spacetime:generate
   ```

2. Copy `.env.example` → `.env` and fill keys.

3. Expose the server (Twilio needs a public URL):
   ```bash
   ngrok http 8080
   # set PUBLIC_URL to the ngrok https URL
   ```

4. Run the ingestion server:
   ```bash
   npm run server:dev
   ```

5. Point your Twilio number voice webhook to:
   ```
   POST {PUBLIC_URL}/twilio/voice?userId=demo-user
   ```

## Twilio TwiML

The `/twilio/voice` endpoint returns:

```xml
<Connect>
  <Stream url="wss://.../twilio/media-stream">
    <Parameter name="userId" value="demo-user" />
  </Stream>
</Connect>
```

Pass `userId` as a query param on the webhook URL to tie the call to a SpacetimeDB user.

## SpacetimeDB reducers used

| Reducer | When |
|---------|------|
| `start_call_session` | Twilio `start` event |
| `append_transcript_segment` | Every STT partial/final |
| `record_risk_event` | After each speech-final utterance (Grok risk) |
| `end_call_session` | Twilio `stop` / WS close |

## Failover behavior

- **Primary:** Grok Voice STT (native µ-law — no transcoding)
- **Backup:** ElevenLabs Scribe v2 Realtime (µ-law → PCM16 16kHz)
- Failover triggers on Grok WebSocket error/close, or no Grok activity for `STT_FAILOVER_MS` (default 5s)
