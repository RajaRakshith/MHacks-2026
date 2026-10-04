// Happy path: Twilio -> Grok Voice (mocked) -> SpacetimeDB (mocked). No audio goes back to Twilio.
import { mockHttp, mockGrok, fakeTwilioCall, startBridge, wait, check } from './mocks.mjs';

const http = mockHttp(9101);
const grok = mockGrok(9102, (ws, ev, got) => {
  if (ev.type === 'input_audio_buffer.append' && got.filter((x) => x === ev.type).length === 3) {
    ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.updated', item_id: 'i1', transcript: 'This is the fraud' }));
    ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'This is the fraud department, read me the code.' }));
    ws.send(JSON.stringify({ type: 'response.output_audio.delta', delta: 'AAAA' }));
    ws.send(JSON.stringify({ type: 'response.function_call_arguments.done', name: 'report_risk', call_id: 'c1',
      arguments: JSON.stringify({ score: 94, signals: ['impersonation', 'otp_request'], action: 'hold_transfers', warning: 'DO NOT SHARE THE CODE', evidence: 'read me the code' }) }));
  }
});
Object.assign(process.env, { XAI_REALTIME_URL: 'ws://localhost:9102', XAI_API_KEY: 'k', ELEVENLABS_API_KEY: 'x',
  ELEVENLABS_BASE_URL: 'http://localhost:9101', XAI_BASE_URL: 'http://localhost:9101',
  SPACETIME_HOST: 'http://localhost:9101', SPACETIME_DB: 'db' });

const call = await fakeTwilioCall(await startBridge(9103), { seconds: 1, callSid: 'CA9' });
await wait(500);
call.hangup();
await wait(400);

const names = http.calls.map((c) => c[0]);
const risk = http.calls.find((c) => c[0] === 'update_risk')?.[1];
check('grok got auth + session.update + audio',
  grok.got.includes('auth=Bearer k') && grok.got.includes('session.update') && grok.got.includes('input_audio_buffer.append'), grok.got);
check('reducers in order start -> transcript -> risk -> end', names.join() === 'start_call,append_transcript,update_risk,end_call', http.calls);
check('final transcript written once', http.calls.find((c) => c[0] === 'append_transcript')?.[1][4] === 'This is the fraud department, read me the code.', http.calls);
check('risk 94 hold_transfers', risk?.[0] === 'CA9' && risk[1] === 94 && risk[3] === 'hold_transfers', risk);
check('no elevenlabs / chat used', !names.includes('stt') && !names.includes('chat'), names);
check('no audio sent back to twilio', call.back.length === 0, call.back);
process.exit();
