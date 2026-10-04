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
