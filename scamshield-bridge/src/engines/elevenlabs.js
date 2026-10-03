// Redundancy engine: buffer ~N seconds of call audio -> ElevenLabs Scribe (batch STT).
// It only transcribes; CallSession scores each new transcript via risk.scoreTranscript().

import { mulawToPcm16, pcm16ToWav, rms, SAMPLE_RATE } from '../audio.js';
import { transcribeWav } from '../elevenlabs.js';

const MIN_FLUSH_SECONDS = 1; // don't send tiny tail chunks

export function createElevenLabsEngine({ log, onTranscript, startOffsetMs = 0 }) {
  const chunkSeconds = Number(process.env.CHUNK_SECONDS || 12);
  const silenceRms = Number(process.env.SILENCE_RMS || 150);

  let frames = [];
  let bufferedBytes = 0;
  let totalBytes = 0; // audio-time clock (8000 bytes == 1s)
  let chunkStartMs = startOffsetMs;
  let queue = Promise.resolve(); // keeps chunks in order without blocking audio intake

  const clockMs = () => startOffsetMs + Math.round((totalBytes / SAMPLE_RATE) * 1000);

  function flush(final) {
    if (!bufferedBytes) return;
    const mulaw = Buffer.concat(frames);
    const startMs = chunkStartMs;
    const endMs = clockMs();
    frames = [];
    bufferedBytes = 0;
    chunkStartMs = endMs;

    if (mulaw.length < MIN_FLUSH_SECONDS * SAMPLE_RATE && !final) return;
    const pcm = mulawToPcm16(mulaw);
    if (rms(pcm) < silenceRms) { log(`chunk ${startMs}-${endMs}ms silent, skipped`); return; }

    queue = queue.then(async () => {
      const t0 = Date.now();
      try {
        const { text, speakerText } = await transcribeWav(pcm16ToWav(pcm));
        log(`elevenlabs ${startMs}-${endMs}ms STT ${Date.now() - t0}ms`);
        if (text) await onTranscript(text, { startMs, endMs, speakerText });
      } catch (err) {
        log(`elevenlabs chunk ${startMs}-${endMs}ms failed:`, err.message);
      }
    });
  }

  log('elevenlabs engine active');
  return {
    name: 'elevenlabs',
    pushAudio(payload) {
      const bytes = Buffer.from(payload, 'base64');
      frames.push(bytes);
      bufferedBytes += bytes.length;
      totalBytes += bytes.length;
      if (bufferedBytes >= chunkSeconds * SAMPLE_RATE) flush(false);
    },
    close() {
      flush(true);
      return queue;
    },
  };
}
