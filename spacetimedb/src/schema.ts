import { schema, table, t } from 'spacetimedb/server';

export const CallSessionStatus = t.enum('CallSessionStatus', {
  Active: t.unit(),
  Ended: t.unit(),
});

export const TransferIntentStatus = t.enum('TransferIntentStatus', {
  Pending: t.unit(),
  Approved: t.unit(),
  Held: t.unit(),
  Completed: t.unit(),
  Failed: t.unit(),
  Released: t.unit(),
});

export const callSession = table(
  {
    name: 'call_sessions',
    public: true,
    indexes: [
      {
        name: 'byUserAndStatus',
        algorithm: 'btree',
        columns: ['userId', 'status'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    userId: t.string().index('btree'),
    startedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
    riskScore: t.u8(),
    status: CallSessionStatus,
    callerNumber: t.option(t.string()),
    twilioCallSid: t.option(t.string()),
  }
);

export const riskEvent = table(
  {
    name: 'risk_events',
    public: true,
    indexes: [
      {
        name: 'bySession',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
      {
        name: 'byUser',
        algorithm: 'btree',
        columns: ['userId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    userId: t.string(),
    occurredAt: t.timestamp(),
    signalType: t.string(),
    transcriptExcerpt: t.string(),
    riskScoreAfter: t.u8(),
    warningMessage: t.option(t.string()),
  }
);

export const transferIntent = table(
  {
    name: 'transfer_intents',
    public: true,
    indexes: [
      {
        name: 'byUser',
        algorithm: 'btree',
        columns: ['userId'],
      },
      {
        name: 'byStatus',
        algorithm: 'btree',
        columns: ['status'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    userId: t.string(),
    sessionId: t.option(t.u64()),
    requestedAt: t.timestamp(),
    amountCents: t.u64(),
    destinationAccount: t.string(),
    memo: t.option(t.string()),
    status: TransferIntentStatus,
    holdReason: t.option(t.string()),
    riskScoreAtDecision: t.u8(),
    nessieTransferId: t.option(t.string()),
    completedAt: t.option(t.timestamp()),
  }
);

export const transcriptSegment = table(
  {
    name: 'transcript_segments',
    public: true,
    indexes: [
      {
        name: 'bySession',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    userId: t.string(),
    occurredAt: t.timestamp(),
    text: t.string(),
    source: t.string(),
    isFinal: t.bool(),
  }
);

export const config = table(
  {
    name: 'config',
    public: true,
  },
  {
    id: t.u8().primaryKey(),
    riskHoldThreshold: t.u8(),
  }
);

export const spacetimedb = schema(
  callSession,
  riskEvent,
  transcriptSegment,
  transferIntent,
  config
);

export default spacetimedb;
