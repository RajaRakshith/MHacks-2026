// STT_ENGINE=elevenlabs forced: batches audio, skips silence, scores each chunk with Grok text.
import { mockHttp, fakeTwilioCall, startBridge, wait, check } from './mocks.mjs';

const http = mockHttp(9301);
Object.assign(process.env, { STT_ENGINE: 'elevenlabs', XAI_API_KEY: 'k', ELEVENLABS_API_KEY: 'x',
  ELEVENLABS_BASE_URL: 'http://localhost:9301', XAI_BASE_URL: 'http://localhost:9301',
  SPACETIME_HOST: 'http://localhost:9301', SPACETIME_DB: 'db', CHUNK_SECONDS: '2' });
const call = await fakeTwilioCall(await startBridge(9302), { seconds: 5, callSid: 'CA5' });
const silence = Buffer.alloc(160, 0xff).toString('base64'); // 0xFF = 0 in mu-law
for (let i = 0; i < 100; i++) call.ws.send(JSON.stringify({ event: 'media', media: { track: 'inbound', payload: silence } }));
await wait(200);
call.hangup();
await wait(500);

const names = http.calls.map((c) => c[0]);
const chunks = http.calls.filter((c) => c[0] === 'append_transcript').map((c) => c[1].slice(1, 4));
check('3 loud chunks transcribed, silence skipped', names.filter((n) => n === 'stt').length === 3, names);
check('each chunk scored', names.filter((n) => n === 'update_risk').length === 3, names);
check('transcript seq + timings', JSON.stringify(chunks) === '[[0,0,2000],[1,2000,4000],[2,4000,6000]]', chunks);
check('start first, end last', names[0] === 'start_call' && names.at(-1) === 'end_call', names);
process.exit();
