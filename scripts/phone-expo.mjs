/** Pure helpers for how `pnpm phone` starts Expo. */

export function expoCliArgs(port) {
  return ["start", "--lan", "--port", String(port), "--clear"];
}

/** Expo Go needs an explicit :443 so it uses HTTPS instead of a dead exp.direct host. */
export function expoGoUrl(packagerProxyUrl) {
  const parsed = new URL(packagerProxyUrl);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return `exp://${parsed.hostname}:${port}`;
}

/**
 * Campus DNS (UMich) often answers NXDOMAIN for `*.trycloudflare.com`.
 * If this machine cannot resolve the tunnel host, the phone on the same
 * network cannot either — so the QR should be the LAN IP, not the tunnel.
 */
export function expoPackagerEnv({ packagerProxyUrl, lanIp, tunnelResolves }) {
  if (tunnelResolves) {
    return { EXPO_PACKAGER_PROXY_URL: packagerProxyUrl };
  }
  return lanIp ? { REACT_NATIVE_PACKAGER_HOSTNAME: lanIp } : {};
}
