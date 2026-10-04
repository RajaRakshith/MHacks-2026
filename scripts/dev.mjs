#!/usr/bin/env node
/**
 * `pnpm dev`: starts a local SpacetimeDB if one is not running, publishes the
 * live module, regenerates client and worker bindings, then starts the worker
 * and the dashboard.
 *
 *   --publish-only   stop after publishing and generating bindings
 *   --reset          publish with --delete-data: wipes calls, holds, and mock transfers
 *   --lan            let other devices on the network reach the database (for the phone app)
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const publishOnly = args.has("--publish-only");
const reset = args.has("--reset");
const lan = args.has("--lan");

// Minimal .env reader: this script runs before any dependency is guaranteed to be installed.
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
const uri = env.SPACETIME_URI || "ws://127.0.0.1:3000";
const database = env.SPACETIME_DATABASE || env.SPACETIME_DB || "scamshield-dev";
const httpUrl = uri.replace(/^ws/, "http").replace(/\/+$/, "");
const host = new URL(httpUrl);
const isLocal = ["127.0.0.1", "localhost", "[::1]"].includes(host.hostname);

const children = [];
let shuttingDown = false;

// Each child runs in its own process group, so stopping it also stops what it
// started (pnpm -> tsx -> node). Killing only the child would leave those running.
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

function prefixed(name, stream, target) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) target.write(`[${name}] ${line}\n`);
  });
}

function start(name, command, commandArgs, extraEnv = {}) {
  const child = spawn(command, commandArgs, { cwd: ROOT, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  prefixed(name, child.stdout, process.stdout);
  prefixed(name, child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`[dev] ${name} exited (${code ?? "signal"}). Stopping.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function run(command, commandArgs, { quiet = false } = {}) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!quiet && result.status !== 0) process.stderr.write(output);
  return { ok: result.status === 0, output };
}

async function ping() {
  try {
    const res = await fetch(`${httpUrl}/v1/ping`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (spawnSync("spacetime", ["--version"], { stdio: "ignore" }).status !== 0) {
    console.error("[dev] The `spacetime` CLI was not found. Install it:\n        curl -sSf https://install.spacetimedb.com | sh");
    process.exit(1);
  }

  // 1. SpacetimeDB
  if (await ping()) {
    console.log(`[dev] SpacetimeDB is already running at ${httpUrl}`);
    if (lan) console.log("[dev] --lan only applies when this script starts SpacetimeDB. If the phone cannot connect, stop the running one and start again.");
  } else if (!isLocal) {
    console.error(`[dev] Cannot reach SpacetimeDB at ${httpUrl}.`);
    process.exit(1);
  } else {
    // Bound to localhost unless --lan is given: this is a demo database with no login.
    const bind = lan ? "0.0.0.0" : "127.0.0.1";
    // Kept so a crash can be explained afterwards.
    const dbLog = openSync(resolve(ROOT, ".spacetime.log"), "w");
    console.log(`[dev] Starting local SpacetimeDB on ${bind}:${host.port || 3000}`);
    const child = spawn("spacetime", ["start", "--listen-addr", `${bind}:${host.port || 3000}`, "--non-interactive"], { cwd: ROOT, stdio: ["ignore", dbLog, dbLog], detached: true });
    child.on("exit", (code) => {
      if (!shuttingDown) {
        console.error(`[dev] spacetime start exited (${code ?? "signal"}). See .spacetime.log for why.`);
        shutdown(1);
      }
    });
    children.push(child);
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await sleep(500);
      up = await ping();
    }
    if (!up) {
      console.error("[dev] SpacetimeDB did not come up within 20 seconds.");
      shutdown(1);
      return;
    }
  }

  // 2. Publish the module
  console.log(`[dev] Publishing the module to "${database}"${reset ? " (data reset)" : ""}`);
  const publishArgs = ["publish", database, "--server", httpUrl, "--module-path", "spacetimedb", "--yes"];
  if (reset) publishArgs.push("--delete-data=always");
  const published = run("spacetime", publishArgs);
  if (!published.ok) {
    console.error("[dev] Publish failed. If the tables changed, run `pnpm reset` to republish with a clean database.");
    shutdown(1);
    return;
  }

  // 3. Client bindings for the dashboard, then worker bindings from the same module.
  const generated = run("spacetime", ["generate", "--lang", "typescript", "--out-dir", "packages/bindings/src", "--module-path", "spacetimedb", "--no-config", "--yes"]);
  if (!generated.ok) {
    shutdown(1);
    return;
  }
  const workerBindings = run("spacetime", ["generate", "--lang", "typescript", "--out-dir", "worker/src/module_bindings", "--module-path", "spacetimedb", "--no-config", "--yes"]);
  if (!workerBindings.ok) {
    shutdown(1);
    return;
  }
  console.log("[dev] Module published and bindings generated.");
  if (publishOnly) {
    shutdown(0);
    return;
  }

  // 4. Worker and dashboard.
  if (lan) {
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((a) => a && a.family === "IPv4" && !a.internal)
      .map((a) => a.address);
    console.log(`[dev] LAN mode: anyone on this network can reach the demo database. This machine: ${addresses.join(", ") || "no network address found"}`);
    console.log("[dev] Start the phone app in another terminal with `pnpm mobile`.");
  }

  start("worker", "npm", ["run", "worker:dev"]);
  start("web", "pnpm", ["--filter", "@scamshield/web", "dev"], { VITE_SPACETIME_URI: uri, VITE_SPACETIME_DB: database });
}

main().catch((e) => {
  console.error(`[dev] ${e instanceof Error ? e.message : String(e)}`);
  shutdown(1);
});
