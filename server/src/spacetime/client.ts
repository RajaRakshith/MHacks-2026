/**
 * SpacetimeDB client for the ingestion server.
 * Requires generated bindings: npm run spacetime:generate
 */

import { config } from '../config.js';
import { loadDbConnectionClass } from './load-bindings.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbConn = any;

let conn: DbConn | null = null;
let sessionId: bigint | null = null;
let connectPromise: Promise<DbConn> | null = null;

async function connect(): Promise<DbConn> {
  if (conn) return conn;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const DbConnection = await loadDbConnectionClass();

    return await new Promise<DbConn>((resolve, reject) => {
      const builder = DbConnection.builder()
        .withUri(config.spacetimeUri)
        .withDatabaseName(config.spacetimeDatabase)
        .onConnect((c: DbConn) => {
          conn = c;
          console.log(`[spacetime] connected (${config.spacetimeDatabase})`);
          resolve(c);
        })
        .onConnectError((_ctx: unknown, err: Error) => reject(err));

      if (config.spacetimeToken) {
        builder.withToken(config.spacetimeToken);
      }

      builder.build();
    });
  })();

  return connectPromise;
}

export async function ensureSpacetimeConnected() {
  await connect();
}

export function getActiveSessionId() {
  return sessionId;
}

export async function startCallSession(args: {
  userId: string;
  callerNumber?: string;
  twilioCallSid?: string;
}): Promise<bigint> {
  const c = await connect();

  const idPromise = new Promise<bigint>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for call session insert')),
      5000
    );

    const handler = (_ctx: unknown, row: { id: bigint; userId: string }) => {
      if (row.userId !== args.userId) return;
      clearTimeout(timeout);
      c.db.callSessions.removeOnInsert(handler);
      resolve(row.id);
    };

    c.db.callSessions.onInsert(handler);
  });

  c.reducers.startCallSession({
    userId: args.userId,
    callerNumber: args.callerNumber,
    twilioCallSid: args.twilioCallSid,
  });

  sessionId = await idPromise;
  console.log(`[spacetime] call session ${sessionId} for user ${args.userId}`);
  return sessionId;
}

export async function appendTranscript(args: {
  text: string;
  source: string;
  isFinal: boolean;
}) {
  if (!sessionId) return;
  const c = await connect();
  c.reducers.appendTranscriptSegment({
    sessionId,
    text: args.text,
    source: args.source,
    isFinal: args.isFinal,
  });
}

export async function recordRisk(args: {
  signalType: string;
  transcriptExcerpt: string;
  riskScoreAfter: number;
  warningMessage?: string;
}) {
  if (!sessionId) return;
  const c = await connect();
  c.reducers.recordRiskEvent({
    sessionId,
    signalType: args.signalType,
    transcriptExcerpt: args.transcriptExcerpt,
    riskScoreAfter: args.riskScoreAfter,
    warningMessage: args.warningMessage,
  });
}

export async function endCallSession() {
  if (!sessionId) return;
  const c = await connect();
  c.reducers.endCallSession({ sessionId });
  console.log(`[spacetime] ended call session ${sessionId}`);
  sessionId = null;
}
