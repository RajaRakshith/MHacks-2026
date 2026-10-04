/**
 * TTS integration hooks for watchdog-bridge.
 *
 * CallSession calls playScamWarning() once when risk reaches TTS_WARNING_SCORE;
 * POST /calls/:callSid/warn forces it during a live call.
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
