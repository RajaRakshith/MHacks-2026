#!/usr/bin/env node
/**
 * `pnpm phone`: runs the iOS app on a real phone through Expo Go, on any network.
 *
 * The phone has to reach three things on this machine: the Expo dev server,
 * the database (port 3000), and the relay (port 8787). On WSL2, or on Wi-Fi
 * that keeps devices apart, it cannot. This script gives each one a public
 * tunnel instead:
 *
 *   database, relay   Cloudflare quick tunnels (`cloudflared`, no account)
 *   Expo dev server   Expo's own tunnel (`expo start --tunnel`)
 *
 * Run `pnpm dev` first, in another terminal. Then scan the QR code this prints.
 *
 * While this runs, the demo database and relay are reachable by anyone who
 * has the tunnel URLs. They are random and change every run. Stop with Ctrl+C.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const dbLocal = (env.SPACETIME_URI || "ws://127.0.0.1:3000").replace(/^ws/, "http").replace(/\/+$/, "");
const relayLocal = `http://127.0.0.1:${env.RELAY_PORT || 8787}`;
const database = env.SPACETIME_DB || "scamshield";

const children = [];
let shuttingDown = false;

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
function publish(dbTunnel, relayTunnel) {
  mkdirSync(dirname(ENDPOINTS_FILE), { recursive: true });
  writeFileSync(ENDPOINTS_FILE, JSON.stringify({ spacetimeUri: dbTunnel.url.replace(/^http/, "ws"), relayUrl: relayTunnel.url }));
  console.log(`[phone] database  ${dbTunnel.url}`);
  console.log(`[phone] relay     ${relayTunnel.url}`);
}

/**
 * Quick tunnels can drop for good: the process stays up but holds no
 * connection and its address stops resolving. This replaces a tunnel that has
 * been down for about 20 seconds and tells the app the new address.
 */
async function watch(tunnels) {
  const downSince = new Map();
  while (!shuttingDown) {
    await sleep(5000);
    for (const key of ["database", "relay"]) {
      const t = tunnels[key];
      const alive = t.child.exitCode === null && (await connected(t.port, t.url));
      if (alive) {
        downSince.delete(key);
        continue;
      }
      if (!downSince.has(key)) downSince.set(key, Date.now());
      if (Date.now() - downSince.get(key) < 20_000 || shuttingDown) continue;
      console.warn(`[phone] The ${key} tunnel dropped. Opening a new one...`);
      stop(t.child);
      try {
        tunnels[key] = await tunnel(key, t.target);
        downSince.delete(key);
        publish(tunnels.database, tunnels.relay);
        console.log("[phone] The app will switch to the new address within a few seconds.");
      } catch (e) {
        console.error(`[phone] ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

async function main() {
  if (spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).status !== 0) {
    console.error(
      "[phone] `cloudflared` was not found. Install it:\n" +
        "        curl -sSL -o ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x ~/.local/bin/cloudflared\n" +
        "        (macOS: brew install cloudflared)",
    );
    process.exit(1);
  }
  if (!(await ok(`${dbLocal}/v1/ping`)) || !(await ok(`${relayLocal}/health`))) {
    console.error("[phone] The demo server is not running. Start it in another terminal with `pnpm dev`, then run this again.");
    process.exit(1);
  }

  // One at a time: two quick tunnels requested at the same moment both came up dead.
  console.log("[phone] Opening tunnels to the database and the relay...");
  const tunnels = { database: await tunnel("database", dbLocal), relay: await tunnel("relay", relayLocal) };
  publish(tunnels.database, tunnels.relay);
  void watch(tunnels);

  console.log("[phone] Starting Expo. Scan the QR code with the iPhone camera; it opens in Expo Go.\n");

  // The app looks the tunnel addresses up at run time, so nothing about them is compiled in.
  // Expo stays in this terminal's process group so its keyboard shortcuts work.
  const expo = spawn(process.execPath, [resolve(ROOT, "apps/mobile/node_modules/expo/bin/cli"), "start", "--tunnel", "--clear"], {
    cwd: resolve(ROOT, "apps/mobile"),
    stdio: "inherit",
    env: { ...process.env, EXPO_PUBLIC_SPACETIME_DB: database },
  });
  children.push(expo);
  expo.on("exit", (code) => shutdown(code ?? 0));
}

main().catch((e) => {
  console.error(`[phone] ${e instanceof Error ? e.message : String(e)}`);
  shutdown(1);
});
