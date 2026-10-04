/**
 * Nessie client for the transfer worker.
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

/** The only user whose transfers may post to NESSIE_ACCOUNT_ID. */
export const DEMO_ACCOUNT_USER_ID = 'demo-user';

export async function executeNessieTransfer(
  request: NessieTransferRequest
): Promise<NessieTransferResult> {
  if (request.userId !== DEMO_ACCOUNT_USER_ID) {
    return {
      ok: false,
      error: `refusing to debit NESSIE_ACCOUNT_ID for ${request.userId}`,
    };
  }

  const apiKey = process.env.NESSIE_API_KEY;
  const accountId = process.env.NESSIE_ACCOUNT_ID;
  if (!apiKey) return { ok: false, error: 'NESSIE_API_KEY is not set' };
  if (!accountId) return { ok: false, error: 'NESSIE_ACCOUNT_ID is not set' };

  const baseUrl =
    process.env.NESSIE_BASE_URL ?? 'http://api.nessieisreal.com';
  const transaction_date = new Date().toISOString().slice(0, 10);
  const amount = Number(request.amountCents) / 100;
  const description =
    request.memo ?? 'Transfer to ' + request.destinationAccount;

  try {
    const transferUrl = `${baseUrl}/accounts/${accountId}/transfers?key=${encodeURIComponent(apiKey)}`;
    let response = await fetch(transferUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction_date,
        status: 'completed',
        amount,
        description,
      }),
    });

    if (response.status === 403 || response.status === 404) {
      const withdrawalUrl = `${baseUrl}/accounts/${accountId}/withdrawals?key=${encodeURIComponent(apiKey)}`;
      response = await fetch(withdrawalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medium: 'balance',
          transaction_date,
          status: 'completed',
          amount,
          description,
        }),
      });
    }

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `Nessie ${response.status}: ${text}` };
    }

    const data = (await response.json()) as {
      objectCreated?: { _id?: string; id?: string };
      _id?: string;
      id?: string;
    };
    const transferId =
      data.objectCreated?._id ?? data.objectCreated?.id ?? data._id ?? data.id;
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
