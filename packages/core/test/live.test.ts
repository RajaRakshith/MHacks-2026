import { describe, expect, it } from 'vitest';
import { DEMO_USER_ID, dollarsToCents, shieldState } from '../src/live';

describe('live helpers', () => {
  it('uses demo-user', () => expect(DEMO_USER_ID).toBe('demo-user'));
  it('turns dollars into integer cents', () => expect(dollarsToCents(2000)).toBe(200000n));
  it('rejects bad amounts', () => expect(() => dollarsToCents(0)).toThrow(/positive/));
  it('is idle when there is no active call', () => expect(shieldState(false, 94)).toBe('idle'));
  it('maps 70 to scam_likely', () => expect(shieldState(true, 70)).toBe('scam_likely'));
  it('maps 40 to caution', () => expect(shieldState(true, 40)).toBe('caution'));
  it('maps 10 to listening', () => expect(shieldState(true, 10)).toBe('listening'));
});
