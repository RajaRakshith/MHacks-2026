import { stateForScore } from './score';

export const DEMO_USER_ID = 'demo-user';

export function dollarsToCents(dollars: number): bigint {
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error('Amount must be a positive number.');
  }
  return BigInt(Math.round(dollars * 100));
}

export function shieldState(
  active: boolean,
  score: number,
): 'idle' | 'listening' | 'caution' | 'scam_likely' {
  return active ? stateForScore(score) : 'idle';
}
