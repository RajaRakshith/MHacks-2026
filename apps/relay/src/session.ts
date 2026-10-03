import { redactAnalyzerOutput, redactDigits, type AnalyzerOutput, type Speaker } from "@scamshield/core";
import type { Db } from "./db";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Section 3, step 3: analyze after each final caller utterance, at most every 3 seconds. */
export const ANALYZE_MIN_INTERVAL_MS = 3000;

/** Creates the call row and returns its id. Reducers return nothing, so the id comes from the subscription. */
export async function startCall(conn: Db, callerNumber: string): Promise<bigint> {
  let before = 0n;
  for (const row of conn.db.call.iter()) if (row.id > before) before = row.id;
  await conn.reducers.startCall({ callerNumber });
  for (let i = 0; i < 100; i++) {
    let newest: bigint | null = null;
    for (const row of conn.db.call.iter()) {
      if (row.id > before && row.endedAt === undefined && (newest === null || row.id > newest)) newest = row.id;
    }
    if (newest !== null) return newest;
    await sleep(20);
  }
  throw new Error("start_call did not produce a call row.");
}

/** One call in progress: writes transcript lines and keeps analyze_call running at a sane rate. */
export class CallSession {
  readonly startedAt = Date.now();
  private lastStart = 0;
  private running: Promise<void> | null = null;
  private pending = false;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    private readonly conn: Db,
    readonly callId: bigint,
    private readonly minIntervalMs = ANALYZE_MIN_INTERVAL_MS,
  ) {}

  async addLine(speaker: Speaker, text: string, atMs: number, labels?: AnalyzerOutput): Promise<void> {
    if (this.closed) return;
    await this.conn.reducers.addTranscript({
      callId: this.callId,
      speaker,
      // Redacted here too, so a full card number never leaves the relay.
      text: redactDigits(text),
      atMs: Math.max(0, Math.round(atMs)),
      labelsJson: labels ? JSON.stringify(redactAnalyzerOutput(labels)) : undefined,
    });
    if (speaker === "caller") this.requestAnalysis();
  }

  requestAnalysis(): void {
    if (this.closed) return;
    this.pending = true;
    this.pump();
  }

  private pump(): void {
    if (this.running || !this.pending || this.closed) return;
    const wait = this.lastStart + this.minIntervalMs - Date.now();
    if (wait > 0) {
      this.timer ??= setTimeout(() => {
        this.timer = null;
        this.pump();
      }, wait);
      return;
    }
    this.pending = false;
    this.lastStart = Date.now();
    this.running = this.conn.procedures
      .analyzeCall({ callId: this.callId })
      .then((result) => {
        if (result.ok) console.log(`[relay] call ${this.callId}: score ${result.score} (${result.state}) in ${Date.now() - this.lastStart} ms`);
        else console.warn(`[relay] analyze_call: ${result.message}`);
      })
      .catch((e: unknown) => console.warn(`[relay] analyze_call failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        this.running = null;
        this.pump();
      });
  }

  /** Resolves once every requested analysis has finished. */
  async idle(): Promise<void> {
    while (!this.closed && (this.running || this.pending)) {
      if (this.running) await this.running;
      else await sleep(25);
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
