import { mockHttp, mockGrok, fakeTwilioCall, startBridge, wait, check } from './mocks.mjs';

const http = mockHttp(9101, { geminiScore: 94 });
const grok = mockGrok(9102, (ws, ev, got) => {
  if (ev.type === 'input_audio_buffer.append' && got.filter((x) => x === ev.type).length === 3) {
    ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.updated', item_id: 'i1', transcript: 'This is the fraud' }));
    ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'This is the fraud department, read me the code.' }));
    ws.send(JSON.stringify({ type: 'response.output_audio.delta', delta: 'AAAA' }));
    ws.send(JSON.stringify({ type: 'response.function_call_arguments.done', name: 'report_risk', call_id: 'c1',
      arguments: JSON.stringify({ score: 11, signals: ['other'], action: 'none', warning: '', evidence: 'should be ignored' }) }));
  }
});
Object.assign(process.env, {
  XAI_REALTIME_URL: 'ws://localhost:9102', XAI_API_KEY: 'k',
  GEMINI_API_KEY: 'gk', GEMINI_BASE_URL: 'http://localhost:9101', GEMINI_MODEL: 'gemini-2.5-flash',
  ELEVENLABS_API_KEY: 'x', ELEVENLABS_BASE_URL: 'http://localhost:9101',
  SPACETIME_URI: 'ws://localhost:9101', SPACETIME_DATABASE: 'db', TTS_PACE_MS: '1',
});

const call = await fakeTwilioCall(await startBridge(9103), { seconds: 1, callSid: 'CA9' });
await wait(500);
call.hangup();
await wait(400);

const names = http.calls.map((c) => c[0]).filter((n) => n !== 'tts' && n !== 'gemini');
const arg = (name) => http.calls.find((c) => c[0] === name)?.[1];
check('grok got auth + session.update + audio',
  grok.got.includes('auth=Bearer k') && grok.got.includes('session.update') && grok.got.includes('input_audio_buffer.append'), grok.got);
check('session.update has no report_risk tool',
  !grok.got.some((x) => String(x).includes('report_risk')), grok.got);
check('reducers in order start -> sql id lookup -> transcript -> risk -> end',
  names.join() === 'start_call_session,sql,append_transcript_segment,record_risk_event,end_call_session', names);
check('transcript written once against session id 100',
  JSON.stringify(arg('append_transcript_segment')) === '[100,"This is the fraud department, read me the code.","grok",true]', arg('append_transcript_segment'));
check('Gemini called once with full transcript',
  http.calls.filter((c) => c[0] === 'gemini').length === 1
    && http.calls.find((c) => c[0] === 'gemini')[1].includes('This is the fraud department, read me the code.'),
  http.calls.filter((c) => c[0] === 'gemini'));
check('record_risk_event is Gemini 94, not Grok tool 11',
  JSON.stringify(arg('record_risk_event')) === '[100,"impersonation","read me the code",94,{"some":"DO NOT SHARE THE CODE"}]', arg('record_risk_event'));
const sent = call.back.map((m) => JSON.parse(m));
check('elevenlabs TTS warning spoken once (5 frames, streamSid set)',
  http.calls.filter((c) => c[0] === 'tts').length === 1 && sent.length === 5 && sent.every((m) => m.event === 'media' && m.streamSid === 'MZ1'), sent.length);
check("grok's own audio never sent to twilio", !sent.some((m) => m.media?.payload === 'AAAA'), sent);
process.exit();
