// Shared risk-scoring definitions, used by both engines so SpacetimeDB always gets the same shape:
//   { score 0-100, signals[], action, warning, evidence }
//
// Grok Voice scores live via the report_risk tool. When we've failed over to ElevenLabs,
// scoreTranscript() asks Grok's text API instead, and falls back to a keyword heuristic if that fails too.

export const SIGNALS = ['impersonation', 'urgency', 'threat', 'secrecy', 'otp_request',
  'credential_request', 'payment_request', 'transfer_request',
  'remote_access', 'gift_card_or_crypto', 'other'];
export const ACTIONS = ['none', 'monitor', 'warn', 'hold_transfers'];

export const SCORING_GUIDE = `Scoring: 0-20 normal; 21-50 mild red flags; 51-80 clear social engineering; 81-100 active fraud attempt (e.g., asking for a one-time code, PIN, password, gift cards, crypto, or a wire/Zelle transfer "to a safe account").
Signals to look for: impersonation (bank, fraud dept, IRS, police, tech support, family member), urgency or deadlines, threats (arrest, account closure, fines), secrecy ("don't tell anyone / don't hang up"), requests for OTP/verification codes, remote-access apps, unusual payment methods, requests to move money.
Scores should rarely go down unless the conversation clearly becomes benign.
warning: one short, imperative line for the victim, e.g. "DO NOT SHARE THE CODE — your bank will never ask for it." Empty string if score < 40.`;

export const RISK_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    signals: { type: 'array', items: { type: 'string', enum: SIGNALS } },
    action: { type: 'string', enum: ACTIONS },
    warning: { type: 'string' },
    evidence: { type: 'string', description: 'Short quote from the call that justifies the score.' },
  },
  required: ['score', 'signals', 'action', 'warning', 'evidence'],
  additionalProperties: false,
};

export function normalizeRisk(a) {
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(a.score) || 0))),
    signals: (Array.isArray(a.signals) ? a.signals : []).filter((s) => SIGNALS.includes(s)),
    action: ACTIONS.includes(a.action) ? a.action : 'none',
    warning: a.warning || '',
    evidence: a.evidence || '',
  };
}

// Score the whole transcript so far with Grok's text model.
export async function scoreTranscript(transcript, prevScore = 0) {
  try {
    return await scoreWithGrokText(transcript, prevScore);
  } catch (e) {
    const r = heuristicScore(transcript, prevScore);
    r.evidence = r.evidence || `heuristic (grok text failed: ${e.message.slice(0, 80)})`;
    return r;
  }
}

async function scoreWithGrokText(transcript, prevScore) {
  if (!process.env.XAI_API_KEY) throw new Error('no XAI_API_KEY');
  const res = await fetch(`${process.env.XAI_BASE_URL || 'https://api.x.ai'}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.XAI_TEXT_MODEL || process.env.XAI_CHAT_MODEL || 'grok-4-fast-non-reasoning',
      temperature: 0,
      messages: [
        { role: 'system', content: `You are ScamShield, a fraud analyst scoring a live phone call transcript for scam risk.\n${SCORING_GUIDE}\nThe previous score was ${prevScore}.` },
        { role: 'user', content: transcript },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'risk', strict: true, schema: RISK_SCHEMA } },
    }),
    signal: AbortSignal.timeout(Number(process.env.XAI_TEXT_TIMEOUT_MS || 8000)),
  });
  if (!res.ok) throw new Error(`xAI chat ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return normalizeRisk(JSON.parse(data.choices[0].message.content));
}

// Last-resort scorer so the money gate still works if every API is down.
const RULES = [
  ['otp_request', 35, /\b(one[- ]time|verification|security|6[- ]digit)\s*(code|pin|passcode)|read (me )?(the|that) code|code (we|I) (just )?sent/i],
  ['credential_request', 30, /\b(password|pin number|social security|ssn|account number|routing number)\b/i],
  ['transfer_request', 30, /\b(wire|zelle|transfer|move) (the |your )?(money|funds)|safe account\b/i],
  ['gift_card_or_crypto', 30, /\b(gift ?cards?|bitcoin|crypto|btc|usdt)\b/i],
  ['remote_access', 25, /\b(anydesk|teamviewer|remote access|screen ?share)\b/i],
  ['impersonation', 20, /\b(fraud (department|team)|this is (your bank|the irs|the police)|social security administration|tech support)\b/i],
  ['threat', 20, /\b(arrest|warrant|suspend(ed)?|frozen|lawsuit|deport)/i],
  ['urgency', 10, /\b(right now|immediately|urgent|within the hour|before it'?s too late)\b/i],
  ['secrecy', 15, /\b(don'?t tell|keep this (between us|confidential)|don'?t hang up)\b/i],
];

export function heuristicScore(transcript, prevScore = 0) {
  const signals = [];
  let score = 0;
  let evidence = '';
  for (const [signal, weight, re] of RULES) {
    const m = transcript.match(re);
    if (m) { signals.push(signal); score += weight; evidence ||= m[0]; }
  }
  score = Math.max(prevScore, Math.min(100, score));
  const action = score >= 81 ? 'hold_transfers' : score >= 51 ? 'warn' : score >= 21 ? 'monitor' : 'none';
  const warning = score < 40 ? '' : signals.includes('otp_request')
    ? 'DO NOT SHARE THE CODE — your bank will never ask for it.'
    : 'This call shows signs of fraud. Hang up and call your bank directly.';
  return { score, signals, action, warning, evidence };
}
