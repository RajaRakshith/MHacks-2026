import { mockHttp, mockGrok, fakeTwilioCall, startBridge, wait, check } from './mocks.mjs';

const http = mockHttp(9501, { geminiScore: null });
mockGrok(9502, (ws, ev, got) => {
  if (ev.type === 'input_audio_buffer.append' && got.filter((x) => x === ev.type).length === 3) {
    ws.send(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'i1',
      transcript: 'Please read me the verification code.',
    }));
  }
});
Object.assign(process.env, {
  XAI_REALTIME_URL: 'ws://localhost:9502', XAI_API_KEY: 'k',
  GEMINI_API_KEY: 'gk', GEMINI_BASE_URL: 'http://localhost:9501',
  ELEVENLABS_API_KEY: 'x', ELEVENLABS_BASE_URL: 'http://localhost:9501',
  SPACETIME_URI: 'ws://localhost:9501', SPACETIME_DATABASE: 'db', TTS_WARNING: 'false',
});

const call = await fakeTwilioCall(await startBridge(9503), { seconds: 1, callSid: 'CA-GF' });
await wait(500);
call.hangup();
await wait(400);

const names = http.calls.map((c) => c[0]);
check('transcript still stored',
  names.includes('append_transcript_segment'), names);
check('Gemini was attempted', names.includes('gemini'), names);
check('no record_risk_event on Gemini 503',
  !names.includes('record_risk_event'), names);
check('no heuristic/chat fallback',
  !names.includes('chat') && !names.includes('stt'), names);
check('session ended', names.at(-1) === 'end_call_session', names);
process.exit();
