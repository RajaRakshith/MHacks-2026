export const REQUIRED_API_KEYS = ['XAI_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY'];

export function missingApiKeys() {
  return REQUIRED_API_KEYS.filter((k) => !process.env[k]);
}
