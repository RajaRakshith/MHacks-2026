// Call 1: Grok accepts the connection, then drops mid-call -> session fails over to ElevenLabs,
//         and ElevenLabs transcripts get risk-scored by Grok text.
// Call 2: Grok unreachable AND Grok text down -> ElevenLabs + heuristic still writes a risk.
import { mockHttp, mockGrok, fakeTwilioCall, startBridge, wait, check } from './mocks.mjs';

const http = mockHttp(9201);
mockGrok(9202, (ws, ev, got) => {
  if (ev.type === 'input_audio_buffer.append' && got.filter((x) => x === ev.type).length === 10) ws.terminate();
});
Object.assign(process.env, { XAI_REALTIME_URL: 'ws://localhost:9202', XAI_API_KEY: 'k', ELEVENLABS_API_KEY: 'x',
  ELEVENLABS_BASE_URL: 'http://localhost:9201', XAI_BASE_URL: 'http://localhost:9201',
  SPACETIME_URI: 'ws://localhost:9201', SPACETIME_DATABASE: 'db', TTS_WARNING: 'false', CHUNK_SECONDS: '2', GROK_CONNECT_TIMEOUT_MS: '500' });
const bridge = await startBridge(9203);

// --- call 1: grok drops mid-call
let call = await fakeTwilioCall(bridge, { seconds: 5, callSid: 'CA1', gapMs: 100 });
await wait(300);
call.hangup();
await wait(500);
let calls = http.calls.splice(0);
let names = calls.map((c) => c[0]);
check('grok drop -> elevenlabs transcribed a WAV', calls.find((c) => c[0] === 'stt')?.[1] === 'wav ok', names);
check('elevenlabs transcript -> grok text scoring', names.includes('chat'), names);
check('risk 88 from grok text written', calls.some((c) => c[0] === 'record_risk_event' && c[1][3] === 88), calls);
check('call 1 started first and ended last', names[0] === 'start_call_session' && names.at(-1) === 'end_call_session', names);

// --- call 2: grok unreachable, grok text down
const http2 = mockHttp(9204, { chatScore: null });
Object.assign(process.env, { XAI_REALTIME_URL: 'ws://localhost:9299', XAI_BASE_URL: 'http://localhost:9204',
  ELEVENLABS_BASE_URL: 'http://localhost:9204', SPACETIME_URI: 'ws://localhost:9204' });
call = await fakeTwilioCall(bridge, { seconds: 3, callSid: 'CA2' });
await wait(300);
call.hangup();
await wait(500);
calls = http2.calls;
names = calls.map((c) => c[0]);
const risk = calls.find((c) => c[0] === 'record_risk_event')?.[1];
check('grok unreachable -> elevenlabs transcribed', names.includes('stt'), names);
check('grok text down -> heuristic risk >= 50 with otp_request', risk && risk[3] >= 50 && risk[1] === 'otp_request', calls);
check('call 2 ended', names.at(-1) === 'end_call_session', names);
process.exit();
