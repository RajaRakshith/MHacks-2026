// One Twilio Media Stream connection = one CallSession.
//
//   Twilio audio ──▶ engine ──▶ transcripts + risk ──▶ SpacetimeDB reducers
//
// Engine is Grok Voice by default. If Grok fails (can't connect, errors, drops mid-call)
// the session switches to ElevenLabs for the rest of the call; transcripts from ElevenLabs
// are then risk-scored by Grok's text API (or a keyword heuristic if that's down too).
// Transcript seq numbers and the risk score carry across the switch.

import { createGrokEngine } from './engines/grok.js';
import { createElevenLabsEngine } from './engines/elevenlabs.js';
import { scoreTranscript } from './risk.js';
import { callReducer } from './spacetime.js';
import { SAMPLE_RATE } from './audio.js';

const R = {
  start: process.env.REDUCER_START || 'start_call',
  chunk: process.env.REDUCER_CHUNK || 'append_transcript',
  risk: process.env.REDUCER_RISK || 'update_risk',
  end: process.env.REDUCER_END || 'end_call',
};

export const activeSessions = new Map(); // callSid -> CallSession (for /health)

export class CallSession {
  constructor(twilioWs) {
    this.callSid = null;
    this.userId = '';
    this.track = process.env.TWILIO_TRACK || 'inbound';
    this.seq = 0;
    this.lines = [];        // full transcript so far, for text-based scoring
    this.lastScore = 0;
    this.audioBytes = 0;    // call clock: 8000 mu-law bytes == 1s
    this.lastTranscriptMs = 0;
    this.dbQueue = Promise.resolve(); // reducer calls stay in order (start -> chunks -> end)
    this.scoreQueue = Promise.resolve();
    this.engine = this.startEngine(process.env.STT_ENGINE === 'elevenlabs' ? 'elevenlabs' : 'grok');

    twilioWs.on('message', (raw) => this.onTwilioMessage(raw));
    twilioWs.on('close', () => this.end());
    twilioWs.on('error', (e) => this.log('twilio ws error', e.message));
  }

  log(...a) { console.log(`[${this.callSid || 'pending'}]`, ...a); }

  nowMs() { return Math.round((this.audioBytes / SAMPLE_RATE) * 1000); }

  db(reducer, args) {
    this.dbQueue = this.dbQueue.then(() =>
      callReducer(reducer, args).catch((e) => this.log(`${reducer} failed:`, e.message)));
    return this.dbQueue;
  }

  startEngine(name, { startOffsetMs = 0 } = {}) {
    const log = (...a) => this.log(...a);
    if (name === 'grok') {
      return createGrokEngine({
        log,
        onTranscript: (text) => this.addTranscript(text, {}),
        onRisk: (risk, source) => this.setRisk(risk, source),
        onFail: (reason, unsentAudio) => this.failover(reason, unsentAudio),
      });
    }
    return createElevenLabsEngine({
      log,
      startOffsetMs,
      onTranscript: (text, timing) => {
        this.addTranscript(text, timing);
        return this.scoreLatest();
      },
    });
  }

  failover(reason, unsentAudio) {
    if (this.ended) return;
    if (process.env.FAILOVER === 'false') { this.log(`grok failed (${reason}); FAILOVER=false, no transcription`); return; }
    if (!process.env.ELEVENLABS_API_KEY) this.log('WARNING: failing over but ELEVENLABS_API_KEY is not set');
    const unsentBytes = unsentAudio.reduce((n, p) => n + Buffer.byteLength(p, 'base64'), 0);
    const unsentMs = Math.round((unsentBytes / SAMPLE_RATE) * 1000);
    this.log(`grok failed (${reason}) -> failing over to elevenlabs`);
    this.engine = this.startEngine('elevenlabs', { startOffsetMs: Math.max(0, this.nowMs() - unsentMs) });
    for (const p of unsentAudio) this.engine.pushAudio(p);
  }

  addTranscript(text, { startMs = this.lastTranscriptMs, endMs = this.nowMs(), speakerText = '' }) {
    const seq = this.seq++;
    this.lastTranscriptMs = endMs;
    this.lines.push(speakerText || text);
    this.log(`#${seq} [${this.engine?.name ?? 'grok'}] transcript: ${text}`);
    this.db(R.chunk, [this.callSid, seq, startMs, endMs, text, speakerText]);
  }

  setRisk(risk, source) {
    this.lastScore = risk.score;
    this.log(`risk ${risk.score} (${source}) [${risk.signals.join(', ')}] ${risk.action} ${risk.warning}`);
    return this.db(R.risk, [this.callSid, risk.score, JSON.stringify(risk.signals), risk.action,
      risk.warning, risk.evidence]);
  }

  // Used on the ElevenLabs path: re-score the whole call with Grok text after each new chunk.
  scoreLatest() {
    this.scoreQueue = this.scoreQueue.then(async () => {
      const risk = await scoreTranscript(this.lines.join('\n'), this.lastScore);
      const source = risk.evidence.startsWith('heuristic') ? 'heuristic' : 'grok-text';
      await this.setRisk(risk, source);
    });
    return this.scoreQueue;
  }

  onTwilioMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.event) {
      case 'start':
        this.callSid = msg.start.callSid;
        // Set in TwiML: <Stream url="..."><Parameter name="userId" value="..."/></Stream>
        this.userId = msg.start.customParameters?.userId || '';
        activeSessions.set(this.callSid, this);
        this.log('stream started', msg.start.streamSid, 'user', this.userId || '(none)');
        this.db(R.start, [this.callSid, this.userId]);
        break;
      case 'media':
        if (msg.media.track && msg.media.track !== this.track) return;
        this.audioBytes += Buffer.byteLength(msg.media.payload, 'base64');
        this.engine.pushAudio(msg.media.payload);
        break;
      case 'stop':
        this.log('stream stopped');
        break;
    }
  }

  async end() {
    if (this.ended) return;
    this.ended = true;
    await this.engine.close();
    await this.scoreQueue;
    if (this.callSid) {
      await this.db(R.end, [this.callSid]);
      activeSessions.delete(this.callSid);
    }
    this.log('call ended');
  }

  status() {
    return { callSid: this.callSid, userId: this.userId, engine: this.engine.name,
      riskScore: this.lastScore, transcriptChunks: this.seq, audioSeconds: this.nowMs() / 1000 };
  }
}
