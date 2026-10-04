# Grok STT + Gemini Risk Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `scamshield-bridge` only, Grok Voice transcribes the Twilio audio stream and Gemini scores each flushed transcript (0–100) into SpacetimeDB, with no STT/score fallbacks.

**Architecture:** Grok Voice stays the µ-law STT websocket and loses `report_risk`. On each transcript flush, `CallSession` sends the full transcript so far plus the previous score to Gemini `generateContent` via `fetch`. Success writes `record_risk_event` (and may trigger the existing ElevenLabs TTS warning). API errors log and stop that step — no ElevenLabs Scribe, no Grok text score, no keyword heuristic. `request_transfer` is unchanged.

**Tech Stack:** Node 20+ ESM, `ws`, `fetch`, xAI Grok Voice realtime, Gemini REST `generateContent`, existing SpacetimeDB HTTP reducers, ElevenLabs TTS.

## Global Constraints

- Scope is `scamshield-bridge/` plus root `.env.example` and README lines that still say Grok scores / ElevenLabs STT. Do not change `server/`, `Twilio/`, `spacetimedb/`, or `worker/`.
- Bytes go only to Grok. Gemini sees text only, and only on flush (VAD `completed` or 1.5s idle). No 10s timer.
- No new npm SDK. Gemini is `fetch` to `{GEMINI_BASE_URL}/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}`. Default model `gemini-2.5-flash`. Default base `https://generativelanguage.googleapis.com`.
- Missing `XAI_API_KEY`, `GEMINI_API_KEY`, or `ELEVENLABS_API_KEY` at process start: refuse to listen and print which key. Tests set keys themselves and do not boot `server.js`.
- Gemini / Grok / TTS / Spacetime errors: log and do not invent success. Gemini failure writes no `record_risk_event`; last score stays. Grok failure does not start ElevenLabs STT.
- Keep ElevenLabs TTS (`tts.js`, `integration.js`, `test/tts.mjs`) and `TTS_WARNING_SCORE` (default 85).
- `npm run bridge:test` must pass with mocks only (no live keys).
- Do not add a Gemini package to `package.json`.

## File structure

| File | Responsibility |
|---|---|
| Create: `scamshield-bridge/src/gemini.js` | `scoreWithGemini(transcript, prevScore)` — `fetch` + `normalizeRisk` |
| Create: `scamshield-bridge/src/keys.js` | `missingApiKeys()` for boot fail-loud |
| Create: `scamshield-bridge/test/gemini.mjs` | Isolated Gemini scorer mock test |
| Create: `scamshield-bridge/test/gemini-fail.mjs` | Flush still stored; Gemini 503 writes no risk |
| Create: `scamshield-bridge/test/grok-fail.mjs` | Grok down → no STT, no score |
| Create: `scamshield-bridge/test/boot.mjs` | `missingApiKeys()` lists the three required keys |
| Modify: `scamshield-bridge/src/risk.js` | Keep schema/guide/`normalizeRisk`; delete Grok text + heuristic |
| Modify: `scamshield-bridge/src/engines/grok.js` | STT only — no tools, no `onRisk` |
| Modify: `scamshield-bridge/src/callSession.js` | Flush → Gemini; no failover; inline `SAMPLE_RATE` |
| Modify: `scamshield-bridge/src/server.js` | Boot keys; `/health` reports Gemini, not engine/failover |
| Modify: `scamshield-bridge/test/mocks.mjs` | Mock Gemini `generateContent`; drop unused chat/STT if nothing calls them |
| Modify: `scamshield-bridge/test/grok.mjs` | Happy path: Grok transcript + Gemini score + TTS |
| Modify: `scamshield-bridge/package.json` | `test` script = grok + gemini + gemini-fail + grok-fail + boot |
| Modify: `.env.example`, `README.MD`, `scamshield-bridge/README.md` | New pipeline + Gemini env |
| Delete: `scamshield-bridge/src/engines/elevenlabs.js`, `src/elevenlabs.js`, `src/audio.js`, `test/elevenlabs.mjs`, `test/failover.mjs` | Dead Scribe/failover path |

