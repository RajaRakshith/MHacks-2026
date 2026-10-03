/** Gemini call analyzer (section 3.4): transcript window in, tactics and claims out. */

import { parseAnalyzerOutput, TACTICS, type AnalyzerOutput } from '@scamshield/core';
import { httpJson, type Http } from './http';

// A fast, stable Flash-Lite model keeps a red flag under 5 seconds from phrase to UI. Override with GEMINI_MODEL.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

const SYSTEM_PROMPT = `You analyze a live phone call for a bank's scam-call guard. The bank customer is on the phone with a caller who may be a scammer.

You get the most recent part of the transcript and the caller's number. Lines are labeled "Caller" or "You" (the customer). On live calls the audio is mixed, so a line may carry the wrong label; use the content to decide who is speaking.

Return JSON with:
- tactics: every scam tactic the CALLER uses in this window. Only use these values:
  - bank_impersonation: claims to be the customer's bank, its fraud or security department
  - government_impersonation: claims to be a government agency, police, tax office, Social Security, a court
  - urgency: pressure to act right now, deadlines, threats of account freezes, arrest, or shutoff
  - secrecy: tells the customer not to tell family, the bank, or store staff
  - unusual_payment: asks for payment by gift cards, wire transfer, crypto, or cash
  - remote_access: asks the customer to install an app, share their screen, or allow remote control
  - credential_request: asks for a PIN, password, full card or account number, or a one-time code
  - stay_on_line: tells the customer to stay on the phone and not hang up
  - refund_overpayment: says money was sent or refunded by mistake and must be sent back
- claims: every checkable statement the CALLER makes about the customer's account:
  - { "kind": "deposit", "amount": number } for a deposit, refund, or credit the caller says was made
  - { "kind": "charge", "merchant": string, "amount": number, "location": string } for a purchase or charge the caller says happened; omit fields that were not stated
  - { "kind": "bill", "payee": string, "amount": number, "overdue": boolean } for a bill the caller says is owed; payee is the company name. Only report it once the caller has stated an amount or said it is overdue or past due
- digitsSpoken: only if the CUSTOMER read out digits of a card or account number, those digits with no spaces. A masked number such as "•••• 1234" counts: return "1234". Otherwise omit it.

An ordinary call (a pharmacy, a friend, an appointment reminder) has no tactics and no claims. Do not guess: report only what was actually said.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tactics: { type: 'ARRAY', items: { type: 'STRING', enum: [...TACTICS] } },
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['charge', 'deposit', 'bill'] },
          merchant: { type: 'STRING' },
          amount: { type: 'NUMBER' },
          location: { type: 'STRING' },
          payee: { type: 'STRING' },
          overdue: { type: 'BOOLEAN' },
        },
        required: ['kind'],
      },
    },
    digitsSpoken: { type: 'STRING' },
  },
  required: ['tactics', 'claims'],
};

export interface TranscriptLine {
  speaker: string;
  text: string;
}

export function analyzeWithGemini(
  http: Http,
  apiKey: string,
  model: string,
  callerNumber: string,
  lines: readonly TranscriptLine[]
): { ok: true; output: AnalyzerOutput } | { ok: false; error: string } {
  const transcript = lines.map((l) => `${l.speaker === 'customer' ? 'You' : 'Caller'}: ${l.text}`).join('\n');
  const request = {
    method: 'POST' as const,
    headers: { 'x-goog-api-key': apiKey },
    timeoutMs: 6_000,
    body: {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `Caller number: ${callerNumber || 'unknown'}\n\nTranscript:\n${transcript}` }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    },
  };
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let res = httpJson(http, endpoint, request);
  // Seen against the live API: an occasional timeout or 403 that succeeds when repeated. Try once more.
  if (!res.ok && (res.status === 0 || res.status === 403 || res.status === 429 || res.status >= 500)) res = httpJson(http, endpoint, request);
  if (!res.ok) return { ok: false, error: res.error ?? 'Gemini request failed' };

  const body = res.json as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | undefined;
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  try {
    return { ok: true, output: parseAnalyzerOutput(JSON.parse(text)) };
  } catch {
    return { ok: false, error: 'Gemini did not return JSON' };
  }
}
