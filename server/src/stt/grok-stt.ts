import WebSocket from 'ws';
import { config } from '../config.js';
import type { SttPipeline, TranscriptEvent } from './types.js';

const GROK_STT_URL =
  'wss://api.x.ai/v1/stt?' +
  new URLSearchParams({
    sample_rate: '8000',
    encoding: 'mulaw',
    interim_results: 'true',
    language: 'en',
    vad_threshold: '0.05',
    endpointing: '400',
  }).toString();

export function createGrokSttPipeline(): SttPipeline {
  let ws: WebSocket | null = null;
  let ready = false;
  const transcriptHandlers = new Set<(e: TranscriptEvent) => void>();
  const errorHandlers = new Set<(e: Error) => void>();
  const closeHandlers = new Set<() => void>();

  const emit = (event: TranscriptEvent) => {
    for (const h of transcriptHandlers) h(event);
  };

  return {
    source: 'grok',

    onTranscript(h) {
      transcriptHandlers.add(h);
    },
    onError(h) {
      errorHandlers.add(h);
    },
    onClose(h) {
      closeHandlers.add(h);
    },

    async connect() {
      if (!config.xaiApiKey) {
        throw new Error('XAI_API_KEY is required for Grok STT');
      }

      await new Promise<void>((resolve, reject) => {
        ws = new WebSocket(GROK_STT_URL, {
          headers: { Authorization: `Bearer ${config.xaiApiKey}` },
        });

        ws.on('open', () => {
          console.log('[grok-stt] connected');
        });

        ws.on('message', data => {
          const raw = typeof data === 'string' ? data : data.toString('utf8');
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(raw);
          } catch {
            return;
          }

          if (event.type === 'transcript.created') {
            ready = true;
            resolve();
            return;
          }

          if (event.type === 'transcript.partial') {
            const text = String(event.text ?? '').trim();
            if (!text) return;
            emit({
              source: 'grok',
              text,
              isFinal: Boolean(event.is_final),
              speechFinal: Boolean(event.speech_final),
            });
            return;
          }

          if (event.type === 'error') {
            const err = new Error(String(event.message ?? 'Grok STT error'));
            for (const h of errorHandlers) h(err);
          }
        });

        ws.on('error', err => {
          for (const h of errorHandlers) h(err);
          reject(err);
        });

        ws.on('close', () => {
          ready = false;
          for (const h of closeHandlers) h();
        });
      });
    },

    sendMulawAudio(chunk: Buffer) {
      if (!ws || ws.readyState !== WebSocket.OPEN || !ready) return;
      ws.send(chunk);
    },

    close() {
      if (!ws) return;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'audio.done' }));
      }
      ws.close();
      ws = null;
      ready = false;
    },
  };
}
