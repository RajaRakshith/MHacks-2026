import express from "express";
import { createServer } from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
const RECORD_CALLS = process.env.RECORD_CALLS !== "false";
const RECORDINGS_DIR = path.join(process.cwd(), "recordings");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/** @type {Map<string, { frames: number; bytes: number }>} */
const streamStats = new Map();

/** @type {Map<string, { callSid: string; writers: Map<string, fs.WriteStream>; paths: Map<string, string> }>} */
const streamRecordings = new Map();

function recordingEnabled() {
  return RECORD_CALLS;
}

function ensureRecordingsDir() {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

function safeCallSid(callSid) {
  return (callSid ?? "unknown").replace(/[^\w.-]/g, "_");
}

function openRecordingWriters(streamSid, callSid) {
  if (!recordingEnabled()) return;
  ensureRecordingsDir();
  const session = { callSid, writers: new Map(), paths: new Map() };
  streamRecordings.set(streamSid, session);
  return session;
}

function getRecordingWriter(streamSid, track, callSid) {
  if (!recordingEnabled()) return undefined;
  let session = streamRecordings.get(streamSid);
  if (!session) {
    session = openRecordingWriters(streamSid, callSid);
  }
  const key = track || "mixed";
  if (session.writers.has(key)) {
    return session.writers.get(key);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${safeCallSid(session.callSid ?? callSid)}_${key}_${stamp}.ulaw`;
  const filePath = path.join(RECORDINGS_DIR, fileName);
  const writer = fs.createWriteStream(filePath, { flags: "a" });
  session.writers.set(key, writer);
  session.paths.set(key, filePath);
  console.log("[record] writing", { streamSid, track: key, filePath });
  return writer;
}

function closeRecordingWriters(streamSid) {
  const session = streamRecordings.get(streamSid);
  if (!session) return [];
  const closed = [];
  for (const [track, writer] of session.writers) {
    writer.end();
    closed.push({ track, path: session.paths.get(track) });
  }
  streamRecordings.delete(streamSid);
  return closed;
}

function publicWssBase(req) {
  if (PUBLIC_BASE_URL) {
    return PUBLIC_BASE_URL.replace(/^http/i, "ws");
  }
  const host = req.get("host");
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const wsProto = proto === "https" ? "wss" : "ws";
  return `${wsProto}://${host}`;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, activeStreams: streamStats.size });
});

app.post("/voice", (req, res) => {
  const wssBase = publicWssBase(req);
  const streamUrl = `${wssBase}/stream`;

  console.log("[voice] incoming call", {
    CallSid: req.body.CallSid,
    From: req.body.From,
    To: req.body.To,
    streamUrl,
  });

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/stream" });

wss.on("connection", (socket, req) => {
  const remote = req.socket.remoteAddress;
  console.log("[stream] websocket connected", { remote });

  /** @type {string | undefined} */
  let streamSid;

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.warn("[stream] non-JSON message");
      return;
    }

    switch (msg.event) {
      case "connected":
        console.log("[stream] protocol connected", msg.protocol);
        break;

      case "start": {
        streamSid = msg.start?.streamSid;
        const callSid = msg.start?.callSid;
        streamStats.set(streamSid, { frames: 0, bytes: 0 });
        if (streamSid && recordingEnabled()) {
          openRecordingWriters(streamSid, callSid);
        }
        console.log("[stream] start", {
          streamSid,
          callSid,
          tracks: msg.start?.tracks,
          recording: recordingEnabled(),
        });
        break;
      }

      case "media": {
        const sid = msg.streamSid ?? streamSid;
        const payload = msg.media?.payload ?? "";
        const chunk = Buffer.from(payload, "base64");
        const chunkBytes = chunk.length;
        const track = msg.media?.track;
        const stats = sid ? streamStats.get(sid) : undefined;
        if (stats && sid) {
          stats.frames += 1;
          stats.bytes += chunkBytes;
          if (stats.frames === 1 || stats.frames % 50 === 0) {
            console.log("[stream] media", {
              streamSid: sid,
              frames: stats.frames,
              totalBytes: stats.bytes,
              lastChunkBytes: chunkBytes,
              track,
            });
          }
        }
        if (sid && chunkBytes > 0) {
          const writer = getRecordingWriter(sid, track, msg.start?.callSid);
          writer?.write(chunk);
        }
        break;
      }

      case "stop": {
        const sid = msg.streamSid ?? streamSid;
        const stats = sid ? streamStats.get(sid) : undefined;
        const files = sid ? closeRecordingWriters(sid) : [];
        console.log("[stream] stop", { streamSid: sid, stats, recordings: files });
        if (sid) streamStats.delete(sid);
        break;
      }

      case "mark":
        console.log("[stream] mark", msg.mark?.name);
        break;

      default:
        console.log("[stream] event", msg.event);
    }
  });

  socket.on("close", (code, reason) => {
    const files = streamSid ? closeRecordingWriters(streamSid) : [];
    console.log("[stream] websocket closed", {
      code,
      reason: reason.toString(),
      streamSid,
      recordings: files,
    });
    if (streamSid) streamStats.delete(streamSid);
  });

  socket.on("error", (err) => {
    console.error("[stream] websocket error", err);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Watchdog Twilio POC listening on http://localhost:${PORT}`);
  console.log(`  POST /voice   — Twilio voice webhook (TwiML + Media Stream)`);
  console.log(`  WS   /stream  — Twilio Media Streams`);
  console.log(`  GET  /health  — liveness`);
  if (!PUBLIC_BASE_URL) {
    console.log(
      "  Tip: set PUBLIC_BASE_URL to your ngrok HTTPS URL so TwiML wss:// matches the tunnel.",
    );
  }
  if (recordingEnabled()) {
    console.log(`  Recordings → ${RECORDINGS_DIR} (*.ulaw, μ-law 8 kHz)`);
  } else {
    console.log("  Recordings disabled (set RECORD_CALLS=false to keep off)");
  }
});
