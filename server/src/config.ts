export const config = {
  port: Number(process.env.PORT ?? 8080),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8080}`,

  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',

  xaiApiKey: process.env.XAI_API_KEY ?? '',
  xaiSttModel: process.env.XAI_STT_MODEL ?? 'grok-voice-transcribe-2.0',
  xaiChatModel: process.env.XAI_CHAT_MODEL ?? 'grok-2-1212',

  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? '',
  elevenLabsSttModel: process.env.ELEVENLABS_STT_MODEL ?? 'scribe_v2_realtime',

  spacetimeUri: process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000',
  spacetimeDatabase: process.env.SPACETIME_DATABASE ?? 'scamshield-dev',
  spacetimeToken: process.env.SPACETIME_TOKEN,

  /** Fail over to ElevenLabs if Grok is silent/errors for this long (ms). */
  sttFailoverMs: Number(process.env.STT_FAILOVER_MS ?? 5000),
  /** Minimum chars in a final utterance before running risk scoring. */
  riskMinChars: Number(process.env.RISK_MIN_CHARS ?? 12),
} as const;

export function requireKeys() {
  const missing: string[] = [];
  if (!config.xaiApiKey) missing.push('XAI_API_KEY');
  if (!config.elevenLabsApiKey) missing.push('ELEVENLABS_API_KEY');
  if (missing.length) {
    console.warn(`[config] Missing optional keys: ${missing.join(', ')}`);
  }
}
