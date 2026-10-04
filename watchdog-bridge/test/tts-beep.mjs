import { mockHttp, check } from './mocks.mjs';
import { alertBeepMulaw, synthesizeScamWarning } from '../src/tts.js';

const SAMPLE_RATE = 8000;
const ON_MS = 100;
const OFF_MS = 70;
const COUNT = 3;
const expectedBytes = COUNT * Math.round(SAMPLE_RATE * ON_MS / 1000)
  + (COUNT - 1) * Math.round(SAMPLE_RATE * OFF_MS / 1000);

const beep = alertBeepMulaw();
check('alert beep is µ-law @ 8 kHz for 3 on/off tones', beep.length === expectedBytes, {
  got: beep.length, expected: expectedBytes,
});
check('alert beep is not silence', beep.some((b) => b !== 0xff), beep.slice(0, 8));

const http = mockHttp(9801);
Object.assign(process.env, {
  ELEVENLABS_API_KEY: 'x',
  ELEVENLABS_BASE_URL: 'http://localhost:9801',
});
const out = await synthesizeScamWarning();
const speech = Buffer.alloc(800, 0x7f);
check('warning audio starts with the generated beeps',
  out.subarray(0, beep.length).equals(beep), out.length);
check('ElevenLabs speech is appended after the beeps',
  out.subarray(beep.length).equals(speech), out.length - beep.length);

const tts = http.calls.find((c) => c[0] === 'tts');
const body = tts?.[2];
check('asks ElevenLabs for the Watchdog line',
  typeof body === 'string' && body.includes('This is Watchdog, protecting your calls'), body);
check('voice settings are urgent', (() => {
  if (!body) return false;
  const j = JSON.parse(body);
  return j.voice_settings?.stability < 0.5 && j.voice_settings?.style > 0;
})(), body);

http.close();
