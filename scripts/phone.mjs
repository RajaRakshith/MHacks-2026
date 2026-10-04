#!/usr/bin/env node
/**
 * `pnpm phone`: runs the iOS app on a real phone through Expo Go.
 *
 * The Expo JS bundle is always tunneled through Cloudflare (`expo-cloudflared`).
 * Expo Go then opens `exp://<trycloudflare-host>:443`. We do not use
 * `expo start --tunnel` (that still talks to dead ngrok / exp.direct hosts).
 * The database is whatever `.env` says:
 *
 *   Maincloud (SPACETIME_URI=wss://maincloud…)  the phone talks to cloud directly.
 *                                               No extra database tunnel.
 *   Local (ws://127.0.0.1:3000)                 cloudflared tunnels port 3000 so
 *                                               the phone can reach this laptop.
 *
 * Run `pnpm dev` first. Then scan the QR code this prints.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expoCliArgs, expoGoUrl, expoPackagerEnv } from "./phone-expo.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readEnv() {
  const out = {};
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const env = { ...readEnv(), ...process.env };
const spacetimeUri = (env.SPACETIME_URI || "ws://127.0.0.1:3000").replace(/\/+$/, "");
const dbHttp = spacetimeUri.replace(/^ws/, "http");
const database = env.SPACETIME_DATABASE ?? env.SPACETIME_DB ?? "watchdog-dev";
let isLocal = true;
try {
  isLocal = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(dbHttp).hostname);
} catch {
  isLocal = true;
}

const children = [];
let shuttingDown = false;
let killMetroTunnel = () => {};

function stop(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    killMetroTunnel();
  } catch {
    // Tunnel already gone.
  }
  for (const child of children) stop(child);
  setTimeout(() => process.exit(code), 400);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ok(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    return false;
  }
}

/** A port nothing is using, so two copies of this script never share a tunnel's status port. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

/**
 * True once this tunnel process holds a live connection to Cloudflare. The
 * hostname is checked too, so a status port answered by some other tunnel is
 * never mistaken for this one.
 */
async function connected(port, url) {
  try {
    const ready = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(2000) });
    if (!ready.ok) return false;
    const info = await (await fetch(`http://127.0.0.1:${port}/quicktunnel`, { signal: AbortSignal.timeout(2000) })).json();
    return info.hostname === new URL(url).hostname;
  } catch {
    return false;
  }
}

/**
 * Starts a quick tunnel to `target` and resolves once it is really connected.
 * A tunnel can print its URL and still never connect, so the URL alone is not
 * trusted: it is retried until `/ready` says it is up.
 */
async function tunnel(name, target) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const port = await freePort();
    // http2 (TCP) rather than the default QUIC (UDP): venue and campus Wi-Fi often drop UDP.
    const child = spawn(
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--protocol", "http2", "--metrics", `127.0.0.1:${port}`, "--url", target],
      { stdio: ["ignore", "pipe", "pipe"], detached: true },
    );
    let url = "";
    const onData = (chunk) => {
      url ||= /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString())?.[0] ?? "";
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    let up = false;
    for (let i = 0; i < 30 && child.exitCode === null && !up; i++) {
      await sleep(1000);
      up = url !== "" && (await connected(port, url));
    }
    if (up) {
      children.push(child);
      return { name, target, url, port, child };
    }
    stop(child);
    console.warn(`[phone] The ${name} tunnel did not connect (attempt ${attempt} of 4). Trying again...`);
    await sleep(1500);
  }
  throw new Error(`Could not open the ${name} tunnel. Check the internet connection and try again.`);
}

const ENDPOINTS_FILE = resolve(ROOT, "apps/mobile/.expo/endpoints.json");

/** The app reads this through the dev server (metro.config.js) and follows it when it changes. */
function publishUri(uri) {
  mkdirSync(dirname(ENDPOINTS_FILE), { recursive: true });
  writeFileSync(ENDPOINTS_FILE, JSON.stringify({ spacetimeUri: uri }));
  console.log(`[phone] database  ${uri} / ${database}`);
}

function publish(dbTunnel) {
  publishUri(dbTunnel.url.replace(/^http/, "ws"));
}

/**
 * Quick tunnels can drop for good: the process stays up but holds no
 * connection and its address stops resolving. This replaces a tunnel that has
 * been down for about 20 seconds and tells the app the new address.
 */
