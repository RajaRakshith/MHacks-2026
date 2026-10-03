import { config } from '../config.js';
import { createElevenLabsSttPipeline } from './elevenlabs-stt.js';
import { createGrokSttPipeline } from './grok-stt.js';
import type { SttPipeline, SttSource, TranscriptEvent } from './types.js';

export type RedundantSttOptions = {
  onTranscript: (event: TranscriptEvent) => void;
  onSourceChange?: (source: SttSource) => void;
  onError?: (source: SttSource, err: Error) => void;
};

/**
 * Grok is primary; ElevenLabs is hot standby.
 * Failover triggers on Grok errors or no Grok activity within STT_FAILOVER_MS.
 */
export class RedundantSttRouter {
  private primary = createGrokSttPipeline();
  private backup = createElevenLabsSttPipeline();
  private active: SttPipeline = this.primary;
  private lastGrokActivity = Date.now();
  private failoverTimer: ReturnType<typeof setInterval> | null = null;
  private usingBackup = false;

  constructor(private opts: RedundantSttOptions) {}

  async start() {
    await this.primary.connect();
    this.lastGrokActivity = Date.now();
    this.wirePipeline(this.primary);

    // Pre-connect backup so failover is fast, but don't emit its transcripts yet.
    this.backup.connect().catch(err => {
      console.warn('[redundant-stt] backup pre-connect failed:', err.message);
    });

    this.failoverTimer = setInterval(() => this.checkFailover(), 1000);
  }

  private wirePipeline(pipeline: SttPipeline) {
    pipeline.onTranscript(event => {
      if (pipeline.source === 'grok') {
        this.lastGrokActivity = Date.now();
      }
      if (pipeline === this.active) {
        this.opts.onTranscript(event);
      }
    });

    pipeline.onError(err => {
      this.opts.onError?.(pipeline.source, err);
      if (pipeline.source === 'grok' && !this.usingBackup) {
        void this.switchToBackup(`grok error: ${err.message}`);
      }
    });

    pipeline.onClose(() => {
      if (pipeline.source === 'grok' && !this.usingBackup) {
        void this.switchToBackup('grok connection closed');
      }
    });
  }

  private checkFailover() {
    if (this.usingBackup) return;
    const idleMs = Date.now() - this.lastGrokActivity;
    if (idleMs > config.sttFailoverMs) {
      void this.switchToBackup(`grok idle ${idleMs}ms`);
    }
  }

  private async switchToBackup(reason: string) {
    if (this.usingBackup) return;
    this.usingBackup = true;
    console.warn(`[redundant-stt] failing over to ElevenLabs: ${reason}`);

    try {
      if (this.backup) {
        await this.backup.connect().catch(() => undefined);
      }
    } catch {
      // backup connect errors logged in pipeline
    }

    this.active = this.backup;
    this.opts.onSourceChange?.('elevenlabs');
  }

  sendMulawAudio(chunk: Buffer) {
    this.active.sendMulawAudio(chunk);
  }

  close() {
    if (this.failoverTimer) clearInterval(this.failoverTimer);
    this.primary.close();
    this.backup.close();
  }
}