---

### Task 1: Gemini scorer

**Files:**
- Create: `scamshield-bridge/src/gemini.js`
- Create: `scamshield-bridge/test/gemini.mjs`
- Modify: `scamshield-bridge/test/mocks.mjs` (add Gemini route)
- Test: `scamshield-bridge/test/gemini.mjs`

**Interfaces:**
- Consumes: `normalizeRisk`, `SCORING_GUIDE`, `RISK_SCHEMA` from `./risk.js` (existing exports; do not change their shapes)
- Produces: `export async function scoreWithGemini(transcript: string, prevScore?: number): Promise<{ score: number, signals: string[], action: string, warning: string, evidence: string }>`
- Env: `GEMINI_API_KEY` (required), `GEMINI_MODEL` (default `gemini-2.5-flash`), `GEMINI_BASE_URL` (default `https://generativelanguage.googleapis.com`), `GEMINI_TIMEOUT_MS` (default `8000`)
- HTTP: `POST {GEMINI_BASE_URL}/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}`
- Request body (exact):

```js
{
  systemInstruction: { parts: [{ text: `You are ScamShield, a fraud analyst scoring a live phone call transcript for scam risk.\n${SCORING_GUIDE}\nReturn JSON only.` }] },
  contents: [{ role: 'user', parts: [{ text: `The previous score was ${prevScore}.\n\n${transcript}` }] }],
  generationConfig: { temperature: 0, responseMimeType: 'application/json' },
}
```

- Response parse: `JSON.parse(data.candidates[0].content.parts[0].text)` then `normalizeRisk(...)`.
- Errors (throw `Error`, do not return a fake score): missing `GEMINI_API_KEY`; non-2xx; timeout (`AbortSignal.timeout`); missing/unparseable candidate text.

- [ ] **Step 1: Add the Gemini route to the shared mock**

In `scamshield-bridge/test/mocks.mjs`, change the `mockHttp` signature and add a `generateContent` branch **before** the final reducer `else`. Keep the existing STT/chat/TTS/sql branches for now.

```js
export function mockHttp(port, { chatScore = 88, geminiScore = 94 } = {}) {
  const calls = [];
  const sessions = [];
  const server = http.createServer((req, res) => {
    const body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(body);
      if (req.url === '/v1/speech-to-text') {
        calls.push(['stt', buf.includes(Buffer.from('RIFF')) ? 'wav ok' : 'NO WAV']);
        res.end(JSON.stringify({ text: 'This is the fraud department, read me the code we sent.' }));
      } else if (req.url === '/v1/chat/completions') {
        const j = JSON.parse(buf);
        calls.push(['chat', j.messages[1].content]);
        if (chatScore == null) { res.writeHead(503); return res.end('down'); }
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          score: chatScore, signals: ['impersonation', 'otp_request'], action: 'hold_transfers',
          warning: 'DO NOT SHARE THE CODE', evidence: 'read me the code' }) } }] }));
      } else if (String(req.url).includes(':generateContent')) {
        calls.push(['gemini', buf.toString()]);
        if (geminiScore == null) { res.writeHead(503); return res.end('down'); }
        res.end(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            score: geminiScore, signals: ['impersonation', 'otp_request'], action: 'hold_transfers',
            warning: 'DO NOT SHARE THE CODE', evidence: 'read me the code',
          }) }] } }],
        }));
      } else if (req.url.startsWith('/v1/text-to-speech/')) {
        calls.push(['tts', req.url]);
        res.end(Buffer.alloc(800, 0x7f));
      } else if (req.url.endsWith('/sql')) {
        calls.push(['sql', buf.toString()]);
        const names = ['id', 'user_id', 'started_at', 'ended_at', 'risk_score', 'status', 'caller_number', 'twilio_call_sid'];
        res.end(JSON.stringify([{ schema: { elements: names.map((n) => ({ name: { some: n } })) },
          rows: sessions.map((r) => [r.id, r.userId, 0, { none: [] }, 0, { Active: [] }, r.callerNumber, r.callSid]) }]));
      } else {
        const reducer = req.url.split('/').pop();
        const args = JSON.parse(buf);
        calls.push([reducer, args]);
        if (reducer === 'start_call_session') sessions.push({ id: 100 + sessions.length, userId: args[0], callerNumber: args[1], callSid: args[2] });
        res.end();
      }
    });
  }).listen(port);
  return { calls, close: () => server.close() };
}
```

