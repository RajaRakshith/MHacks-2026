import { mockHttp, fakeTwilioCall, startBridge, wait, check } from './mocks.mjs';

const http = mockHttp(9601);
Object.assign(process.env, {
  XAI_REALTIME_URL: 'ws://localhost:9699',
  XAI_API_KEY: 'k',
  GROK_CONNECT_TIMEOUT_MS: '300',
  GEMINI_API_KEY: 'gk', GEMINI_BASE_URL: 'http://localhost:9601',
  ELEVENLABS_API_KEY: 'x', ELEVENLABS_BASE_URL: 'http://localhost:9601',
  SPACETIME_URI: 'ws://localhost:9601', SPACETIME_DATABASE: 'db', TTS_WARNING: 'false',
});

const call = await fakeTwilioCall(await startBridge(9602), { seconds: 1, callSid: 'CA-GD' });
await wait(500);
call.hangup();
await wait(400);

const names = http.calls.map((c) => c[0]);
check('no ElevenLabs STT', !names.includes('stt'), names);
check('no Gemini score without transcript', !names.includes('gemini') && !names.includes('record_risk_event'), names);
check('no Grok text chat fallback', !names.includes('chat'), names);
check('call still starts and ends',
  names[0] === 'start_call_session' && names.at(-1) === 'end_call_session', names);
process.exit();
