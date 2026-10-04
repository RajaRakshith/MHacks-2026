import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const pkg = require("@expo/ngrok/package.json");
const api = require("@expo/ngrok");

test("Metro tunnel uses Cloudflare, not the broken ngrok v2 wrapper", () => {
  assert.equal(pkg.name, "expo-cloudflared");
  assert.equal(typeof api.connect, "function");
  assert.equal(typeof api.kill, "function");
  assert.equal(typeof api.ensureBinary, "function");
  assert.equal(typeof api.isInstalled, "function");
});