- [ ] **Step 2: Write the failing Gemini unit test**

Create `scamshield-bridge/test/gemini.mjs`:

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node scamshield-bridge/test/gemini.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/gemini.js` (or `scoreWithGemini` is not exported).

- [ ] **Step 4: Implement `scoreWithGemini`**

Create `scamshield-bridge/src/gemini.js`:

```js
import { SCORING_GUIDE, normalizeRisk } from './risk.js';

export async function scoreWithGemini(transcript, prevScore = 0) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const base = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const url = `${base}/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: `You are ScamShield, a fraud analyst scoring a live phone call transcript for scam risk.\n${SCORING_GUIDE}\nReturn JSON only.` }],
      },
      contents: [{
        role: 'user',
        parts: [{ text: `The previous score was ${prevScore}.\n\n${transcript}` }],
      }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS || 8000)),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini response missing text');
  return normalizeRisk(JSON.parse(text));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scamshield-bridge/test/gemini.mjs`

Expected: all `PASS` lines, exit 0.

- [ ] **Step 6: Commit**

```bash
git add scamshield-bridge/src/gemini.js scamshield-bridge/test/gemini.mjs scamshield-bridge/test/mocks.mjs
git commit -m "Add Gemini generateContent scorer for flushed call transcripts."
```

---

### Task 2: Happy path — Grok STT only, Gemini on flush

**Files:**
- Modify: `scamshield-bridge/src/engines/grok.js`
- Modify: `scamshield-bridge/src/callSession.js`
- Modify: `scamshield-bridge/test/grok.mjs`
- Test: `scamshield-bridge/test/grok.mjs`

**Interfaces:**
- Consumes: `scoreWithGemini(transcript, prevScore)` from Task 1; `createGrokEngine({ log, onTranscript, onFail })` (no `onRisk`)
- Produces: `CallSession.addTranscript` writes `append_transcript_segment` then queues `scoreWithGemini(this.lines.join('\n'), this.lastScore)` on the existing `scoreQueue`. Success calls existing `setRisk(risk, 'gemini')` which writes `record_risk_event` and may TTS.
- `createGrokEngine` still streams `audio/pcmu` via `input_audio_buffer.append` and flushes on `conversation.item.input_audio_transcription.completed` or 1.5s idle (`FLUSH_IDLE_MS = 1500`). It does not register tools and ignores `response.function_call_arguments.done`.

- [ ] **Step 1: Rewrite the happy-path test so it expects Gemini, not `report_risk`**

Replace `scamshield-bridge/test/grok.mjs` with:

```js
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
  !JSON.stringify(grok.got).includes('report_risk'), grok.got);
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
```

- [ ] **Step 2: Run the happy-path test to verify it fails**

Run: `node scamshield-bridge/test/grok.mjs`

Expected: FAIL — `record_risk_event` is still 11 from Grok `report_risk`, or Gemini is never called. Do not proceed if it already PASSes (the old path is still scoring).

- [ ] **Step 3: Strip scoring from Grok Voice**

In `scamshield-bridge/src/engines/grok.js`:

- Change the file header comment to: Grok Voice is STT only; spoken audio is never forwarded to Twilio; if the socket dies, `onFail(reason)` is called once and the caller must not fail over.
- Replace `INSTRUCTIONS` with:

