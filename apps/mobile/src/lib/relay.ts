import { relayUrl } from "./config";

export interface RelayReply {
  ok: boolean;
  message?: string;
  error?: string;
}

/** The relay owns anything phone-related: /protect and /simulate. Everything else goes to SpacetimeDB. */
export async function relayPost(path: "/protect" | "/simulate" | "/type/reset", body: Record<string, unknown>): Promise<RelayReply> {
  try {
    const res = await fetch(`${relayUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as RelayReply;
  } catch {
    return { ok: false, error: `Cannot reach the relay at ${relayUrl()}.` };
  }
}
