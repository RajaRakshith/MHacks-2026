import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CallFixture } from "@watchdog/core";
import type { Db } from "./db";
import { REPO_ROOT } from "./env";
import { ANALYZE_MIN_INTERVAL_MS, CallSession, startCall } from "./session";

const FIXTURE_DIR = resolve(REPO_ROOT, "fixtures/calls");

export const DEFAULT_SCENARIO = "refund-overpayment";

export function listScenarios(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadFixture(scenario: string): CallFixture | null {
  // The name becomes a file path, so only plain scenario names are accepted.
  if (!/^[a-z0-9-]+$/.test(scenario)) return null;
  const path = resolve(FIXTURE_DIR, `${scenario}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as CallFixture;
}

export interface SimulationResult {
  callId: string;
  /** False when playback was cut short (End call, or another call started). */
  completed: boolean;
  score: number;
  state: string;
  verdicts: { claim: unknown; claimTrue: boolean; evidence: string }[];
}

interface Active {
  session: CallSession;
  cancel: () => void;
}

let active: Active | null = null;

/** Stops the playback for `callId` (or whatever is playing). The call row is left alone. */
export function cancelSimulation(callId?: bigint): void {
  if (!active) return;
  if (callId !== undefined && active.session.callId !== callId) return;
  active.cancel();
  active = null;
}

export interface SimulateOptions {
  /** 1 is real time. The acceptance script uses a higher speed. */
  speed?: number;
  endWhenDone?: boolean;
}

/**
 * Plays a fixture into Spacetime with real timing: start_call, then each line
 * through add_transcript at its `atMs`, with analyze_call after each caller line.
 */
export async function simulate(conn: Db, fixture: CallFixture, options: SimulateOptions = {}): Promise<{ callId: bigint; done: Promise<SimulationResult> }> {
  cancelSimulation();
  const speed = Math.min(Math.max(options.speed ?? 1, 0.25), 50);

  const callId = await startCall(conn, fixture.callerNumber);
  const session = new CallSession(conn, callId, ANALYZE_MIN_INTERVAL_MS / speed);

  let cancelled = false;
  let wake: (() => void) | null = null;
  const mine: Active = {
    session,
    cancel: () => {
      cancelled = true;
      session.close();
      wake?.();
    },
  };
  active = mine;
  console.log(`[relay] simulate ${fixture.scenario}: call ${callId}, ${fixture.lines.length} lines, speed ${speed}x`);

  const waitUntil = (at: number): Promise<void> =>
    new Promise((res) => {
      const ms = at - Date.now();
      if (ms <= 0 || cancelled) return res();
      const timer = setTimeout(res, ms);
      wake = () => {
        clearTimeout(timer);
        res();
      };
    });

  const done = (async (): Promise<SimulationResult> => {
    const t0 = Date.now();
    let completed = false;
    try {
      for (const line of [...fixture.lines].sort((a, b) => a.atMs - b.atMs)) {
        await waitUntil(t0 + line.atMs / speed);
        if (cancelled) break;
        await session.addLine(line.speaker, line.text, line.atMs, line.labels);
      }
      if (!cancelled) {
        await session.idle();
        completed = !cancelled;
        if (options.endWhenDone) await conn.reducers.endCall({ callId });
      }
    } catch (e) {
      console.warn(`[relay] simulate ${fixture.scenario} stopped: ${e instanceof Error ? e.message : String(e)}`);
      cancelled = true;
    } finally {
      session.close();
      if (active === mine) active = null;
    }
    const row = conn.db.call.id.find(callId);
    const verdicts = [...conn.db.verdict.iter()]
      .filter((v) => v.callId === callId)
      .map((v) => ({ claim: JSON.parse(v.claimJson) as unknown, claimTrue: v.claimTrue, evidence: v.evidence }));
    return { callId: callId.toString(), completed, score: row?.score ?? 0, state: row?.state ?? "idle", verdicts };
  })();

  return { callId, done };
}
