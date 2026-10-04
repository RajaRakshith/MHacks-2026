# Twilio Media Streams POC (inbound)

Proves Twilio can call your server and push live call audio over a WebSocket before ElevenLabs STT.

**Architecture:** see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## How to start the server

**Prerequisites:** Node.js 20+, [ngrok](https://ngrok.com/) (or another HTTPS/WSS tunnel).

### 1. One-time setup

```bash
cd Twilio
npm install
cp .env.example .env
```

### 2. Start ngrok (terminal 1)

```bash
ngrok http 3000
```

Copy the **Forwarding** HTTPS URL, e.g. `https://abc123.ngrok-free.app` (no trailing slash).

### 3. Configure `.env` (terminal 2)

Edit `.env`:

```env
PORT=3000
PUBLIC_BASE_URL=https://abc123.ngrok-free.app
```

Use the same URL ngrok shows. Restart the server whenever you change this (ngrok free URLs change each session unless you use a fixed domain).

### 4. Start the app

```bash
npm run dev
```

You should see:

```text
Watchdog Twilio POC listening on http://localhost:3000
  POST /voice   — Twilio voice webhook (TwiML + Media Stream)
  WS   /stream  — Twilio Media Streams
  GET  /health  — liveness
```

**Production-style run** (no file watch): `npm start`.

### 5. Quick local check (optional)

```bash
curl -s http://localhost:3000/health
```

---

## What to configure in Twilio (exactly)

Console path: **Phone Numbers → Manage → Active numbers → (906) 767-6720 → Configure**.

Under **Voice configuration**:

| Setting | What to choose | Value |
|---------|----------------|--------|
| **Configure with** | Webhook | (default) |
| **A call comes in** | Webhook | |
| URL | | `https://<your-ngrok-host>/voice` |
| HTTP method | | **HTTP POST** |
| **Primary handler fails** | Leave empty | (optional fallback later) |
| **Call status changes** | Leave empty | not needed for POC |
| **Caller Name Lookup** | Disabled | fine |

Click **Save configuration** at the bottom.

**Do not change** for this POC:

- Messaging configuration (SMS webhooks)
- TwiML Apps (not used — webhook is on the number itself)
- Emergency calling / A2P 10DLC (messaging compliance only)

**Credentials:** You do **not** enter Account SID or Auth Token on this screen. Twilio calls *your* URL; no API keys in the console for inbound voice webhook.

Replace `https://demo.twilio.com/welcome/voice/` with your ngrok URL + `/voice` whenever ngrok restarts.

---

## Test the call

1. Server running (`npm run dev`).
2. ngrok running and `PUBLIC_BASE_URL` matches ngrok.
3. Twilio voice webhook saved with the same ngrok host + `/voice`.
4. Call **(906) 767-6720** from your phone.
5. Watch the server terminal:

| Log line | Meaning |
|----------|---------|
| `[voice] incoming call` | Webhook hit |
| `[stream] websocket connected` | WSS up |
| `[stream] start` | Stream metadata |
| `[stream] media` (periodic) | Audio flowing — speak to see `frames` / `totalBytes` grow |
| `[stream] stop` | Hang up |

---

## Call recordings

By default each call is saved under **`Twilio/recordings/`** as raw **μ-law 8 kHz** (`.ulaw`), one file per audio track (`inbound` = your voice toward Twilio, `outbound` if present).

When the call ends, the terminal logs `[stream] stop` with `recordings: [{ track, path }]`.

**Play back** (requires [ffmpeg/ffplay](https://ffmpeg.org/)):

```bash
ffplay -f mulaw -ar 8000 -ac 1 recordings/YOUR_FILE_inbound_....ulaw
```

**Convert to WAV:**

```bash
ffmpeg -f mulaw -ar 8000 -ac 1 -i recordings/YOUR_FILE.ulaw recordings/out.wav
```

Disable saving: `RECORD_CALLS=false` in `.env`.

---

## Success checklist

- [ ] `[voice] incoming call` when you dial
- [ ] `[stream] websocket connected` and `[stream] start`
- [ ] `[stream] media` with increasing `frames` / `totalBytes` while you speak
- [ ] `[stream] stop` when you hang up

---

## Next steps (not in this POC)

- Decode μ-law → PCM for ElevenLabs realtime STT
- Conference / merge (second leg) once single-leg streaming is stable