```js
const INSTRUCTIONS = `You are ScamShield's silent transcriber on a live phone call. You are NOT a participant: never greet, answer, or address anyone. Do not call tools.`;
```

- Delete `REPORT_RISK_TOOL` and the `SCORING_GUIDE` / `RISK_SCHEMA` / `normalizeRisk` import.
- Change the exported factory to `export function createGrokEngine({ log, onTranscript, onFail })`.
- In `session.update`, remove `tools: [REPORT_RISK_TOOL]`. Keep `audio.input.format = { type: 'audio/pcmu' }`, `turn_detection: { type: 'server_vad' }`, and discarded output format.
- Delete the entire `case 'response.function_call_arguments.done'` branch (ignore Grok tool calls).

- [ ] **Step 4: Wire CallSession flush → Gemini**

In `scamshield-bridge/src/callSession.js`:

- Replace the top comment with the new pipeline (Grok STT → Gemini → SpacetimeDB; ElevenLabs TTS only).
- Remove imports of `createElevenLabsEngine` and `scoreTranscript`.
- Add `import { scoreWithGemini } from './gemini.js';`
- Replace `import { SAMPLE_RATE } from './audio.js';` with `const SAMPLE_RATE = 8000;`
- In the constructor, always `this.engine = this.startEngine('grok');` (delete `STT_ENGINE` branch).
- `startEngine` only constructs `createGrokEngine`. `onFail` is:

```js
onFail: (reason) => this.log(`grok failed: ${reason}`),
```

- Delete `failover()` entirely.
- `addTranscript` after the `append_transcript_segment` `db(...)` call, call `this.scoreLatest();`
- Replace `scoreLatest` with:

```js
scoreLatest() {
  this.scoreQueue = this.scoreQueue.then(async () => {
    try {
      const risk = await scoreWithGemini(this.lines.join('\n'), this.lastScore);
      await this.setRisk(risk, 'gemini');
    } catch (e) {
      this.log(`gemini failed: ${e.message}`);
    }
  });
  return this.scoreQueue;
}
```

- Keep `setRisk`, `maybeSpeakWarning`, Twilio `start`/`media`/`stop`, `end`, and `status()` as they are, except `status().engine` can stay `this.engine.name` (`'grok'`).

- [ ] **Step 5: Run happy-path + Gemini unit tests**

Run:

```bash
node scamshield-bridge/test/gemini.mjs
node scamshield-bridge/test/grok.mjs
```

Expected: all PASS, exit 0. Happy path reducer order is `start_call_session,sql,append_transcript_segment,record_risk_event,end_call_session`. Score is 94 from Gemini. TTS still fires once. If `session.update has no report_risk tool` fails because `grok.got` only stores event type strings, change that check to inspect the raw `session.update` the mock recorded — extend `mockGrok` to also `got.push(JSON.stringify(ev))` on each message **or** push `ev.session` when `ev.type === 'session.update'`. Preferred: in `mockGrok`:

```js
ws.on('message', (m) => {
  const ev = JSON.parse(m);
  got.push(ev.type);
  if (ev.type === 'session.update') got.push(JSON.stringify(ev.session));
  onMessage?.(ws, ev, got);
});
```

Then the check `!grok.got.some((x) => String(x).includes('report_risk'))` is valid. Re-run `node scamshield-bridge/test/grok.mjs` after that mock tweak.

- [ ] **Step 6: Commit**

```bash
git add scamshield-bridge/src/engines/grok.js scamshield-bridge/src/callSession.js scamshield-bridge/test/grok.mjs scamshield-bridge/test/mocks.mjs
git commit -m "Score flushed Grok transcripts with Gemini instead of report_risk."
```

---

### Task 3: Fail loud — Gemini error and Grok down

**Files:**
- Create: `scamshield-bridge/test/gemini-fail.mjs`
- Create: `scamshield-bridge/test/grok-fail.mjs`
- Delete: `scamshield-bridge/test/failover.mjs`
- Delete: `scamshield-bridge/test/elevenlabs.mjs`
- Delete: `scamshield-bridge/src/engines/elevenlabs.js`
- Delete: `scamshield-bridge/src/elevenlabs.js`
- Delete: `scamshield-bridge/src/audio.js`
- Modify: `scamshield-bridge/src/risk.js` (delete `scoreTranscript`, `scoreWithGrokText`, `heuristicScore`, `RULES`)
- Modify: `scamshield-bridge/package.json` (`test` script)
- Test: `scamshield-bridge/test/gemini-fail.mjs`, `scamshield-bridge/test/grok-fail.mjs`

**Interfaces:**
- Consumes: `scoreWithGemini` (throws on 503); `CallSession.scoreLatest` already catches and logs without calling `setRisk`
- Produces: Gemini 503 → `append_transcript_segment` exists, `record_risk_event` absent, `lastScore` stays 0. Grok unreachable → no `stt`, no `gemini`, no `record_risk_event`; `start_call_session` then `end_call_session` still happen.

- [ ] **Step 1: Write the Gemini-down integration test**

Create `scamshield-bridge/test/gemini-fail.mjs`:

```js
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
```

- [ ] **Step 2: Write the Grok-down integration test**

Create `scamshield-bridge/test/grok-fail.mjs`:

```js
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
```

- [ ] **Step 3: Run both new tests**

Run:

```bash
node scamshield-bridge/test/gemini-fail.mjs
node scamshield-bridge/test/grok-fail.mjs
```

Expected: `gemini-fail.mjs` PASSes if Task 2's `scoreLatest` catch is in place (Gemini 503 → no risk row). `grok-fail.mjs` FAILS if `failover()` or `STT_ENGINE` still starts ElevenLabs (look for `stt` in `names`). If `failover` is already gone from Task 2, `grok-fail.mjs` should PASS — still run it.

- [ ] **Step 4: Delete dead STT/failover/heuristic code**

Delete these files (they must have no remaining imports):

- `scamshield-bridge/src/engines/elevenlabs.js`
- `scamshield-bridge/src/elevenlabs.js`
- `scamshield-bridge/src/audio.js`
- `scamshield-bridge/test/elevenlabs.mjs`
- `scamshield-bridge/test/failover.mjs`

In `scamshield-bridge/src/risk.js`, keep only `SIGNALS`, `ACTIONS`, `SCORING_GUIDE`, `RISK_SCHEMA`, and `normalizeRisk`. Delete `scoreTranscript`, `scoreWithGrokText`, `heuristicScore`, and `RULES`. The file should be:

```js
export const SIGNALS = ['impersonation', 'urgency', 'threat', 'secrecy', 'otp_request',
  'credential_request', 'payment_request', 'transfer_request',
  'remote_access', 'gift_card_or_crypto', 'other'];
