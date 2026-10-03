/** G.711 µ-law decode table (Twilio Media Streams → PCM16). */
const MULAW_DECODE = Int16Array.from({ length: 256 }, (_, i) => {
  const u = ~i & 0xff;
  const sign = u & 0x80 ? -1 : 1;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const magnitude = ((mantissa << 3) + 0x84) << exponent;
  return sign * (magnitude - 0x84);
});

export function mulawToPcm16(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    pcm.writeInt16LE(MULAW_DECODE[mulaw[i]!]!, i * 2);
  }
  return pcm;
}

/** Upsample 8 kHz PCM16 → 16 kHz via linear interpolation (good enough for backup STT). */
export function upsample8kTo16k(pcm8k: Buffer): Buffer {
  const samples = pcm8k.length / 2;
  const out = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    const s0 = pcm8k.readInt16LE(i * 2);
    const s1 = i + 1 < samples ? pcm8k.readInt16LE((i + 1) * 2) : s0;
    out.writeInt16LE(s0, i * 4);
    out.writeInt16LE(Math.round((s0 + s1) / 2), i * 4 + 2);
  }
  return out;
}

export function twilioMulawToPcm16k(mulaw: Buffer): Buffer {
  return upsample8kTo16k(mulawToPcm16(mulaw));
}
