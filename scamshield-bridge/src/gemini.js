import { SCORING_GUIDE, normalizeRisk } from './risk.js';

export async function scoreWithGemini(transcript, prevScore = 0) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const base = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const url = `${base}/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: `You are ScamShield, a fraud analyst scoring a live phone call transcript for scam risk.\n${SCORING_GUIDE}\nReturn JSON only. Required JSON keys: score (0-100 integer), signals (from the known list), action, warning, evidence.` }],
      },
      contents: [{
        role: 'user',
        parts: [{ text: `The previous score was ${prevScore}.\n\n${transcript}` }],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'low' },
      },
    }),
    signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS || 8000)),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini response missing text');
  const parsed = JSON.parse(text);
  if (parsed == null || typeof parsed.score !== 'number' || !Number.isFinite(parsed.score)) {
    throw new Error('Gemini response missing score');
  }
  return normalizeRisk(parsed);
}
