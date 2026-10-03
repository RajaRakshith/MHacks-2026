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
import { existsSync, readFileSync } from "node:fs";
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

const METRICS_PORTS = { database: 20251, relay: 20252 };

/** True once the tunnel process holds a live connection to Cloudflare. */
async function connected(name) {
  try {
    const res = await fetch(`http://127.0.0.1:${METRICS_PORTS[name]}/ready`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Starts a quick tunnel to `target` and resolves with its https URL once it is
 * really connected. A tunnel can print its URL and still never connect, so the
 * URL alone is not trusted: it is retried until `/ready` says it is up.
 */
async function tunnel(name, target) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    // http2 (TCP) rather than the default QUIC (UDP): venue and campus Wi-Fi often drop UDP.
    const child = spawn(
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--protocol", "http2", "--metrics", `127.0.0.1:${METRICS_PORTS[name]}`, "--url", target],
      { stdio: ["ignore", "pipe", "pipe"], detached: true },
    );
    let url = "";
    const onData = (chunk) => {
      const text = chunk.toString();
      url ||= /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0] ?? "";
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    let up = false;
    for (let i = 0; i < 30 && child.exitCode === null && !up; i++) {
      await sleep(1000);
      up = url !== "" && (await connected(name));
    }
    if (up) {
      children.push(child);
      child.on("exit", () => {
        if (!shuttingDown) {
          console.error(`[phone] The ${name} tunnel stopped. Stop this (Ctrl+C) and run \`pnpm phone\` again.`);
          shutdown(1);
        }
      });
      return url;
    }
    stop(child);
    console.warn(`[phone] The ${name} tunnel did not connect (attempt ${attempt} of 4). Trying again...`);
    await sleep(1500);
  }
  throw new Error(`Could not open the ${name} tunnel. Check the internet connection and try again.`);
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
  const dbUrl = await tunnel("database", dbLocal);
  const relayUrl = await tunnel("relay", relayLocal);

  console.log(`[phone] database  ${dbUrl}`);
  console.log(`[phone] relay     ${relayUrl}`);
  console.log("[phone] Starting Expo. Scan the QR code with the iPhone camera; it opens in Expo Go.\n");

  // --clear: the tunnel URLs are compiled into the app and are new every run.
  // Expo stays in this terminal's process group so its keyboard shortcuts work.
  const expo = spawn(process.execPath, [resolve(ROOT, "apps/mobile/node_modules/expo/bin/cli"), "start", "--tunnel", "--clear"], {
    cwd: resolve(ROOT, "apps/mobile"),
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_PUBLIC_SPACETIME_URI: dbUrl.replace(/^http/, "ws"),
      EXPO_PUBLIC_SPACETIME_DB: database,
      EXPO_PUBLIC_RELAY_URL: relayUrl,
    },
  });
  children.push(expo);
  expo.on("exit", (code) => shutdown(code ?? 0));
}

main().catch((e) => {
  console.error(`[phone] ${e instanceof Error ? e.message : String(e)}`);
  shutdown(1);
});
