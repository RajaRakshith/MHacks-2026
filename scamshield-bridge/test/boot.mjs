import { missingApiKeys } from '../src/keys.js';
import { check } from './mocks.mjs';

const saved = {
  XAI_API_KEY: process.env.XAI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
};

delete process.env.XAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.ELEVENLABS_API_KEY;
check('all three reported when unset',
  JSON.stringify(missingApiKeys().sort()) === JSON.stringify(['ELEVENLABS_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY']),
  missingApiKeys());

process.env.XAI_API_KEY = 'k';
process.env.GEMINI_API_KEY = 'g';
process.env.ELEVENLABS_API_KEY = '';
check('empty string counts as missing',
  JSON.stringify(missingApiKeys()) === JSON.stringify(['ELEVENLABS_API_KEY']),
  missingApiKeys());

process.env.ELEVENLABS_API_KEY = 'x';
check('none missing when all set', missingApiKeys().length === 0, missingApiKeys());

Object.assign(process.env, saved);
process.exit();
