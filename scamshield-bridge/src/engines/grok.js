// Grok Voice is STT only; spoken audio is never forwarded to Twilio; if the socket dies, `onFail(reason)` is called once and the caller must not fail over.

import WebSocket from 'ws';

const FLUSH_IDLE_MS = 1500; // write a transcript once it stops changing for this long

const INSTRUCTIONS = `You are ScamShield's silent transcriber on a live phone call. You are NOT a participant: never greet, answer, or address anyone. Do not call tools.`;

export function createGrokEngine({ log, onTranscript, onFail }) {
  const url = process.env.XAI_REALTIME_URL ||
    `wss://api.x.ai/v1/realtime?model=${process.env.XAI_MODEL || 'grok-voice-latest'}`;
  const connectTimeoutMs = Number(process.env.GROK_CONNECT_TIMEOUT_MS || 5000);

  let ready = false;
  let dead = false;      // failed or closed by us; ignore everything after
  const pendingAudio = []; // audio that arrives before the socket is open
  const items = new Map(); // item_id -> { text, timer, written }

  if (!process.env.XAI_API_KEY) {
    queueMicrotask(() => fail('XAI_API_KEY not set'));
    return { name: 'grok', pushAudio: (p) => pendingAudio.push(p), close() {} };
  }

  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` } });
  const connectTimer = setTimeout(() => fail(`no connection after ${connectTimeoutMs}ms`), connectTimeoutMs);

  function fail(reason) {
    if (dead) return;
    dead = true;
    clearTimeout(connectTimer);
    flushAll();
    try { ws?.terminate(); } catch {}
    onFail(reason);
  }

  ws.on('open', () => {
    clearTimeout(connectTimer);
    if (dead) return;
    ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        instructions: INSTRUCTIONS,
        voice: 'eve',
        turn_detection: { type: 'server_vad' },
        audio: {
          input: {
            format: { type: 'audio/pcmu' }, // Twilio's native 8kHz mu-law, passed straight through
            transcription: { language_hint: 'en' },
          },
          output: { format: { type: 'audio/pcmu' } }, // discarded
        },
      },
    }));
    ready = true;
    for (const payload of pendingAudio.splice(0)) sendAudio(payload);
    log('grok connected');
  });

  function sendAudio(payload) {
    ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: payload }));
  }

  function flushItem(id) {
    const it = items.get(id);
    if (!it || it.written || !it.text.trim()) return;
    clearTimeout(it.timer);
    it.written = true;
    onTranscript(it.text.trim());
  }

  function flushAll() {
    for (const id of items.keys()) flushItem(id);
  }

  ws.on('message', (raw) => {
    if (dead) return;
    let ev;
    try { ev = JSON.parse(raw.toString()); } catch { return; }

    switch (ev.type) {
      // Live transcript of what was said on the call (cumulative, may self-correct).
      case 'conversation.item.input_audio_transcription.updated':
      case 'conversation.item.input_audio_transcription.delta':
      case 'conversation.item.input_audio_transcription.completed': {
        const id = ev.item_id || 'default';
        if (!items.has(id)) items.set(id, { text: '', timer: null, written: false });
        const it = items.get(id);
        if (it.written) return;
        if (ev.type.endsWith('.delta')) it.text += ev.delta || '';
        else it.text = ev.transcript ?? it.text;
        clearTimeout(it.timer);
        if (ev.type.endsWith('.completed')) flushItem(id);
        else it.timer = setTimeout(() => flushItem(id), FLUSH_IDLE_MS);
        break;
      }

      case 'error':
        log('grok error:', JSON.stringify(ev.error || ev));
        break;
      // response.output_audio.delta etc. are intentionally ignored (never sent to Twilio).
    }
  });

  ws.on('error', (e) => fail(`ws error: ${e.message || e.code || e.errors?.[0]?.code || e}`));
  ws.on('close', (code, reason) => fail(`closed ${code} ${reason.toString()}`));

  return {
    name: 'grok',
    pushAudio(payload) {
      if (dead) return;
      if (ready && ws.readyState === WebSocket.OPEN) sendAudio(payload);
      else pendingAudio.push(payload);
    },
    close() {
      if (dead) return;
      dead = true;
      clearTimeout(connectTimer);
      flushAll();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    },
  };
}
