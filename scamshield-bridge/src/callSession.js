// One Twilio Media Stream connection = one CallSession.
//
//   Twilio audio ──▶ Grok STT ──▶ Gemini ──▶ SpacetimeDB
//
// Grok Voice only transcribes. Each flushed transcript is scored by Gemini.
// ElevenLabs TTS is the only audio sent back to Twilio, once risk reaches TTS_WARNING_SCORE.

import { createGrokEngine } from './engines/grok.js';
import { scoreWithGemini } from './gemini.js';
import { startCallSession, appendTranscriptSegment, recordRiskEvent, endCallSession } from './spacetime.js';
import { playScamWarning } from './integration.js';

const SAMPLE_RATE = 8000;

export const activeSessions = new Map(); // callSid -> CallSession (for /health)

export class CallSession {
  constructor(twilioWs) {
    this.twilioWs = twilioWs;
    this.callSid = null;
    this.streamSid = null;
    this.userId = '';
    this.sessionId = null;  // call_sessions.id in SpacetimeDB
    this.scamWarningPlayed = false;
    this.track = process.env.TWILIO_TRACK || 'inbound';
    this.seq = 0;
    this.lines = [];        // full transcript so far, for text-based scoring
    this.lastScore = 0;
    this.audioBytes = 0;    // call clock: 8000 mu-law bytes == 1s
    this.dbQueue = Promise.resolve(); // reducer calls stay in order (start -> chunks -> end)
    this.scoreQueue = Promise.resolve();
    this.engine = this.startEngine('grok');

    twilioWs.on('message', (raw) => this.onTwilioMessage(raw));
    twilioWs.on('close', () => this.end());
    twilioWs.on('error', (e) => this.log('twilio ws error', e.message));
  }

  log(...a) { console.log(`[${this.callSid || 'pending'}]`, ...a); }

  nowMs() { return Math.round((this.audioBytes / SAMPLE_RATE) * 1000); }

  // Queue a SpacetimeDB write. Skipped (with a log) if start_call_session never succeeded.
  db(name, fn) {
    this.dbQueue = this.dbQueue.then(async () => {
      if (this.sessionId === null) return this.log(`${name} skipped: no SpacetimeDB session`);
      await fn(this.sessionId);
    }).catch((e) => this.log(`${name} failed:`, e.message));
    return this.dbQueue;
  }

  startEngine() {
    const log = (...a) => this.log(...a);
    return createGrokEngine({
      log,
      onTranscript: (text) => this.addTranscript(text),
      onFail: (reason) => this.log(`grok failed: ${reason}`),
    });
  }

  addTranscript(text) {
    const seq = this.seq++;
    this.lines.push(text);
    const source = this.engine?.name ?? 'grok';
    this.log(`#${seq} [${source}] transcript: ${text}`);
    this.db('append_transcript_segment', (id) =>
      appendTranscriptSegment(id, { text, source, isFinal: true }));
    this.scoreLatest();
  }

  setRisk(risk, source) {
    this.lastScore = risk.score;
    this.log(`risk ${risk.score} (${source}) [${risk.signals.join(', ')}] ${risk.action} ${risk.warning}`);
    this.maybeSpeakWarning(risk);
    return this.db('record_risk_event', (id) => recordRiskEvent(id, {
      signalType: risk.signals[0] || 'none',
      transcriptExcerpt: risk.evidence || this.lines.at(-1) || '',
      riskScore: risk.score,
      warning: risk.warning,
    }));
  }

  maybeSpeakWarning(risk) {
    if (process.env.TTS_WARNING === 'false' || this.scamWarningPlayed) return;
    if (risk.score < Number(process.env.TTS_WARNING_SCORE || 85)) return;
    this.log(`risk ${risk.score} -> speaking ElevenLabs warning into the call`);
    playScamWarning(this).catch((e) => this.log('tts warning failed:', e.message));
  }

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

  onTwilioMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.event) {
      case 'start':
        this.callSid = msg.start.callSid;
        this.streamSid = msg.start.streamSid;
        // Set in TwiML: <Stream url="..."><Parameter name="userId" value="..."/></Stream>
        this.userId = msg.start.customParameters?.userId || process.env.DEFAULT_USER_ID || 'demo-user';
        activeSessions.set(this.callSid, this);
        this.log('stream started', this.streamSid, 'user', this.userId);
        // Must land before any transcript/risk write, which all need the session id.
        this.dbQueue = this.dbQueue.then(async () => {
          try {
            this.sessionId = await startCallSession({ userId: this.userId, callSid: this.callSid,
              callerNumber: msg.start.customParameters?.callerNumber });
            this.log(`spacetime call_sessions.id=${this.sessionId}`);
          } catch (e) {
            this.log('start_call_session failed:', e.message);
          }
        });
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
      await this.db('end_call_session', (id) => endCallSession(id));
      activeSessions.delete(this.callSid);
    }
    this.log('call ended');
  }

  status() {
    return { callSid: this.callSid, sessionId: this.sessionId, userId: this.userId, engine: this.engine.name,
      riskScore: this.lastScore, transcriptChunks: this.seq, audioSeconds: this.nowMs() / 1000 };
  }
}
