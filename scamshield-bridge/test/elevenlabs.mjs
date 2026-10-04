// STT_ENGINE=elevenlabs forced: batches audio, skips silence, scores each chunk with Grok text.
import { mockHttp, fakeTwilioCall, startBridge, wait, check } from './mocks.mjs';

const http = mockHttp(9301);
Object.assign(process.env, { STT_ENGINE: 'elevenlabs', XAI_API_KEY: 'k', ELEVENLABS_API_KEY: 'x',
  ELEVENLABS_BASE_URL: 'http://localhost:9301', XAI_BASE_URL: 'http://localhost:9301',
  SPACETIME_URI: 'ws://localhost:9301', SPACETIME_DATABASE: 'db', TTS_WARNING: 'false', CHUNK_SECONDS: '2' });
const call = await fakeTwilioCall(await startBridge(9302), { seconds: 5, callSid: 'CA5' });
const silence = Buffer.alloc(160, 0xff).toString('base64'); // 0xFF = 0 in mu-law
for (let i = 0; i < 100; i++) call.ws.send(JSON.stringify({ event: 'media', media: { track: 'inbound', payload: silence } }));
await wait(200);
call.hangup();
await wait(500);

const names = http.calls.map((c) => c[0]);
const segs = http.calls.filter((c) => c[0] === 'append_transcript_segment').map((c) => c[1]);
check('3 loud chunks transcribed, silence skipped', names.filter((n) => n === 'stt').length === 3, names);
check('each chunk scored', names.filter((n) => n === 'record_risk_event').length === 3, names);
check('3 transcript segments on session 100, source elevenlabs', segs.length === 3 && segs.every((a) => a[0] === 100 && a[2] === 'elevenlabs' && a[3] === true), segs);
check('start first, end last', names[0] === 'start_call_session' && names.at(-1) === 'end_call_session', names);
process.exit();
