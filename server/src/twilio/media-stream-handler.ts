import type { WebSocket } from 'ws';
import { config } from '../config.js';
import { scoreTranscriptRisk } from '../risk/grok-risk-scorer.js';
import {
  appendTranscript,
  endCallSession,
  recordRisk,
  startCallSession,
} from '../spacetime/client.js';
import { RedundantSttRouter } from '../stt/redundant-stt.js';
import type { TranscriptEvent } from '../stt/types.js';

type TwilioMessage =
  | { event: 'connected'; protocol: string; version: string }
  | {
      event: 'start';
      sequenceNumber: string;
      start: {
        streamSid: string;
        callSid: string;
        customParameters?: Record<string, string>;
      };
    }
  | {
      event: 'media';
      sequenceNumber: string;
      media: { payload: string; track?: string; chunk?: string };
    }
  | { event: 'stop'; sequenceNumber: string; stop: { callSid: string } };

export async function handleTwilioMediaStream(ws: WebSocket) {
  let stt: RedundantSttRouter | null = null;
  let priorRisk = 0;
  let scoring = false;
  let callSid = '';
  let userId = 'demo-user';

  const onTranscript = async (event: TranscriptEvent) => {
    console.log(
      `[transcript:${event.source}]${event.isFinal ? ' [final]' : ''} ${event.text}`
    );

    await appendTranscript({
      text: event.text,
      source: event.source,
      isFinal: event.isFinal,
    });

    if (!event.speechFinal && !event.isFinal) return;
    if (event.text.length < config.riskMinChars) return;
    if (scoring) return;

    scoring = true;
    try {
      const assessment = await scoreTranscriptRisk(event.text, priorRisk);
      priorRisk = assessment.riskScore;
      await recordRisk({
        signalType: assessment.signalType,
        transcriptExcerpt: event.text,
        riskScoreAfter: assessment.riskScore,
        warningMessage: assessment.warningMessage,
      });
    } catch (err) {
      console.error('[risk]', err instanceof Error ? err.message : err);
    } finally {
      scoring = false;
    }
  };

  ws.on('message', async raw => {
    let msg: TwilioMessage;
    try {
      msg = JSON.parse(raw.toString()) as TwilioMessage;
    } catch {
      return;
    }

    switch (msg.event) {
      case 'connected':
        console.log('[twilio] media stream connected');
        break;

      case 'start': {
        callSid = msg.start.callSid;
        userId = msg.start.customParameters?.userId ?? userId;
        const callerNumber = msg.start.customParameters?.callerNumber;

        console.log(`[twilio] stream start callSid=${callSid} userId=${userId}`);

        try {
          await startCallSession({
            userId,
            callerNumber,
            twilioCallSid: callSid,
          });
        } catch (err) {
          console.error('[spacetime] start session failed:', err);
        }

        stt = new RedundantSttRouter({
          onTranscript,
          onSourceChange: source =>
            console.warn(`[redundant-stt] active source → ${source}`),
          onError: (source, err) =>
            console.error(`[stt:${source}]`, err.message),
        });

        try {
          await stt.start();
        } catch (err) {
          console.error('[stt] failed to start:', err);
        }
        break;
      }

      case 'media': {
        if (!stt) return;
        const audio = Buffer.from(msg.media.payload, 'base64');
        stt.sendMulawAudio(audio);
        break;
      }

      case 'stop':
        console.log(`[twilio] stream stop callSid=${callSid}`);
        stt?.close();
        stt = null;
        await endCallSession();
        break;
    }
  });

  ws.on('close', async () => {
    stt?.close();
    await endCallSession();
  });
}
