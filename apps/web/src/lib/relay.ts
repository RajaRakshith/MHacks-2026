/** The relay owns anything phone-related: /protect and /simulate. Everything else goes to SpacetimeDB. */
const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? `${window.location.protocol}//${window.location.hostname}:8787`;

export interface RelayReply {
  ok: boolean;
  message?: string;
  error?: string;
}

export async function postRelay(path: "/protect" | "/simulate", body: Record<string, unknown>): Promise<RelayReply> {
  try {
    const res = await fetch(`${RELAY_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as RelayReply;
  } catch {
    return { ok: false, error: "The relay is not running. Start it with `pnpm dev`." };
  }
}
