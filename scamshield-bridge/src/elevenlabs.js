// ElevenLabs Scribe batch speech-to-text. No "agent" needed — just an API key.
// Docs: https://elevenlabs.io/docs/api-reference/speech-to-text/convert

export async function transcribeWav(wavBuffer) {
  const form = new FormData();
  form.append('model_id', process.env.ELEVENLABS_SCRIBE_MODEL || 'scribe_v2');
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'chunk.wav');
  form.append('language_code', process.env.ELEVENLABS_LANGUAGE || 'en');
  form.append('tag_audio_events', 'false');
  // Speaker labels help the risk engine tell scammer vs. victim apart.
  form.append('diarize', process.env.ELEVENLABS_DIARIZE === 'false' ? 'false' : 'true');

  const res = await fetch(`${process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io'}/v1/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${await res.text()}`);
  const data = await res.json();

  return { text: (data.text || '').trim(), speakerText: speakerLines(data.words) };
}

// Collapse word-level output into "speaker_0: ... / speaker_1: ..." lines.
function speakerLines(words) {
  if (!Array.isArray(words) || !words.some((w) => w.speaker_id)) return '';
  const lines = [];
  let cur = null;
  for (const w of words) {
    if (w.type === 'spacing') { if (cur) cur.text += w.text; continue; }
    if (w.type !== 'word') continue;
    if (!cur || cur.speaker !== w.speaker_id) {
      cur = { speaker: w.speaker_id, text: w.text };
      lines.push(cur);
    } else cur.text += w.text;
  }
  return lines.map((l) => `${l.speaker}: ${l.text.trim()}`).join('\n');
}
