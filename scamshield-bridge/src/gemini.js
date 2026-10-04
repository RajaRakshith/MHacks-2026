import { SCORING_GUIDE, normalizeRisk } from './risk.js';

export async function scoreWithGemini(transcript, prevScore = 0) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const base = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const url = `${base}/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: `You are ScamShield, a fraud analyst scoring a live phone call transcript for scam risk.\n${SCORING_GUIDE}\nReturn JSON only.` }],
      },
      contents: [{
        role: 'user',
        parts: [{ text: `The previous score was ${prevScore}.\n\n${transcript}` }],
      }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS || 8000)),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini response missing text');
  return normalizeRisk(JSON.parse(text));
}
