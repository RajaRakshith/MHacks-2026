// Smoke test: synthesize scam warning (requires ELEVENLABS_API_KEY in env or .env).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesizeScamWarning } from '../src/tts.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dir, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const audio = await synthesizeScamWarning();
const out = path.join(__dir, '..', 'scam-warning.ulaw');
fs.writeFileSync(out, audio);
console.log(`wrote ${out} (${audio.length} bytes, µ-law 8 kHz)`);
