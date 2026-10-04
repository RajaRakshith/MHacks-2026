import { Timestamp } from 'spacetimedb';
import { SenderError, t } from 'spacetimedb/server';
import { INITIAL_RISK_SCORE, RISK_HOLD_THRESHOLD } from './constants';
import {
  buildHoldReason,
  findActiveCallSession,
  requireCallSession,
  requireTransferIntent,
  getRiskHoldThreshold,
} from './helpers';
import { canExpireHeld, HOLD_TTL_MS, shouldHold } from './policy';
import { spacetimedb } from './schema';

export { spacetimedb } from './schema';
export default spacetimedb;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

spacetimedb.init(ctx => {
  if (!ctx.db.config.id.find(0)) {
    ctx.db.config.insert({ id: 0, riskHoldThreshold: RISK_HOLD_THRESHOLD });
  }
});

spacetimedb.clientConnected(_ctx => {
  // Clients subscribe via SQL in the SDK.
});

spacetimedb.clientDisconnected(_ctx => {
  // No-op.
});

// ---------------------------------------------------------------------------
// Call sessions
// ---------------------------------------------------------------------------

spacetimedb.reducer(
  'start_call_session',
  {
    userId: t.string(),
    callerNumber: t.option(t.string()),
    twilioCallSid: t.option(t.string()),
  },
  (ctx, { userId, callerNumber, twilioCallSid }) => {
    const existing = findActiveCallSession(ctx, userId);
    if (existing) {
      existing.status = { tag: 'Ended' };
      existing.endedAt = ctx.timestamp;
      ctx.db.callSessions.id.update(existing);
    }

    ctx.db.callSessions.insert({
      id: 0n,
      userId,
      startedAt: ctx.timestamp,
      endedAt: undefined,
      riskScore: INITIAL_RISK_SCORE,
      status: { tag: 'Active' },
      callerNumber,
      twilioCallSid,
    });
  }
);

spacetimedb.reducer(
  'end_call_session',
  { sessionId: t.u64() },
  (ctx, { sessionId }) => {
    const session = requireCallSession(ctx, sessionId);
    if (session.status.tag === 'Ended') {
      return;
    }
    session.status = { tag: 'Ended' };
    session.endedAt = ctx.timestamp;
    ctx.db.callSessions.id.update(session);
  }
);

spacetimedb.reducer(
  'update_risk_score',
  { sessionId: t.u64(), riskScore: t.u8() },
  (ctx, { sessionId, riskScore }) => {
    if (riskScore > 100) {
      throw new SenderError('risk_score must be between 0 and 100');
    }
    const session = requireCallSession(ctx, sessionId);
    if (session.status.tag !== 'Active') {
      throw new SenderError('Cannot update risk on an ended call session');
    }
    session.riskScore = riskScore;
    ctx.db.callSessions.id.update(session);
  }
);

// ---------------------------------------------------------------------------
// Risk events
// ---------------------------------------------------------------------------

spacetimedb.reducer(
  'record_risk_event',
  {
    sessionId: t.u64(),
    signalType: t.string(),
    transcriptExcerpt: t.string(),
    riskScoreAfter: t.u8(),
    warningMessage: t.option(t.string()),
  },
  (ctx, args) => {
    if (args.riskScoreAfter > 100) {
      throw new SenderError('risk_score_after must be between 0 and 100');
    }
    const session = requireCallSession(ctx, args.sessionId);
    if (session.status.tag !== 'Active') {
      throw new SenderError('Cannot record events on an ended call session');
    }

    ctx.db.riskEvents.insert({
      id: 0n,
      sessionId: args.sessionId,
      userId: session.userId,
      occurredAt: ctx.timestamp,
      signalType: args.signalType,
      transcriptExcerpt: args.transcriptExcerpt,
      riskScoreAfter: args.riskScoreAfter,
      warningMessage: args.warningMessage,
    });

    session.riskScore = args.riskScoreAfter;
    ctx.db.callSessions.id.update(session);
  }
);

// ---------------------------------------------------------------------------
// Transcript segments — live + final text from STT pipelines
// ---------------------------------------------------------------------------

spacetimedb.reducer(
  'append_transcript_segment',
  {
    sessionId: t.u64(),
    text: t.string(),
    source: t.string(),
    isFinal: t.bool(),
  },
  (ctx, { sessionId, text, source, isFinal }) => {
    const session = requireCallSession(ctx, sessionId);
    ctx.db.transcriptSegments.insert({
      id: 0n,
      sessionId,
      userId: session.userId,
      occurredAt: ctx.timestamp,
      text,
      source,
      isFinal,
    });
  }
);

// ---------------------------------------------------------------------------
// Transfer intents — atomic money gate
// ---------------------------------------------------------------------------

