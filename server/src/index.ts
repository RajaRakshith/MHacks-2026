import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { config, requireKeys } from './config.js';
import { ensureSpacetimeConnected } from './spacetime/client.js';
import { handleTwilioMediaStream } from './twilio/media-stream-handler.js';
import { buildStreamTwiml } from './twilio/webhooks.js';

requireKeys();

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { ok: true, service: 'watchdog-ingestion' });
    return;
  }

  // Twilio voice webhook — returns TwiML that opens a bidirectional media stream.
  if (
    (req.method === 'POST' || req.method === 'GET') &&
    url.pathname === '/twilio/voice'
  ) {
    const userId = url.searchParams.get('userId') ?? undefined;
    const callerNumber = url.searchParams.get('From') ?? undefined;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(buildStreamTwiml({ userId, callerNumber }));
    return;
  }

  json(res, 404, { error: 'not found' });
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  const path = req.url ?? '/';
  if (path.startsWith('/twilio/media-stream')) {
    void handleTwilioMediaStream(ws);
    return;
  }
  ws.close();
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, req);
  });
});

server.listen(config.port, async () => {
  console.log(`[server] listening on ${config.publicUrl}`);
  console.log(`[server] Twilio voice webhook: ${config.publicUrl}/twilio/voice`);
  console.log(`[server] Media stream WS: ${config.publicUrl.replace(/^http/, 'ws')}/twilio/media-stream`);

  try {
    await ensureSpacetimeConnected();
  } catch (err) {
    console.warn(
      '[spacetime] not connected yet — publish module and run spacetime:generate',
      err instanceof Error ? err.message : err
    );
  }
});

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
