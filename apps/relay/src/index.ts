import Fastify from "fastify";
import { connect, db, isConnected, refreshAccount } from "./db";
import { env } from "./env";
import { createMediaServer, liveConfigProblem, ringCustomer, validTwilioSignature, voiceTwiml } from "./live";
import { DEFAULT_SCENARIO, cancelSimulation, listScenarios, loadFixture, simulate } from "./simulate";

const REFRESH_INTERVAL_MS = 30_000;

const app = Fastify({ logger: false });

// Twilio posts form-encoded webhooks.
app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
  done(null, Object.fromEntries(new URLSearchParams(body as string)));
});

// The dashboard runs on another port.
app.addHook("onRequest", async (req, reply) => {
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-headers", "content-type");
  reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return reply.code(204).send();
});

app.get("/health", async () => ({ ok: true, mock: env.mock, connected: isConnected(), scenarios: listScenarios() }));

interface SimulateBody {
  scenario?: string;
  speed?: number;
  /** Respond only when playback has finished, with the final score. */
  wait?: boolean;
  endWhenDone?: boolean;
}

async function runSimulation(body: SimulateBody, reply: { code: (n: number) => { send: (v: unknown) => unknown } }): Promise<unknown> {
  const scenario = body.scenario ?? DEFAULT_SCENARIO;
  const fixture = loadFixture(scenario);
  if (!fixture) return reply.code(404).send({ ok: false, error: `Unknown scenario "${scenario}".`, scenarios: listScenarios() });
  if (!isConnected()) return reply.code(503).send({ ok: false, error: "The relay is not connected to SpacetimeDB yet." });

  const options: { speed?: number; endWhenDone?: boolean } = {};
  if (typeof body.speed === "number") options.speed = body.speed;
  if (body.endWhenDone === true) options.endWhenDone = true;
  const { callId, done } = await simulate(db(), fixture, options);
  if (body.wait) return { ok: true, scenario, ...(await done) };
  void done;
  return { ok: true, scenario, callId: callId.toString() };
}

/** `{ scenario }`: plays a fixture into Spacetime with real timing. */
app.post<{ Body: SimulateBody | null }>("/simulate", async (req, reply) => runSimulation(req.body ?? {}, reply));

/**
 * The hardware button and the dashboard's "Protect this call" both land here.
 * Real mode: Twilio rings the customer's phone from the ScamShield number, and the customer taps Merge.
 */
// SPEC-QUESTION: with MOCK=1, or when Twilio is not configured, there is no
// phone to ring, so /protect plays a scripted call instead (the scenario in
// the body, or refund-overpayment). With MOCK=0 that call still goes through
// the real analyzer and the real account.
app.post<{ Body: SimulateBody | null }>("/protect", async (req, reply) => {
  if (env.mock || liveConfigProblem()) return runSimulation(req.body ?? {}, reply);
  const result = await ringCustomer();
  if (!result.ok) return reply.code(503).send(result);
  console.log(`[relay] /protect: ringing the customer (Twilio call ${result.callSid})`);
  return { ok: true, callSid: result.callSid, message: "Your phone is ringing. Answer, then tap Merge." };
});

app.post<{ Body: Record<string, string> | null }>("/twilio/voice", async (req, reply) => {
  const params = req.body ?? {};
  const signature = req.headers["x-twilio-signature"];
  if (!validTwilioSignature("/twilio/voice", params, Array.isArray(signature) ? signature[0] : signature)) {
    console.warn("[relay] /twilio/voice: bad Twilio signature. Check PUBLIC_URL and TWILIO_AUTH_TOKEN.");
    return reply.code(403).send("Forbidden");
  }
  return reply.type("text/xml").send(voiceTwiml(params.CallSid ?? ""));
});

const media = createMediaServer();
app.server.on("upgrade", (req, socket, head) => {
  if ((req.url ?? "").split("?")[0] === "/twilio/media") {
    media.handleUpgrade(req, socket, head, (ws) => media.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

let watching = false;

await app.listen({ port: env.port, host: "0.0.0.0" });
console.log(`[relay] Listening on http://localhost:${env.port} (${env.mock ? "MOCK: fixtures only, no external APIs" : "LIVE"})`);
if (!env.mock) {
  const problem = liveConfigProblem();
  if (problem) console.warn(`[relay] ${problem} Simulated calls still work.`);
}

await connect(async (conn) => {
  // "End call" on the dashboard goes straight to the end_call reducer, so
  // playback has to notice the call ending and stop.
  conn.db.call.onUpdate((_ctx, _old, row) => {
    if (row.endedAt !== undefined) cancelSimulation(row.id);
  });
  if (!watching) {
    watching = true;
    setInterval(() => {
      if (isConnected()) void refreshAccount().catch((e: unknown) => console.warn(`[relay] refresh failed: ${e instanceof Error ? e.message : String(e)}`));
    }, REFRESH_INTERVAL_MS);
  }
});