export const ACTIONS = ['none', 'monitor', 'warn', 'hold_transfers'];

export const SCORING_GUIDE = `Scoring: 0-20 normal; 21-50 mild red flags; 51-80 clear social engineering; 81-100 active fraud attempt (e.g., asking for a one-time code, PIN, password, gift cards, crypto, or a wire/Zelle transfer "to a safe account").
Signals to look for: impersonation (bank, fraud dept, IRS, police, tech support, family member), urgency or deadlines, threats (arrest, account closure, fines), secrecy ("don't tell anyone / don't hang up"), requests for OTP/verification codes, remote-access apps, unusual payment methods, requests to move money.
Scores should rarely go down unless the conversation clearly becomes benign.
warning: one short, imperative line for the victim, e.g. "DO NOT SHARE THE CODE — your bank will never ask for it." Empty string if score < 40.`;

export const RISK_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    signals: { type: 'array', items: { type: 'string', enum: SIGNALS } },
    action: { type: 'string', enum: ACTIONS },
    warning: { type: 'string' },
    evidence: { type: 'string', description: 'Short quote from the call that justifies the score.' },
  },
  required: ['score', 'signals', 'action', 'warning', 'evidence'],
  additionalProperties: false,
};

export function normalizeRisk(a) {
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(a.score) || 0))),
    signals: (Array.isArray(a.signals) ? a.signals : []).filter((s) => SIGNALS.includes(s)),
    action: ACTIONS.includes(a.action) ? a.action : 'none',
    warning: a.warning || '',
    evidence: a.evidence || '',
  };
}
```

Confirm `callSession.js` has no `audio.js` / ElevenLabs STT imports (Task 2 already inlined `SAMPLE_RATE = 8000`).

Update `scamshield-bridge/package.json` `test` script to:

```json
"test": "node test/gemini.mjs && node test/grok.mjs && node test/gemini-fail.mjs && node test/grok-fail.mjs"
```

Leave `test:tts` unchanged.

- [ ] **Step 5: Run the full mocked suite**

Run: `npm run bridge:test`

Expected: all five scripts PASS (four in `test` plus you may run `gemini.mjs` already listed). Exit 0. No reference to deleted files.

- [ ] **Step 6: Commit**

```bash
git add -A scamshield-bridge
git commit -m "Fail loud on Gemini or Grok errors and remove STT failover."
```

---

### Task 4: Boot keys, health, env, docs

**Files:**
- Create: `scamshield-bridge/src/keys.js`
- Create: `scamshield-bridge/test/boot.mjs`
- Modify: `scamshield-bridge/src/server.js`
- Modify: `scamshield-bridge/package.json`
- Modify: `.env.example`
- Modify: `README.MD`
- Modify: `scamshield-bridge/README.md`
- Test: `scamshield-bridge/test/boot.mjs`

**Interfaces:**
- Consumes: `process.env`
- Produces: `export function missingApiKeys(): string[]` — returns those of `XAI_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` that are missing or empty
- `server.js` calls `missingApiKeys()` **before** `server.listen`. If the array is non-empty: `console.error('missing required keys: ' + missing.join(', '))` and `process.exit(1)`. Do not listen.
- `GET /health` JSON: `{ ok, keys: { xai, gemini, elevenlabs }, spacetime, calls }` — no `engine`, no `failover`.

- [ ] **Step 1: Write the boot-keys test**

Create `scamshield-bridge/test/boot.mjs`:

```js
import { missingApiKeys } from '../src/keys.js';
import { check } from './mocks.mjs';

