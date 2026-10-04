// Spoken warnings on the live call: ElevenLabs TTS → Twilio Media Stream (μ-law 8 kHz).
// Grok Voice audio is never used here — it stays STT + risk only.
import WebSocket from 'ws';
import { synthesizeSpeech } from './elevenlabs.js';

export function ttsEnabled() {
  return process.env.TTS !== 'false' && !!process.env.ELEVENLABS_API_KEY;
}

export function shouldSpeak(risk, lastSpokenWarning) {
  if (!risk?.warning) return false;
  if (risk.warning === lastSpokenWarning) return false;
  return risk.action === 'warn' || risk.action === 'hold_transfers';
}

export function twilioMediaMessage(streamSid, mulaw) {
  return {
    event: 'media',
    streamSid,
    media: { payload: Buffer.from(mulaw).toString('base64') },
  };
}

export async function playWarning({ text, streamSid, twilioWs, log }) {
  const mulaw = await synthesizeSpeech(text);
  if (!mulaw.length) throw new Error('empty TTS audio');
  if (!streamSid || twilioWs.readyState !== WebSocket.OPEN) throw new Error('twilio stream not open');
  twilioWs.send(JSON.stringify(twilioMediaMessage(streamSid, mulaw)));
  log?.(`tts played: ${text}`);
}
