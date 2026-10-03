/**
 * Live calls (M8): Twilio rings the customer, the customer merges the calls,
 * and Twilio streams the mixed audio here. The audio goes to ElevenLabs
 * streaming speech-to-text, and each final utterance becomes a transcript row.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { db } from "./db";
import { env } from "./env";
import { CallSession, startCall } from "./session";
import { cancelSimulation } from "./simulate";

/** Proves a media stream came from TwiML this process issued. */
const STREAM_TOKEN = randomBytes(24).toString("hex");

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function liveConfigProblem(): string | null {
  const missing = [
    ["TWILIO_ACCOUNT_SID", env.twilioSid],
    ["TWILIO_AUTH_TOKEN", env.twilioToken],
    ["TWILIO_NUMBER", env.twilioNumber],
    ["CUSTOMER_PHONE", env.customerPhone],
    ["PUBLIC_URL", env.publicUrl],
    ["ELEVENLABS_API_KEY", env.elevenLabsKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return missing.length ? `Live calls need ${missing.join(", ")} in .env.` : null;
}

/** POST /protect in real mode: Twilio calls the customer's phone from the ScamShield number. */
export async function ringCustomer(): Promise<{ ok: true; callSid: string } | { ok: false; error: string }> {
  const problem = liveConfigProblem();
  if (problem) return { ok: false, error: problem };

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.twilioSid)}/Calls.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${env.twilioSid}:${env.twilioToken}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: env.customerPhone, From: env.twilioNumber, Url: `${env.publicUrl}/twilio/voice`, Method: "POST" }),
  });
  const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok || !body.sid) return { ok: false, error: `Twilio could not place the call (${res.status}): ${body.message ?? "unknown error"}` };
  return { ok: true, callSid: body.sid };
}

/** Twilio signs each webhook: HMAC-SHA1 of the URL plus the sorted form fields. */
export function validTwilioSignature(path: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!env.twilioToken || !signature) return false;
  const data = `${env.publicUrl}${path}` + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", env.twilioToken).update(data).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** POST /twilio/voice: join a conference and start a Media Stream to /twilio/media. */
export function voiceTwiml(callSid: string): string {
  const wsUrl = `${env.publicUrl.replace(/^http/, "ws")}/twilio/media`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    "  <Start>",
    `    <Stream url="${xml(wsUrl)}" track="inbound_track">`,
    `      <Parameter name="token" value="${STREAM_TOKEN}"/>`,
    "    </Stream>",
    "  </Start>",
    "  <Say>Scam Shield is listening. Tap merge calls now.</Say>",
    "  <Dial>",
    // The conference keeps this leg open, and is where the M10 whisper will coach the customer.
    `    <Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="true" waitUrl="">${xml(`scamshield-${callSid || "call"}`)}</Conference>`,
    "  </Dial>",
    "</Response>",
  ].join("\n");
}

const STT_URL =
  "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=ulaw_8000&commit_strategy=vad&vad_silence_threshold_secs=0.8&language_code=en";
/** Twilio sends 20 ms frames; they are forwarded in batches of this many. */
const FRAMES_PER_CHUNK = 5;

/** ElevenLabs realtime STT. It accepts Twilio's 8 kHz mu-law as is, so nothing is converted. */
class SttStream {
  private readonly ws: WebSocket;
  private frames: Buffer[] = [];
  private backlog: string[] = [];

  constructor(onFinal: (text: string) => void) {
    this.ws = new WebSocket(STT_URL, { headers: { "xi-api-key": env.elevenLabsKey } });
    this.ws.on("open", () => {
      for (const message of this.backlog) this.ws.send(message);
      this.backlog = [];
    });
    this.ws.on("message", (raw: RawData) => {
      let message: { message_type?: string; text?: string; error?: string };
      try {
        message = JSON.parse(raw.toString()) as typeof message;
      } catch {
        return;
      }
      if (message.message_type === "committed_transcript" || message.message_type === "committed_transcript_with_timestamps") {
        const text = (message.text ?? "").trim();
        if (text) onFinal(text);
      } else if (message.message_type && message.message_type !== "partial_transcript" && message.message_type !== "session_started") {
        console.warn(`[relay] ElevenLabs STT: ${message.message_type}${message.error ? `: ${message.error}` : ""}`);
      }
    });
    this.ws.on("error", (e) => console.warn(`[relay] ElevenLabs STT socket error: ${e.message}`));
  }

  /** `payload` is one base64 mu-law frame from Twilio. */
  push(payload: string): void {
    this.frames.push(Buffer.from(payload, "base64"));
    if (this.frames.length < FRAMES_PER_CHUNK) return;
    const message = JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: Buffer.concat(this.frames).toString("base64"),
      commit: false,
      sample_rate: 8000,
    });
    this.frames = [];
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(message);
    else if (this.ws.readyState === WebSocket.CONNECTING && this.backlog.length < 100) this.backlog.push(message);
  }

  close(): void {
    this.ws.close();
  }
}

interface TwilioMessage {
  event?: string;
  start?: { callSid?: string; customParameters?: Record<string, string> };
  media?: { payload?: string };
}

/** WS /twilio/media: receives 8 kHz mu-law audio and streams it to STT. */
export function createMediaServer(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket) => {
    let session: CallSession | null = null;
    let stt: SttStream | null = null;
    let lines: Promise<void> = Promise.resolve();

    const finish = (): void => {
      stt?.close();
      stt = null;
      const ended = session;
      session = null;
      if (!ended) return;
      void lines
        .then(() => ended.idle())
        .then(() => db().reducers.endCall({ callId: ended.callId }))
        .catch((e: unknown) => console.warn(`[relay] end_call failed: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => ended.close());
    };

    socket.on("message", (raw: RawData) => {
      let message: TwilioMessage;
      try {
        message = JSON.parse(raw.toString()) as TwilioMessage;
      } catch {
        return;
      }

      if (message.event === "start") {
        if (message.start?.customParameters?.token !== STREAM_TOKEN) {
          console.warn("[relay] Rejected a media stream with a bad token.");
          socket.close();
          return;
        }
        cancelSimulation();
        // SPEC-QUESTION: ScamShield calls the customer and the scammer is merged in on
        // the handset, so Twilio never sees the scammer's number. It is stored as "".
        // The same merge means the audio is one mixed track: every line is labeled
        // "caller" and the analyzer works out who is speaking from the words.
        lines = startCall(db(), "").then((callId) => {
          session = new CallSession(db(), callId);
          stt = new SttStream((text) => {
            const current = session;
            if (!current) return;
            lines = lines.then(() => current.addLine("caller", text, Date.now() - current.startedAt)).catch((e: unknown) => {
              console.warn(`[relay] add_transcript failed: ${e instanceof Error ? e.message : String(e)}`);
            });
          });
          console.log(`[relay] live call ${callId} started (Twilio ${message.start?.callSid ?? "?"})`);
        });
        lines.catch((e: unknown) => console.warn(`[relay] Could not start the live call: ${e instanceof Error ? e.message : String(e)}`));
      } else if (message.event === "media" && message.media?.payload) {
        stt?.push(message.media.payload);
      } else if (message.event === "stop") {
        finish();
      }
    });

    socket.on("close", finish);
    socket.on("error", finish);
  });

  return wss;
}