const saved = {
  XAI_API_KEY: process.env.XAI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
};

delete process.env.XAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.ELEVENLABS_API_KEY;
check('all three reported when unset',
  JSON.stringify(missingApiKeys().sort()) === JSON.stringify(['ELEVENLABS_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY']),
  missingApiKeys());

process.env.XAI_API_KEY = 'k';
process.env.GEMINI_API_KEY = 'g';
process.env.ELEVENLABS_API_KEY = '';
check('empty string counts as missing',
  JSON.stringify(missingApiKeys()) === JSON.stringify(['ELEVENLABS_API_KEY']),
  missingApiKeys());

process.env.ELEVENLABS_API_KEY = 'x';
check('none missing when all set', missingApiKeys().length === 0, missingApiKeys());

Object.assign(process.env, saved);
process.exit();
```

- [ ] **Step 2: Run the boot test to verify it fails**

Run: `node scamshield-bridge/test/boot.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/keys.js`.

- [ ] **Step 3: Implement keys + server boot/health**

Create `scamshield-bridge/src/keys.js`:

```js
export const REQUIRED_API_KEYS = ['XAI_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY'];

export function missingApiKeys() {
  return REQUIRED_API_KEYS.filter((k) => !process.env[k]);
}
```

In `scamshield-bridge/src/server.js`:

- `import { missingApiKeys } from './keys.js';` (keep `import './env.js';` first so dotenv wins before the check).
- Replace the `/health` payload `engine` / `failover` / `keys` with:

```js
keys: {
  xai: !!process.env.XAI_API_KEY,
  gemini: !!process.env.GEMINI_API_KEY,
  elevenlabs: !!process.env.ELEVENLABS_API_KEY,
},
```

Delete the `engine` and `failover` fields.

- Replace `server.listen(...)` with:

```js
const missing = missingApiKeys();
if (missing.length) {
  console.error(`missing required keys: ${missing.join(', ')}`);
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`ScamShield listening on http://localhost:${PORT}`);
  console.log('  stt: grok-voice  score: gemini  tts: elevenlabs');
});
```

- [ ] **Step 4: Config and docs**

In `.env.example`:

- After the xAI block, add:

```
# ---------- Gemini (risk score on each Grok transcript flush) ----------
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
# GEMINI_BASE_URL=https://generativelanguage.googleapis.com
# GEMINI_TIMEOUT_MS=8000
```

- Delete these **bridge** knobs: `STT_ENGINE`, `FAILOVER`, `ELEVENLABS_SCRIBE_MODEL`, `CHUNK_SECONDS`, `SILENCE_RMS`.
- Change the xAI comment "Grok Voice realtime model (live transcript + report_risk tool)" to "Grok Voice realtime model (live transcript only)".
- Delete the line "Text model that scores transcripts after a failover to ElevenLabs" and `XAI_CHAT_MODEL=...` **only if** nothing in `server/` reads `XAI_CHAT_MODEL`. Check `server/` first — if `server/` still uses it, leave the var and mark the comment `server/ only`.
- Keep `server/`-only vars: `XAI_STT_MODEL`, `ELEVENLABS_STT_MODEL`, `STT_FAILOVER_MS`, `RISK_MIN_CHARS`.
- Keep TTS vars and `ELEVENLABS_API_KEY`.
- Change the ElevenLabs header comment from "Speech to Text + Text to Speech" to "Text to Speech warning (bridge). server/ still uses Scribe realtime."

In `README.MD` Architecture items 2–3 and the ASCII diagram, replace Grok-scores / ElevenLabs-STT failover with: Grok Voice transcribes; Gemini scores each flush; ElevenLabs TTS warning only. Update the `scamshield-bridge/` row in Repo layout and the APIs line ("xAI Grok (Grok Voice STT)", "ElevenLabs (TTS warning)", "Gemini (risk score)"). Add `GEMINI_API_KEY` to the "notepad .env" comment.

In `scamshield-bridge/README.md`, rewrite the opening diagram and bullets to match the spec pipeline. Remove failover rehearsal (`XAI_REALTIME_URL=ws://localhost:1`). File list: add `src/gemini.js`, `src/keys.js`; remove Scribe engine / `elevenlabs.js` / `audio.js`. Watch-the-terminal line should mention `gemini` risk, not `grok-voice` tool scores. `/health` row: keys include Gemini.

