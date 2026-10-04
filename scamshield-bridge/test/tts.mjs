// Grok Voice does STT + risk. When risk is warn/hold_transfers, ElevenLabs TTS
// speaks the warning back onto the Twilio Media Stream. Grok's own audio is discarded.
import { mockHttp, mockGrok, fakeTwilioCall, startBridge, wait, check } from './mocks.mjs';
import { shouldSpeak } from '../src/tts.js';

check('speak warn / hold_transfers once per warning text',
  shouldSpeak({ action: 'hold_transfers', warning: 'DO NOT SHARE THE CODE' }, '')
  && shouldSpeak({ action: 'warn', warning: 'Hang up' }, '')
  && !shouldSpeak({ action: 'hold_transfers', warning: 'DO NOT SHARE THE CODE' }, 'DO NOT SHARE THE CODE')
  && !shouldSpeak({ action: 'monitor', warning: 'hmm' }, '')
  && !shouldSpeak({ action: 'hold_transfers', warning: '' }, ''));

const http = mockHttp(9401);
const grok = mockGrok(9402, (ws, ev, got) => {
  if (ev.type === 'input_audio_buffer.append' && got.filter((x) => x === ev.type).length === 3) {
    ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1',
      transcript: 'This is the fraud department, read me the code.' }));
    ws.send(JSON.stringify({ type: 'response.output_audio.delta', delta: 'GROKAUDIO' }));
    const risk = { score: 94, signals: ['impersonation', 'otp_request'], action: 'hold_transfers',
      warning: 'DO NOT SHARE THE CODE', evidence: 'read me the code' };
    ws.send(JSON.stringify({ type: 'response.function_call_arguments.done', name: 'report_risk', call_id: 'c1',
      arguments: JSON.stringify(risk) }));
    // Same warning again — must not fire a second TTS request.
    ws.send(JSON.stringify({ type: 'response.function_call_arguments.done', name: 'report_risk', call_id: 'c2',
      arguments: JSON.stringify(risk) }));
  }
});
Object.assign(process.env, { XAI_REALTIME_URL: 'ws://localhost:9402', XAI_API_KEY: 'k', ELEVENLABS_API_KEY: 'x',
  ELEVENLABS_BASE_URL: 'http://localhost:9401', XAI_BASE_URL: 'http://localhost:9401',
  SPACETIME_HOST: 'http://localhost:9401', SPACETIME_DB: 'db', TTS: 'true',
  ELEVENLABS_VOICE_ID: 'voice1', ELEVENLABS_TTS_MODEL: 'eleven_flash_v2_5' });

const call = await fakeTwilioCall(await startBridge(9403), { seconds: 1, callSid: 'CA-TTS' });
await wait(600);
call.hangup();
await wait(400);

const tts = http.calls.filter((c) => c[0] === 'tts');
const media = call.back.map((raw) => { try { return JSON.parse(raw); } catch { return {}; } })
  .filter((m) => m.event === 'media');
check('one ElevenLabs TTS request with the warning',
  tts.length === 1 && tts[0][1] === 'DO NOT SHARE THE CODE', tts);
check('TTS hits configured voice + ulaw_8000',
  tts[0]?.[2]?.includes('/v1/text-to-speech/voice1') && tts[0][2].includes('output_format=ulaw_8000'), tts[0]);
check('Twilio received ElevenLabs μ-law, not Grok audio',
  media.length >= 1 && media[0].streamSid === 'MZ1'
  && media.every((m) => m.media.payload === Buffer.from('ELTTS').toString('base64'))
  && !call.back.some((m) => m.includes('GROKAUDIO')), media);
check('no ElevenLabs STT on the Grok path', !http.calls.some((c) => c[0] === 'stt'), http.calls.map((c) => c[0]));
process.exit();
