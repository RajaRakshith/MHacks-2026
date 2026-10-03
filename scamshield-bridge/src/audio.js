// Twilio Media Streams send 8kHz, mono, 8-bit mu-law audio (base64, ~20ms per frame).
// ElevenLabs wants a normal audio file, so we decode to 16-bit PCM and wrap it in a WAV header.

const MULAW_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  MULAW_TABLE[i] = sign ? -sample : sample;
}

export const SAMPLE_RATE = 8000; // mu-law bytes per second == samples per second

export function mulawToPcm16(mulaw) {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) pcm.writeInt16LE(MULAW_TABLE[mulaw[i]], i * 2);
  return pcm;
}

export function pcm16ToWav(pcm, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);            // fmt chunk size
  header.writeUInt16LE(1, 20);             // PCM
  header.writeUInt16LE(1, 22);             // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);             // block align
  header.writeUInt16LE(16, 34);            // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Root-mean-square loudness of PCM16 audio, 0..32768. Used to skip silent chunks.
export function rms(pcm) {
  let sum = 0;
  const n = pcm.length / 2;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2);
    sum += s * s;
  }
  return n ? Math.sqrt(sum / n) : 0;
}