Update `scamshield-bridge/package.json`:
- `description`: `"ScamShield call server: Twilio Media Streams -> Grok Voice STT -> Gemini score -> SpacetimeDB"`
- `test`: `"node test/gemini.mjs && node test/grok.mjs && node test/gemini-fail.mjs && node test/grok-fail.mjs && node test/boot.mjs"`

- [ ] **Step 5: Run the full bridge test suite**

Run: `npm run bridge:test`

Expected: every listed test prints PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add scamshield-bridge/src/keys.js scamshield-bridge/src/server.js scamshield-bridge/test/boot.mjs scamshield-bridge/package.json .env.example README.MD scamshield-bridge/README.md
git commit -m "Require API keys at boot and document Grok STT plus Gemini scoring."
```

---

## Self-review

**Spec coverage**
- Grok STT only, bytes pass-through → Task 2
- Gemini on flush, full transcript + previous score, JSON 0–100 → Tasks 1–2
- `record_risk_event` / money gate unchanged → Task 2 uses existing `setRisk`
- ElevenLabs TTS once at high score → Task 2 happy path
- No 10s timer → no task adds one
- No STT failover / no heuristic / no Grok text score → Task 3
- Boot missing keys → Task 4
- Gemini 503: transcript kept, no risk row → Task 3 `gemini-fail.mjs`
- Grok down: no ElevenLabs → Task 3 `grok-fail.mjs`
- Config + README → Task 4
- `server/` / `Twilio/` / `spacetimedb/` / `worker/` untouched → Global Constraints
- Delete Scribe files + `audio.js` → Task 3

**Placeholders:** none.

**Type consistency:** `scoreWithGemini(transcript, prevScore)` → `{ score, signals, action, warning, evidence }` via `normalizeRisk`; `setRisk(risk, 'gemini')`; `missingApiKeys(): string[]`.
