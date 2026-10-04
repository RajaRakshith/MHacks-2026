// ScamShield local server.
//   POST /twilio/voice   Twilio "A call comes in" webhook -> TwiML that opens a Media Stream to us
//   WS   /media-stream   Twilio Media Stream (one CallSession per connection)
//   GET  /health         status + active calls
import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { CallSession, activeSessions } from './callSession.js';

const PORT = Number(process.env.PORT || 8080);

const xmlEscape = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

async function handleVoiceWebhook(req, res, url) {
  const form = new URLSearchParams(await readBody(req));
  // Twilio can't reach localhost; behind ngrok the Host header is the public host.
  const host = process.env.PUBLIC_HOST || req.headers['x-forwarded-host'] || req.headers.host;
  // Map a user however suits the demo: ?userId=... on the webhook URL, else the caller's number.
  const userId = url.searchParams.get('userId') || process.env.DEFAULT_USER_ID || form.get('From') || '';
  console.log(`incoming call ${form.get('CallSid')} from ${form.get('From')} -> stream wss://${host}/media-stream`);

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${xmlEscape(host)}/media-stream">
      <Parameter name="userId" value="${xmlEscape(userId)}"/>
    </Stream>
  </Connect>
</Response>`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/twilio/voice') return await handleVoiceWebhook(req, res, url);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        engine: process.env.STT_ENGINE === 'elevenlabs' ? 'elevenlabs' : 'grok',
        failover: process.env.FAILOVER !== 'false',
        keys: {
          xai: !!process.env.XAI_API_KEY,
          elevenlabs: !!process.env.ELEVENLABS_API_KEY,
          spacetime: !!process.env.SPACETIME_DB,
        },
        calls: [...activeSessions.values()].map((s) => s.status()),
      }, null, 2));
    }
    res.writeHead(url.pathname === '/' ? 200 : 404);
    res.end(url.pathname === '/' ? 'ScamShield bridge up' : 'not found');
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end('error');
  }
});

new WebSocketServer({ server, path: '/media-stream' }).on('connection', (ws) => new CallSession(ws));

server.listen(PORT, () => {
  console.log(`ScamShield listening on http://localhost:${PORT}`);
  console.log(`  engine: ${process.env.STT_ENGINE === 'elevenlabs' ? 'elevenlabs' : 'grok'}` +
    (process.env.FAILOVER === 'false' ? '' : ' (elevenlabs failover on)'));
  for (const [k, label] of [['XAI_API_KEY', 'xAI'], ['ELEVENLABS_API_KEY', 'ElevenLabs'], ['SPACETIME_DB', 'SpacetimeDB']]) {
    if (!process.env[k]) console.log(`  warning: ${k} not set (${label})`);
  }
});
