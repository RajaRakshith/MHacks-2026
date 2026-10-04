import { describe, expect, it } from 'vitest';
import { DEMO_USER_ID, dollarsToCents, liveAvailableBalance, pendingSendActivity, shieldState } from '../src/live';

describe('live helpers', () => {
  it('uses demo-user', () => expect(DEMO_USER_ID).toBe('demo-user'));
  it('turns dollars into integer cents', () => expect(dollarsToCents(2000)).toBe(200000n));
  it('rejects bad amounts', () => expect(() => dollarsToCents(0)).toThrow(/positive/));
  it('is idle when there is no active call', () => expect(shieldState(false, 94)).toBe('idle'));
  it('maps 70 to scam_likely', () => expect(shieldState(true, 70)).toBe('scam_likely'));
  it('maps 40 to caution', () => expect(shieldState(true, 40)).toBe('caution'));
  it('maps 10 to listening', () => expect(shieldState(true, 10)).toBe('listening'));
});

describe('liveAvailableBalance', () => {
  const intent = (over: { amountCents?: bigint; tag?: string; nessieTransferId?: string }) => ({
    amountCents: over.amountCents ?? 5000n,
    status: { tag: over.tag ?? 'Approved' },
    nessieTransferId: over.nessieTransferId,
  });

  it('drops the snapshot as soon as a send is Approved or Completed', () => {
    expect(liveAvailableBalance(8400, [intent({ tag: 'Approved', amountCents: 200000n })], new Set())).toBe(6400);
    expect(liveAvailableBalance(8400, [intent({ tag: 'Completed', amountCents: 5000n })], new Set())).toBe(8350);
  });

  it('does not drop Held, Failed, or Expired sends', () => {
    expect(liveAvailableBalance(8400, [intent({ tag: 'Held' })], new Set())).toBe(8400);
    expect(liveAvailableBalance(8400, [intent({ tag: 'Failed' })], new Set())).toBe(8400);
    expect(liveAvailableBalance(8400, [intent({ tag: 'Expired' })], new Set())).toBe(8400);
  });

  it('does not double-count a Completed send already in activity', () => {
    expect(
      liveAvailableBalance(8350, [intent({ tag: 'Completed', nessieTransferId: 'txn-1' })], new Set(['txn-1']))
    ).toBe(8350);
  });
});

describe('pendingSendActivity', () => {
  it('lists Approved and Completed sends that are not in activity yet', () => {
    const rows = pendingSendActivity(
      [
        {
          id: 9n,
          amountCents: 5000n,
          status: { tag: 'Approved' },
          destinationAccount: 'Oakwood Apartments',
          memo: 'rent',
        },
      ],
      new Set(),
      '2026-10-04'
    );
    expect(rows).toEqual([
      {
        id: 'pending-9',
        kind: 'transfer',
        date: '2026-10-04',
        description: 'rent',
        amount: -50,
        sortIndex: 0,
      },
    ]);
  });
});