spacetimedb.reducer(
  'request_transfer',
  {
    userId: t.string(),
    amountCents: t.u64(),
    destinationAccount: t.string(),
    memo: t.option(t.string()),
  },
  (ctx, { userId, amountCents, destinationAccount, memo }) => {
    if (amountCents <= 0n) {
      throw new SenderError('amount_cents must be positive');
    }

    const threshold = getRiskHoldThreshold(ctx);
    const activeSession = findActiveCallSession(ctx, userId);
    const riskScore = activeSession?.riskScore ?? 0;
    const shouldHoldNow = shouldHold(activeSession !== null, riskScore, threshold);

    ctx.db.transferIntents.insert({
      id: 0n,
      userId,
      sessionId: activeSession?.id,
      requestedAt: ctx.timestamp,
      amountCents,
      destinationAccount,
      memo,
      status: shouldHoldNow ? { tag: 'Held' } : { tag: 'Approved' },
      holdReason: shouldHoldNow
        ? buildHoldReason(riskScore, threshold)
        : undefined,
      riskScoreAtDecision: riskScore,
      nessieTransferId: undefined,
      completedAt: undefined,
      expiresAt: shouldHoldNow
        ? Timestamp.fromDate(new Date(ctx.timestamp.toDate().getTime() + HOLD_TTL_MS))
        : undefined,
    });
  }
);

spacetimedb.reducer(
  'complete_transfer',
  { intentId: t.u64(), nessieTransferId: t.string() },
  (ctx, { intentId, nessieTransferId }) => {
    const intent = requireTransferIntent(ctx, intentId);
    if (intent.status.tag !== 'Approved') {
      throw new SenderError(
        `Cannot complete transfer in status ${intent.status.tag}`
      );
    }
    intent.status = { tag: 'Completed' };
    intent.nessieTransferId = nessieTransferId;
    intent.completedAt = ctx.timestamp;
    ctx.db.transferIntents.id.update(intent);
  }
);

spacetimedb.reducer(
  'fail_transfer',
  { intentId: t.u64(), reason: t.string() },
  (ctx, { intentId, reason }) => {
    const intent = requireTransferIntent(ctx, intentId);
    if (intent.status.tag !== 'Approved') {
      throw new SenderError(
        `Cannot fail transfer in status ${intent.status.tag}`
      );
    }
    intent.status = { tag: 'Failed' };
    intent.holdReason = reason;
    ctx.db.transferIntents.id.update(intent);
  }
);

spacetimedb.reducer(
  'release_held_transfer',
  { intentId: t.u64(), force: t.bool() },
  (ctx, { intentId, force }) => {
    const intent = requireTransferIntent(ctx, intentId);
    if (intent.status.tag !== 'Held') {
      throw new SenderError('Transfer is not held');
    }

    const threshold = getRiskHoldThreshold(ctx);
    const activeSession = findActiveCallSession(ctx, intent.userId);
    const riskScore = activeSession?.riskScore ?? 0;
    const stillHot = activeSession !== null && riskScore >= threshold;

    if (stillHot && !force) {
      throw new SenderError(buildHoldReason(riskScore, threshold));
    }

    intent.status = { tag: 'Approved' };
    intent.holdReason =
      force && stillHot ? `User override at ${riskScore}% risk` : undefined;
    intent.riskScoreAtDecision = riskScore;
    ctx.db.transferIntents.id.update(intent);
  }
);

spacetimedb.reducer('expire_held_transfer', { intentId: t.u64() }, (ctx, { intentId }) => {
  const intent = requireTransferIntent(ctx, intentId);
  const expiresAtMs = intent.expiresAt ? intent.expiresAt.toDate().getTime() : null;
  if (!canExpireHeld(intent.status.tag, expiresAtMs, ctx.timestamp.toDate().getTime())) {
    throw new SenderError('Transfer is not a due hold');
  }
  intent.status = { tag: 'Expired' };
  ctx.db.transferIntents.id.update(intent);
});

spacetimedb.reducer(
  'upsert_account_snapshot',
  { name: t.string(), nickname: t.string(), last4: t.string(), balance: t.f64() },
  (ctx, args) => {
    const row = ctx.db.accountSnapshot.id.find(0);
    const next = { id: 0, ...args, updatedAt: ctx.timestamp };
    if (row) ctx.db.accountSnapshot.id.update({ ...row, ...next });
    else ctx.db.accountSnapshot.insert(next);
  }
);

const ActivityRow = t.object('ActivityRow', {
  id: t.string(),
  kind: t.string(),
  date: t.string(),
  description: t.string(),
  amount: t.f64(),
  sortIndex: t.u32(),
});

spacetimedb.reducer('replace_activity', { rows: t.array(ActivityRow) }, (ctx, { rows }) => {
  for (const old of [...ctx.db.activity.iter()]) ctx.db.activity.id.delete(old.id);
  for (const row of rows) ctx.db.activity.insert(row);
});

spacetimedb.reducer(
  'upsert_payee',
  { name: t.string(), nessieAccountId: t.string(), trusted: t.bool() },
  (ctx, { name, nessieAccountId, trusted }) => {
    const row = ctx.db.payees.name.find(name);
    if (row) ctx.db.payees.name.update({ ...row, nessieAccountId, trusted });
    else ctx.db.payees.insert({ name, nessieAccountId, trusted });
  }
);

spacetimedb.reducer(
  'set_risk_hold_threshold',
  { threshold: t.u8() },
  (ctx, { threshold }) => {
    if (threshold > 100) {
      throw new SenderError('threshold must be between 0 and 100');
    }
    const row = ctx.db.config.id.find(0);
    if (row) {
      row.riskHoldThreshold = threshold;
      ctx.db.config.id.update(row);
    } else {
      ctx.db.config.insert({ id: 0, riskHoldThreshold: threshold });
    }
  }
);
