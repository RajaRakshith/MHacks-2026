/**
 * Shared SpacetimeDB client helpers for the phone app, bank app, and dashboard.
 *
 * Copy or import this into frontend packages after running:
 *   npm run spacetime:generate
 *
 * Each app generates its own module_bindings/ — the subscription SQL below
 * is the contract all clients share.
 */

export const SUBSCRIPTION_QUERIES = {
  /** Live risk meter + call status for one user. */
  callSessionForUser: (userId: string) =>
    `SELECT * FROM call_sessions WHERE user_id = '${userId}' AND status = 'Active'`,

  /** Escalation timeline during a call. */
  riskEventsForSession: (sessionId: bigint | number) =>
    `SELECT * FROM risk_events WHERE session_id = ${sessionId} ORDER BY occurred_at`,

  /** All transfer intents for the bank app history view. */
  transfersForUser: (userId: string) =>
    `SELECT * FROM transfer_intents WHERE user_id = '${userId}' ORDER BY requested_at DESC`,

  /** Held transfers banner on the bank app. */
  heldTransfersForUser: (userId: string) =>
    `SELECT * FROM transfer_intents WHERE user_id = '${userId}' AND status = 'Held'`,
} as const;

export type SpacetimeClientConfig = {
  uri?: string;
  database?: string;
  token?: string;
};

export const defaultClientConfig = (): Required<
  Pick<SpacetimeClientConfig, 'uri' | 'database'>
> &
  Pick<SpacetimeClientConfig, 'token'> => ({
  uri: process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000',
  database: process.env.SPACETIME_DATABASE ?? 'watchdog',
  token: process.env.SPACETIME_TOKEN,
});
