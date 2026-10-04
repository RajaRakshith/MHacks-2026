import { SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { RISK_HOLD_THRESHOLD } from './constants';
import { spacetimedb } from './schema';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

export function getRiskHoldThreshold(ctx: Ctx): number {
  const row = ctx.db.config.id.find(0);
  return row?.riskHoldThreshold ?? RISK_HOLD_THRESHOLD;
}

export function findActiveCallSession(ctx: Ctx, userId: string) {
  // userId is a single-column btree index. byUserAndStatus is a 2-column
  // index; passing only a string there is treated as an iterable of chars
  // and crashes the module ("too many elements").
  for (const session of ctx.db.callSessions.userId.filter(userId)) {
    if (session.status.tag === 'Active') {
      return session;
    }
  }
  return null;
}

export function requireCallSession(ctx: Ctx, sessionId: bigint) {
  const session = ctx.db.callSessions.id.find(sessionId);
  if (!session) {
    throw new SenderError(`Call session ${sessionId} not found`);
  }
  return session;
}

export function requireTransferIntent(ctx: Ctx, intentId: bigint) {
  const intent = ctx.db.transferIntents.id.find(intentId);
  if (!intent) {
    throw new SenderError(`Transfer intent ${intentId} not found`);
  }
  return intent;
}

export function buildHoldReason(riskScore: number, threshold: number): string {
  return `Transfer held: active call risk score is ${riskScore}% (threshold ${threshold}%). Do not send money while this call is active.`;
}
