import { mockHttp, check } from './mocks.mjs';
import { scoreWithGemini } from '../src/gemini.js';

const http = mockHttp(9401, { geminiScore: 94 });
Object.assign(process.env, {
  GEMINI_API_KEY: 'gk',
  GEMINI_MODEL: 'gemini-2.5-flash',
  GEMINI_BASE_URL: 'http://localhost:9401',
  GEMINI_TIMEOUT_MS: '2000',
});

const transcript = 'This is the fraud department, read me the code.';
const risk = await scoreWithGemini(transcript, 20);
const req = http.calls.find((c) => c[0] === 'gemini');
const body = JSON.parse(req[1]);

check('POST generateContent once', http.calls.filter((c) => c[0] === 'gemini').length === 1, http.calls);
check('system prompt mentions scoring guide',
  String(body.systemInstruction.parts[0].text).includes('0-20 normal'), body.systemInstruction);
check('user payload has previous score and full transcript',
  body.contents[0].parts[0].text.includes('20') && body.contents[0].parts[0].text.includes(transcript),
  body.contents[0].parts[0].text);
check('asks for JSON', body.generationConfig.responseMimeType === 'application/json', body.generationConfig);
check('normalized score 94 + otp signal',
  risk.score === 94 && risk.signals.includes('otp_request') && risk.action === 'hold_transfers', risk);

try {
  await scoreWithGemini(transcript, 20);
} catch {
  /* first call already used; reopen below */
}
http.close();

const down = mockHttp(9402, { geminiScore: null });
process.env.GEMINI_BASE_URL = 'http://localhost:9402';
let threw = false;
try {
  await scoreWithGemini(transcript, 0);
} catch (e) {
  threw = /503|down|Gemini/i.test(e.message);
}
check('non-2xx throws (no fake score)', threw, threw);
down.close();

delete process.env.GEMINI_API_KEY;
let missing = false;
try {
  await scoreWithGemini(transcript, 0);
} catch (e) {
  missing = e.message.includes('GEMINI_API_KEY');
}
check('missing GEMINI_API_KEY throws', missing, missing);
process.exit();
