// SpacetimeDB over HTTP, against the module in ../spacetimedb (the one with the request_transfer money gate).
// Docs: https://spacetimedb.com/docs/http/database   Arg encoding: https://spacetimedb.com/docs/sats-json
//
// Reducer args are a JSON array in declaration order; option<T> is {"some": v} / {"none": []}.

// Accepts either the bridge's names (SPACETIME_HOST/SPACETIME_DB) or the repo root's (SPACETIME_URI/SPACETIME_DATABASE).
function baseUrl() {
  const raw = process.env.SPACETIME_HOST || process.env.SPACETIME_URI || 'http://127.0.0.1:3000';
  return raw.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/$/, '');
}
const dbName = () => process.env.SPACETIME_DB || process.env.SPACETIME_DATABASE || 'watchdog-dev';

const some = (v) => (v === undefined || v === null || v === '' ? { none: [] } : { some: v });

async function post(path, body, contentType) {
  const headers = { 'Content-Type': contentType };
  if (process.env.SPACETIME_TOKEN) headers.Authorization = `Bearer ${process.env.SPACETIME_TOKEN}`;
  const res = await fetch(`${baseUrl()}/v1/database/${dbName()}/${path}`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`SpacetimeDB ${path} ${res.status}: ${await res.text()}`);
  return res;
}

export async function callReducer(reducer, args) {
  await post(`call/${reducer}`, JSON.stringify(args), 'application/json');
}

// Runs SQL and returns rows as objects keyed by column name.
export async function sql(query) {
  const res = await post('sql', query, 'text/plain');
  const [result] = await res.json();
  if (!result) return [];
  const cols = result.schema.elements.map((e) => (typeof e.name === 'string' ? e.name : e.name?.some ?? e.name?.['0']));
  return result.rows.map((row) => (Array.isArray(row) ? Object.fromEntries(cols.map((c, i) => [c, row[i]])) : row));
}

// SATS-JSON sums arrive two ways:
//   named (reducer args / some HTTP): { some: v } / { none: [] } / { Active: [] }
//   positional (Maincloud SQL):       [0, v] / [1, []] for option; [0, []] Active, [1, []] Ended
export function unwrapOption(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v[0] === 0 ? v[1] : null;
  if ('some' in v) return v.some;
  if ('none' in v) return null;
  if ('0' in v) return v['0'];
  if ('1' in v) return null;
  return v;
}
const field = (row, camel) => row[camel] ?? row[camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)];
export function isActive(status) {
  if (status == null) return false;
  if (status === 'Active' || status === 0) return true;
  if (typeof status !== 'object') return false;
  if (Array.isArray(status)) return status[0] === 0;
  return status.tag === 'Active' || 'Active' in status;
}

// ---- Call lifecycle (reducers from spacetimedb/src/index.ts) ----

// start_call_session doesn't return the new row's id, so look it up by Twilio CallSid afterwards.
export async function startCallSession({ userId, callerNumber, callSid }) {
  await callReducer('start_call_session', [userId, some(callerNumber), some(callSid)]);
  const rows = await sql('SELECT * FROM call_sessions');
  const row = rows.find((r) => unwrapOption(field(r, 'twilioCallSid')) === callSid && isActive(field(r, 'status')));
  if (!row) throw new Error(`start_call_session ok but no active call_sessions row for ${callSid}`);
  return Number(field(row, 'id'));
}

export function appendTranscriptSegment(sessionId, { text, source, isFinal = true }) {
  return callReducer('append_transcript_segment', [sessionId, text, source, isFinal]);
}

// Appends to the risk timeline AND sets call_sessions.risk_score, which request_transfer checks.
export function recordRiskEvent(sessionId, { signalType, transcriptExcerpt, riskScore, warning }) {
  return callReducer('record_risk_event', [sessionId, signalType, transcriptExcerpt, riskScore, some(warning)]);
}

export function endCallSession(sessionId) {
  return callReducer('end_call_session', [sessionId]);
}
