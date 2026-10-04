/**
 * Stub Nessie client for the transfer worker.
 * Replace with real Capital One Nessie API calls once account IDs are wired up.
 */

export type NessieTransferRequest = {
  intentId: bigint;
  userId: string;
  amountCents: bigint;
  destinationAccount: string;
  memo?: string;
};

export type NessieTransferResult =
  | { ok: true; transferId: string }
  | { ok: false; error: string };

export async function executeNessieTransfer(
  request: NessieTransferRequest
): Promise<NessieTransferResult> {
  const apiKey = process.env.NESSIE_API_KEY;
  const baseUrl =
    process.env.NESSIE_BASE_URL ?? 'http://api.nessieisreal.com';

  if (!apiKey) {
    console.warn(
      `[nessie] NESSIE_API_KEY not set — simulating transfer for intent ${request.intentId}`
    );
    return {
      ok: true,
      transferId: `mock-${request.intentId}-${Date.now()}`,
    };
  }

  try {
    // TODO: wire to actual Nessie transfer endpoint for your demo account.
    const response = await fetch(
      `${baseUrl}/accounts/${request.destinationAccount}/transfers?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medium: 'balance',
          payee_id: request.destinationAccount,
          amount: Number(request.amountCents) / 100,
          transaction_date: new Date().toISOString().slice(0, 10),
          description: request.memo ?? 'ScamShield transfer',
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `Nessie ${response.status}: ${text}` };
    }

    const data = (await response.json()) as { _id?: string; id?: string };
    const transferId = data._id ?? data.id;
    if (!transferId) {
      return { ok: false, error: 'Nessie response missing transfer id' };
    }
    return { ok: true, transferId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
