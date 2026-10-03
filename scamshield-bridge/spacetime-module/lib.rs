// Reducers the bridge calls. Drop into your SpacetimeDB Rust module (src/lib.rs) and adapt.
use spacetimedb::{reducer, table, ReducerContext, Table, Timestamp};

#[table(name = call_sessions, public)]
pub struct CallSession {
    #[primary_key]
    call_sid: String,
    #[index(btree)]
    user_id: String,
    active: bool,
    risk_score: u8,
    last_action: String,  // none | monitor | warn | hold_transfers
    last_warning: String,
    started_at: Timestamp,
    ended_at: Option<Timestamp>,
}

#[table(name = transcript_chunks, public)]
pub struct TranscriptChunk {
    #[primary_key]
    #[auto_inc]
    id: u64,
    #[index(btree)]
    call_sid: String,
    seq: u32,
    start_ms: u64,
    end_ms: u64,
    text: String,
    speaker_text: String, // "speaker_0: ...\nspeaker_1: ..." (empty if diarization off)
    created_at: Timestamp,
}

// Timeline of every risk update (for the post-call report).
#[table(name = risk_events, public)]
pub struct RiskEvent {
    #[primary_key]
    #[auto_inc]
    id: u64,
    #[index(btree)]
    call_sid: String,
    score: u8,
    signals_json: String, // e.g. ["impersonation","otp_request"]
    action: String,
    warning: String,
    evidence: String,
    created_at: Timestamp,
}

#[reducer]
pub fn start_call(ctx: &ReducerContext, call_sid: String, user_id: String) {
    if ctx.db.call_sessions().call_sid().find(&call_sid).is_some() {
        return;
    }
    ctx.db.call_sessions().insert(CallSession {
        call_sid,
        user_id,
        active: true,
        risk_score: 0,
        last_action: "none".into(),
        last_warning: String::new(),
        started_at: ctx.timestamp,
        ended_at: None,
    });
}

#[reducer]
pub fn append_transcript(
    ctx: &ReducerContext,
    call_sid: String,
    seq: u32,
    start_ms: u64,
    end_ms: u64,
    text: String,
    speaker_text: String,
) {
    ctx.db.transcript_chunks().insert(TranscriptChunk {
        id: 0, // auto_inc
        call_sid,
        seq,
        start_ms,
        end_ms,
        text,
        speaker_text,
        created_at: ctx.timestamp,
    });
}

#[reducer]
pub fn end_call(ctx: &ReducerContext, call_sid: String) {
    if let Some(mut s) = ctx.db.call_sessions().call_sid().find(&call_sid) {
        s.active = false;
        s.ended_at = Some(ctx.timestamp);
        ctx.db.call_sessions().call_sid().update(s);
    }
}

#[reducer]
pub fn update_risk(
    ctx: &ReducerContext,
    call_sid: String,
    score: u8,
    signals_json: String,
    action: String,
    warning: String,
    evidence: String,
) {
    if let Some(mut s) = ctx.db.call_sessions().call_sid().find(&call_sid) {
        s.risk_score = score;
        s.last_action = action.clone();
        s.last_warning = warning.clone();
        ctx.db.call_sessions().call_sid().update(s);
    }
    ctx.db.risk_events().insert(RiskEvent {
        id: 0,
        call_sid,
        score,
        signals_json,
        action,
        warning,
        evidence,
        created_at: ctx.timestamp,
    });
}
