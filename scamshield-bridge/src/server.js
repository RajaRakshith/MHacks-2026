// ScamShield local server.
//   POST /twilio/voice   Twilio "A call comes in" webhook -> TwiML that opens a Media Stream to us
//   WS   /media-stream   Twilio Media Stream (one CallSession per connection)
//   GET  /health         status + active calls
//   POST /calls/:callSid/warn   speak the ElevenLabs scam warning into a live call now (demo/testing)
import './env.js';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { CallSession, activeSessions } from './callSession.js';
import { playScamWarning } from './integration.js';

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
  const host = process.env.PUBLIC_HOST || process.env.PUBLIC_URL?.replace(/^\w+:\/\//, '').replace(/\/$/, '')
    || req.headers['x-forwarded-host'] || req.headers.host;
  // userId must match the one the bank app uses for request_transfer, or the money gate won't see this call.
  const userId = url.searchParams.get('userId') || process.env.DEFAULT_USER_ID || 'demo-user';
  console.log(`incoming call ${form.get('CallSid')} from ${form.get('From')} -> stream wss://${host}/media-stream`);

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${xmlEscape(host)}/media-stream">
      <Parameter name="userId" value="${xmlEscape(userId)}"/>
      <Parameter name="callerNumber" value="${xmlEscape(form.get('From') || '')}"/>
    </Stream>
  </Connect>
</Response>`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/twilio/voice') return await handleVoiceWebhook(req, res, url);
    const warn = url.pathname.match(/^\/calls\/([^/]+)\/warn$/);
    if (req.method === 'POST' && warn) {
      const session = activeSessions.get(decodeURIComponent(warn[1]));
      const played = session ? await playScamWarning(session, { force: true }) : false;
      res.writeHead(session ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ played }));
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        engine: process.env.STT_ENGINE === 'elevenlabs' ? 'elevenlabs' : 'grok',
        failover: process.env.FAILOVER !== 'false',
        keys: {
          xai: !!process.env.XAI_API_KEY,
          elevenlabs: !!process.env.ELEVENLABS_API_KEY,
        },
        spacetime: `${process.env.SPACETIME_HOST || process.env.SPACETIME_URI || 'http://127.0.0.1:3000'} / ${process.env.SPACETIME_DB || process.env.SPACETIME_DATABASE || 'scamshield-dev'}`,
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
  for (const [k, label] of [['XAI_API_KEY', 'xAI'], ['ELEVENLABS_API_KEY', 'ElevenLabs']]) {
    if (!process.env[k]) console.log(`  warning: ${k} not set (${label})`);
  }
});
