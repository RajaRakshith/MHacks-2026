// ElevenLabs TTS → µ-law 8 kHz for injection back into a Twilio Media Stream.
// Docs: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
// Alert beeps are generated here (same 8 kHz µ-law) and prepended — not spoken by the model.

const SAMPLE_RATE = 8000;
const BEEP_HZ = 880;
const BEEP_ON_MS = 100;
const BEEP_OFF_MS = 70;
const BEEP_COUNT = 3;
const BEEP_AMPLITUDE = 22000;

const DEFAULT_WARNING =
  process.env.SCAM_WARNING_TEXT ||
  'This is ScamShield, protecting your calls. This is a scam. Hang up now.';

function pcm16ToMulaw(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

function toneMulaw(hz, ms) {
  const n = Math.round(SAMPLE_RATE * (ms / 1000));
  const buf = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const pcm = Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * BEEP_AMPLITUDE);
    buf[i] = pcm16ToMulaw(pcm);
  }
  return buf;
}

function silenceMulaw(ms) {
  return Buffer.alloc(Math.round(SAMPLE_RATE * (ms / 1000)), 0xff);
}

/** Three short 880 Hz tones in Twilio-native µ-law @ 8 kHz. */
export function alertBeepMulaw() {
  const parts = [];
  for (let i = 0; i < BEEP_COUNT; i++) {
    parts.push(toneMulaw(BEEP_HZ, BEEP_ON_MS));
    if (i < BEEP_COUNT - 1) parts.push(silenceMulaw(BEEP_OFF_MS));
  }
  return Buffer.concat(parts);
}

/** Synthesize the scam warning as raw µ-law @ 8 kHz (Twilio-native). */
export async function synthesizeScamWarning(text = DEFAULT_WARNING) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

  const voiceId =
    process.env.ELEVENLABS_TTS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const base =
    process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';
  const url = `${base}/v1/text-to-speech/${voiceId}?output_format=ulaw_8000`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/basic',
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.75,
        style: 0.45,
        use_speaker_boost: true,
        speed: 1.08,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
  }

  return Buffer.concat([alertBeepMulaw(), Buffer.from(await res.arrayBuffer())]);
}

/**
 * Stream µ-law audio into an active Twilio bidirectional Media Stream.
 * Chunks are paced at ~20 ms to match real-time telephony.
 */
export async function playMulawOnTwilioStream(twilioWs, streamSid, mulawBuffer) {
  if (twilioWs.readyState !== 1 /* OPEN */) {
    throw new Error('Twilio WebSocket is not open');
  }

  const chunkBytes = Number(process.env.TTS_CHUNK_BYTES || 160); // 20 ms @ 8 kHz µ-law
  const paceMs = Number(process.env.TTS_PACE_MS || 20);

  for (let i = 0; i < mulawBuffer.length; i += chunkBytes) {
    const slice = mulawBuffer.subarray(
      i,
      Math.min(i + chunkBytes, mulawBuffer.length)
    );
    twilioWs.send(
      JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: slice.toString('base64') },
      })
    );
    if (i + chunkBytes < mulawBuffer.length) {
      await new Promise((r) => setTimeout(r, paceMs));
    }
  }
}

/** Full pipeline: synthesize warning + play into the live call. */
export async function playScamWarningOnCall(twilioWs, streamSid, text) {
  const audio = await synthesizeScamWarning(text);
  await playMulawOnTwilioStream(twilioWs, streamSid, audio);
}
