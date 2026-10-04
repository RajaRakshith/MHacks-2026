// ElevenLabs TTS → µ-law 8 kHz for injection back into a Twilio Media Stream.
// Docs: https://elevenlabs.io/docs/api-reference/text-to-speech/convert

const DEFAULT_WARNING =
  process.env.SCAM_WARNING_TEXT || 'This is a scam call, please hang up.';

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
    }),
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
  }

  return Buffer.from(await res.arrayBuffer());
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
