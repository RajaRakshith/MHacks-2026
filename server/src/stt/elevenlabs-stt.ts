import WebSocket from 'ws';
import { config } from '../config.js';
import { twilioMulawToPcm16k } from '../audio/mulaw.js';
import type { SttPipeline, TranscriptEvent } from './types.js';

function buildUrl() {
  const params = new URLSearchParams({
    model_id: config.elevenLabsSttModel,
    commit_strategy: 'vad',
    vad_threshold: '0.4',
    vad_silence_threshold_secs: '1.0',
    language_code: 'en',
  });
  return `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`;
}

export function createElevenLabsSttPipeline(): SttPipeline {
  let ws: WebSocket | null = null;
  let ready = false;
  const transcriptHandlers = new Set<(e: TranscriptEvent) => void>();
  const errorHandlers = new Set<(e: Error) => void>();
  const closeHandlers = new Set<() => void>();

  const emit = (event: TranscriptEvent) => {
    for (const h of transcriptHandlers) h(event);
  };

  return {
    source: 'elevenlabs',

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
      if (!config.elevenLabsApiKey) {
        throw new Error('ELEVENLABS_API_KEY is required for backup STT');
      }

      await new Promise<void>((resolve, reject) => {
        ws = new WebSocket(buildUrl(), {
          headers: { 'xi-api-key': config.elevenLabsApiKey },
        });

        ws.on('open', () => console.log('[elevenlabs-stt] connected'));

        ws.on('message', data => {
          const raw = typeof data === 'string' ? data : data.toString('utf8');
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(raw);
          } catch {
            return;
          }

          const type = String(event.message_type ?? event.type ?? '');

          if (type === 'session_started') {
            ready = true;
            resolve();
            return;
          }

          if (type === 'partial_transcript') {
            const text = String(event.text ?? '').trim();
            if (!text) return;
            emit({
              source: 'elevenlabs',
              text,
              isFinal: false,
              speechFinal: false,
            });
            return;
          }

          if (
            type === 'committed_transcript' ||
            type === 'committed_transcript_with_timestamps'
          ) {
            const text = String(event.text ?? '').trim();
            if (!text) return;
            emit({
              source: 'elevenlabs',
              text,
              isFinal: true,
              speechFinal: true,
            });
            return;
          }

          if (type === 'error' || type === 'auth_error') {
            const err = new Error(String(event.error ?? event.message ?? 'ElevenLabs STT error'));
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
      const pcm16k = twilioMulawToPcm16k(chunk);
      ws.send(
        JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: pcm16k.toString('base64'),
          commit: false,
          sample_rate: 16000,
        })
      );
    },

    close() {
      ws?.close();
      ws = null;
      ready = false;
    },
  };
}
