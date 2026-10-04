import assert from "node:assert/strict";
import { test } from "node:test";
import { expoCliArgs, expoGoUrl, expoPackagerEnv } from "../../../scripts/phone-expo.mjs";

test("phone starts Expo on LAN with a proxy URL, not --tunnel", () => {
  const args = expoCliArgs(8081);
  assert.deepEqual(args, ["start", "--lan", "--port", "8081", "--clear"]);
  assert.equal(args.includes("--tunnel"), false);
});

test("Expo Go URL uses the Cloudflare host on port 443", () => {
  assert.equal(
    expoGoUrl("https://meals-railroad-thursday-observer.trycloudflare.com"),
    "exp://meals-railroad-thursday-observer.trycloudflare.com:443",
  );
});

test("when campus DNS blocks the tunnel, Expo advertises the LAN IP instead", () => {
  const proxy = "https://ratios-opposition-incredible-tier.trycloudflare.com";
  assert.deepEqual(expoPackagerEnv({ packagerProxyUrl: proxy, lanIp: "10.0.0.8", tunnelResolves: true }), {
    EXPO_PACKAGER_PROXY_URL: proxy,
  });
  assert.deepEqual(expoPackagerEnv({ packagerProxyUrl: proxy, lanIp: "10.0.0.8", tunnelResolves: false }), {
    REACT_NATIVE_PACKAGER_HOSTNAME: "10.0.0.8",
  });
});
