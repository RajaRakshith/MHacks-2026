# Merge TTS into scamshield-bridge

The full bridge lives on **`LocalServer`** (or your `twilio` branch). This
`elevenlabs` branch adds TTS only. When you merge:

## 1. Keep these files from `elevenlabs`

```
scamshield-bridge/src/tts.js
scamshield-bridge/src/integration.js
scamshield-bridge/test/tts.mjs
```

## 2. Patch `CallSession` (from the bridge branch)

Add to the constructor:

```javascript
import { playScamWarning, onScamDetected } from './integration.js';

// in constructor:
this.twilioWs = twilioWs;
this.streamSid = null;
this.scamWarningPlayed = false;
```

On Twilio `start` event:

```javascript
this.streamSid = msg.start.streamSid;
```

Expose methods (or delegate to integration):

```javascript
async playScamWarning(opts) {
  return playScamWarning(this, opts);
}

async onScamDetected(details) {
  return onScamDetected(this, details);
}
```

## 3. Wire call-score later

When your scam detector fires, call:

```javascript
await session.onScamDetected({ score, signals });
```

That plays: *"This is a scam call, please hang up."*

## 4. Optional dev endpoint

Add to `server.js` for manual testing during a live call:

```javascript
// POST /calls/:callSid/warn
const session = activeSessions.get(callSid);
await session.playScamWarning();
```

## 5. Environment

Merge TTS vars from `.env.example` into the bridge's `.env`:

```
ELEVENLABS_API_KEY=
ELEVENLABS_TTS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
SCAM_WARNING_TEXT=This is a scam call, please hang up.
```
