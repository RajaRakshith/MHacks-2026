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
check('system prompt lists required JSON keys',
  /Required JSON keys: score \(0-100 integer\), signals \(from the known list\), action, warning, evidence/.test(
    body.systemInstruction.parts[0].text),
  body.systemInstruction);
check('normalized score 94 + otp signal',
  risk.score === 94 && risk.signals.includes('otp_request') && risk.action === 'hold_transfers', risk);
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

const bad = mockHttp(9403, { geminiScore: { risk_score: 94 } });
process.env.GEMINI_BASE_URL = 'http://localhost:9403';
let missingScore = null;
try {
  missingScore = await scoreWithGemini(transcript, 0);
} catch (e) {
  missingScore = e;
}
check('malformed Gemini JSON without numeric score throws (no fake 0)',
  missingScore instanceof Error && missingScore.message.includes('Gemini response missing score'),
  missingScore instanceof Error ? missingScore.message : missingScore);
bad.close();

delete process.env.GEMINI_API_KEY;
let missing = false;
try {
  await scoreWithGemini(transcript, 0);
} catch (e) {
  missing = e.message.includes('GEMINI_API_KEY');
}
check('missing GEMINI_API_KEY throws', missing, missing);

process.env.GEMINI_API_KEY = 'gk';
delete process.env.GEMINI_MODEL;
const def = mockHttp(9404, { geminiScore: 10 });
process.env.GEMINI_BASE_URL = 'http://localhost:9404';
await scoreWithGemini(transcript, 0);
check('default model is gemini-3.5-flash-lite',
  String(def.calls[0]?.[2] || '').includes('/models/gemini-3.5-flash-lite:generateContent'),
  def.calls[0]?.[2]);
check('does not send temperature (unsupported on Gemini 3 Flash)',
  !Object.hasOwn(JSON.parse(def.calls[0][1]).generationConfig, 'temperature'),
  JSON.parse(def.calls[0][1]).generationConfig);
def.close();
process.exit();
