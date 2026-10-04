// Shared mocks: one HTTP server playing ElevenLabs STT, xAI chat, and SpacetimeDB; a fake Twilio client.
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

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
        res.end(Buffer.alloc(800, 0x7f)); // 0.1s of mu-law = 5 Twilio frames
      } else if (req.url.endsWith('/sql')) {
        // Shaped like SpacetimeDB's SQL response for call_sessions (snake_case columns, SATS-JSON options/enums).
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

export function mockGrok(port, onMessage) {
  const got = [];
  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws, req) => {
    got.push('auth=' + req.headers.authorization);
    ws.on('message', (m) => {
      const ev = JSON.parse(m);
      got.push(ev.type);
      if (ev.type === 'session.update') got.push(JSON.stringify(ev.session));
      onMessage?.(ws, ev, got);
    });
  });
  return { got, close: () => wss.close() };
}

// Fake Twilio: start event, then `seconds` of loud mu-law audio in 20ms (160-byte) frames.
export async function fakeTwilioCall(url, { seconds = 3, callSid = 'CA1', gapMs = 0 } = {}) {
  const ws = new WebSocket(url);
  const back = [];
  ws.on('message', (m) => back.push(m.toString()));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ event: 'connected' }));
  ws.send(JSON.stringify({ event: 'start', start: { callSid, streamSid: 'MZ1', tracks: ['inbound'], customParameters: { userId: 'u1' } } }));
  const f = Buffer.alloc(160);
  for (let j = 0; j < 160; j++) f[j] = j % 16 < 8 ? 0x10 : 0x90;
  for (let i = 0; i < seconds * 50; i++) {
    ws.send(JSON.stringify({ event: 'media', media: { track: 'inbound', payload: f.toString('base64') } }));
    if (gapMs && i % 50 === 49) await new Promise((r) => setTimeout(r, gapMs));
  }
  return { ws, back, hangup: () => { ws.send(JSON.stringify({ event: 'stop' })); ws.close(); } };
}

export async function startBridge(port) {
  const { CallSession } = await import('../src/callSession.js');
  const srv = http.createServer();
  new WebSocketServer({ server: srv, path: '/media-stream' }).on('connection', (ws) => new CallSession(ws));
  await new Promise((r) => srv.listen(port, r));
  return `ws://localhost:${port}/media-stream`;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) { console.log('      ', JSON.stringify(detail, null, 1)); process.exitCode = 1; }
}
