export type SttSource = 'grok' | 'elevenlabs';

export type TranscriptEvent = {
  source: SttSource;
  text: string;
  isFinal: boolean;
  speechFinal: boolean;
};

export type SttPipeline = {
  source: SttSource;
  connect(): Promise<void>;
  sendMulawAudio(chunk: Buffer): void;
  close(): void;
  onTranscript(handler: (event: TranscriptEvent) => void): void;
  onError(handler: (err: Error) => void): void;
  onClose(handler: () => void): void;
};
