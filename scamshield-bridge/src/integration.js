/**
 * TTS integration hooks for scamshield-bridge (merge branch).
 *
 * After merging the main bridge from LocalServer / twilio branch, wire these
 * into CallSession — see docs/MERGE.md.
 */

import { playScamWarningOnCall } from './tts.js';

/**
 * @param {object} session — active CallSession from the bridge
 * @param {import('ws').WebSocket} session.twilioWs
 * @param {string} session.streamSid
 * @param {boolean} [session.scamWarningPlayed]
 */
export async function playScamWarning(session, { force = false } = {}) {
  if (session.scamWarningPlayed && !force) return false;
  if (!session.streamSid || session.twilioWs?.readyState !== 1) return false;

  session.scamWarningPlayed = true;
  try {
    await playScamWarningOnCall(session.twilioWs, session.streamSid);
    return true;
  } catch (err) {
    session.scamWarningPlayed = false;
    throw err;
  }
}

/**
 * Called when the future call-score / scam-detection pipeline fires.
 * Wire your scorer to call this — do not implement scoring here yet.
 */
export async function onScamDetected(session, _details = {}) {
  return playScamWarning(session);
}