async function watch(dbTunnel) {
  let current = dbTunnel;
  let downSince = 0;
  while (!shuttingDown) {
    await sleep(5000);
    const alive = current.child.exitCode === null && (await connected(current.port, current.url));
    if (alive) {
      downSince = 0;
      continue;
    }
    if (!downSince) downSince = Date.now();
    if (Date.now() - downSince < 20_000 || shuttingDown) continue;
    console.warn("[phone] The database tunnel dropped. Opening a new one...");
    stop(current.child);
    try {
      current = await tunnel("database", current.target);
      downSince = 0;
      publish(current);
      console.log("[phone] The app will switch to the new address within a few seconds.");
    } catch (e) {
      console.error(`[phone] ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function expoTunnelApi() {
  const require = createRequire(import.meta.url);
  return require(resolve(ROOT, "apps/mobile/node_modules/@expo/ngrok"));
}

async function preferredMetroPort() {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(null));
    server.listen(8081, "127.0.0.1", () => {
      server.close(() => resolvePort(8081));
    });
  });
}

function lanIPv4() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

async function publicDnsHas(host) {
  try {
    const res = await fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(4000),
    });
    const json = await res.json();
    return json.Status === 0 && Array.isArray(json.Answer) && json.Answer.some((a) => a.type === 1);
  } catch {
    return false;
  }
}

async function systemDnsHas(host) {
  try {
    await lookup(host);
    return true;
  } catch {
    return false;
  }
}

async function waitForPublicDns(host) {
  for (let i = 0; i < 15; i++) {
    if (await publicDnsHas(host)) return true;
    await sleep(1000);
  }
  return false;
}

/**
 * Open a Cloudflare tunnel to Metro, then start Expo with that public HTTPS
 * URL. Expo Go resolves `exp://host:443`; `expo start --tunnel` still points
 * it at exp.direct / ngrok, which no longer have a hostname.
 */
async function startExpo() {
  const cf = expoTunnelApi();
  if (typeof cf.isInstalled === "function" && !cf.isInstalled()) {
    console.log("[phone] Installing the Expo tunnel binary (first run only)...");
    await cf.ensureBinary();
  }

  const port = (await preferredMetroPort()) ?? (await freePort());
  console.log("[phone] Opening a Cloudflare tunnel to the Expo bundler...");
  const packagerProxyUrl = await cf.connect({
    addr: port,
    proto: "http",
    startTimeoutMs: 45_000,
    onStatusChange(status) {
      if (status === "closed") {
        console.warn("[phone] The Expo tunnel dropped. Stop this and run pnpm phone again.");
      }
    },
  });
  killMetroTunnel = () => {
    try {
      cf.kill();
    } catch {
      // Already stopped.
    }
  };

  const host = new URL(packagerProxyUrl).hostname;
  await waitForPublicDns(host);
  const tunnelResolves = await systemDnsHas(host);
  const lanIp = lanIPv4();
  const goUrl = expoGoUrl(packagerProxyUrl);
  console.log(`[phone] Expo Go   ${goUrl}`);
  if (!tunnelResolves) {
    console.warn(`[phone] This network's DNS cannot resolve ${host} (common on campus Wi-Fi).`);
    console.warn("[phone] The QR is the LAN address. Same Wi-Fi: scan it.");
    console.warn(`[phone] Different network: turn off Wi-Fi on the iPhone and paste ${goUrl} into Expo Go.`);
  } else {
    console.log("[phone] Scan the new QR code. Do not reopen an old Expo Go project — that hostname is gone.\n");
  }

  const expo = spawn(process.execPath, [resolve(ROOT, "apps/mobile/node_modules/expo/bin/cli"), ...expoCliArgs(port)], {
    cwd: resolve(ROOT, "apps/mobile"),
    stdio: "inherit",
    env: {
      ...process.env,
      ...expoPackagerEnv({ packagerProxyUrl, lanIp, tunnelResolves }),
      EXPO_PUBLIC_SPACETIME_URI: spacetimeUri,
      EXPO_PUBLIC_SPACETIME_DB: database,
    },
  });
  children.push(expo);
  expo.on("exit", (code) => shutdown(code ?? 0));
}

async function main() {
  if (!isLocal) {
    if (!(await ok(`${dbHttp}/v1/ping`))) {
      console.error(`[phone] Cannot reach ${dbHttp}. Check SPACETIME_URI in .env.`);
      process.exit(1);
    }
    console.log("[phone] Using the cloud database from .env (no extra database tunnel).");
    publishUri(spacetimeUri);
    await startExpo();
    return;
  }

  if (spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).status !== 0) {
    console.error(
      "[phone] Local Spacetime needs `cloudflared` so the phone can reach port 3000.\n" +
        "        brew install cloudflared\n" +
        "        Or point .env at Maincloud (SPACETIME_URI=wss://maincloud.spacetimedb.com) and run this again.",
    );
    process.exit(1);
  }
  if (!(await ok(`${dbHttp}/v1/ping`))) {
    console.error("[phone] Local SpacetimeDB is not running. Start it in another terminal with `pnpm dev`, then run this again.");
    process.exit(1);
  }

  console.log("[phone] Opening a tunnel to the local database...");
  const dbTunnel = await tunnel("database", dbHttp);
  publish(dbTunnel);
  void watch(dbTunnel);
  await startExpo();
}

main().catch((e) => {
  console.error(`[phone] ${e instanceof Error ? e.message : String(e)}`);
  shutdown(1);
});
