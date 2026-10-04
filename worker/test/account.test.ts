import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNessieAccount, refreshAccount } from '../src/account.ts';

const SEED_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../.seed.json');

const ACCOUNT = {
  _id: 'acct-abcdefgh1234',
  type: 'Checking',
  nickname: 'Everyday Checking',
  balance: 6018,
  account_number: '4417123456781234',
  customer_id: 'cust-1',
};

function installFetch(handler: (url: string) => Response | Promise<Response>): () => void {
  const prev = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
  return () => {
    globalThis.fetch = prev;
  };
}

function withSeed(contents: string | null, run: () => Promise<void>): Promise<void> {
  const had = existsSync(SEED_PATH);
  const backup = had ? readFileSync(SEED_PATH) : null;
  try {
    if (contents === null) {
      if (had) unlinkSync(SEED_PATH);
    } else {
      writeFileSync(SEED_PATH, contents);
    }
    return run().finally(() => {
      if (backup) writeFileSync(SEED_PATH, backup);
      else if (existsSync(SEED_PATH)) unlinkSync(SEED_PATH);
    });
  } catch (err) {
    if (backup) writeFileSync(SEED_PATH, backup);
    else if (existsSync(SEED_PATH)) unlinkSync(SEED_PATH);
    throw err;
  }
}

describe('nessie account refresh', { concurrency: false }, () => {
  test('account GET failure throws and does not invent a snapshot', async () => {
    const restore = installFetch(() => new Response('nope', { status: 404 }));
    try {
      await assert.rejects(
        () => fetchNessieAccount({ apiKey: 'k', baseUrl: 'http://nessie.test', accountId: 'acc' }),
        /Nessie/
      );
    } finally {
      restore();
    }
  });

  test('maps the account, signs activity newest-first, and caps at 20', async () => {
    const deposits = Array.from({ length: 21 }, (_, i) => ({
      _id: `d${i}`,
      transaction_date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      description: `Deposit ${i}`,
      amount: i + 1,
    }));
    const restore = installFetch((url) => {
      assert.equal(url.includes('key=k'), true);
      if (url.includes('/customers/')) {
        return Response.json({ first_name: 'Margaret', last_name: 'Hale' });
      }
      if (url.includes('/deposits')) return Response.json(deposits);
      if (url.includes('/withdrawals')) {
        return Response.json([
          { _id: 'w1', transaction_date: '2026-02-02', description: 'ATM', amount: 60 },
        ]);
      }
      if (url.includes('/transfers')) {
        return Response.json([
          { id: 't-live', transaction_date: '2026-03-03', description: 'Rent', amount: 12.5 },
        ]);
      }
      if (url.includes('/purchases')) return Response.json([]);
      assert.match(url, /^http:\/\/nessie\.test\/accounts\/acc\?key=k$/);
      return Response.json(ACCOUNT);
    });
    try {
      await withSeed(null, async () => {
        const result = await fetchNessieAccount({
          apiKey: 'k',
          baseUrl: 'http://nessie.test/',
          accountId: 'acc',
        });
        assert.deepEqual(result.snapshot, {
          name: 'Margaret Hale',
          nickname: 'Everyday Checking',
          last4: '1234',
          // 6018 + (1+...+21=231) - 60 - 12.5
          balance: 6176.5,
        });
        assert.equal(result.activity.length, 20);
        assert.deepEqual(result.activity[0], {
          id: 't-live',
          kind: 'transfer',
          date: '2026-03-03',
          description: 'Rent',
          amount: -12.5,
          sortIndex: 0,
        });
        assert.deepEqual(result.activity[1], {
          id: 'w1',
          kind: 'withdrawal',
          date: '2026-02-02',
          description: 'ATM',
          amount: -60,
          sortIndex: 1,
        });
        assert.equal(result.activity[2]?.id, 'd20');
        assert.equal(result.activity[2]?.amount, 21);
        assert.equal(result.activity[2]?.sortIndex, 2);
        assert.equal(result.activity.find((row) => row.id === 'd0'), undefined);
        assert.equal(result.activity[19]?.sortIndex, 19);
        assert.deepEqual(result.payees, []);
      });
    } finally {
      restore();
    }
  });

  test('snapshot balance is opening plus live activity, not the frozen Nessie field', async () => {
    const restore = installFetch((url) => {
      if (url.includes('/customers/')) return Response.json({ first_name: 'Margaret', last_name: 'Hale' });
      if (url.includes('/deposits')) {
        return Response.json([
          { _id: 'd1', amount: 200, status: 'completed' },
          { _id: 'd-cancelled', amount: 999, status: 'cancelled' },
        ]);
      }
      if (url.includes('/withdrawals')) {
        return Response.json([{ _id: 'w1', amount: 50, status: 'completed' }]);
      }
      if (url.includes('/transfers')) {
        return Response.json([
          { _id: 't-out', amount: 25, status: 'completed' },
          { _id: 't-in', amount: 40, status: 'completed', payee_id: 'acc' },
        ]);
      }
      if (url.includes('/purchases')) {
        return Response.json([{ _id: 'p1', amount: 10, status: 'completed' }]);
      }
      return Response.json({
        _id: 'acc',
        type: 'Checking',
        nickname: 'Everyday Checking',
        balance: 1000,
        account_number: '1234',
        customer_id: 'cust-1',
      });
    });
    try {
      const result = await fetchNessieAccount({
        apiKey: 'k',
        baseUrl: 'http://nessie.test',
        accountId: 'acc',
      });
      // 1000 + 200 - 50 - 25 + 40 - 10 = 1155. Cancelled 999 is ignored.
      assert.equal(result.snapshot.balance, 1155);
    } finally {
      restore();
    }
  });

  test('customer GET failure still returns the account as Account', async () => {
    const restore = installFetch((url) => {
      if (url.includes('/customers/')) return new Response('nope', { status: 500 });
      if (url.includes('/deposits')) return new Response('No deposits found for this account', { status: 404 });
      if (url.includes('/withdrawals') || url.includes('/transfers') || url.includes('/purchases')) {
        return Response.json([]);
      }
      return Response.json({
        _id: 'zzzz9999',
        type: 'Savings',
        balance: 10,
        customer_id: 'cust-2',
      });
    });
    try {
      const result = await fetchNessieAccount({
        apiKey: 'k',
        baseUrl: 'http://nessie.test',
        accountId: 'acc',
      });
      assert.equal(result.snapshot.name, 'Account');
      assert.equal(result.snapshot.nickname, 'Savings');
      assert.equal(result.snapshot.last4, '9999');
      assert.equal(result.snapshot.balance, 10);
      assert.deepEqual(result.activity, []);
    } finally {
      restore();
    }
  });

  test('a failed activity list throws instead of returning a partial snapshot', async () => {
    const restore = installFetch((url) => {
      if (url.includes('/customers/')) return Response.json({ first_name: 'A', last_name: 'B' });
      if (url.includes('/deposits')) return new Response('boom', { status: 500 });
      if (url.includes('/withdrawals') || url.includes('/transfers') || url.includes('/purchases')) {
        return Response.json([]);
      }
      return Response.json(ACCOUNT);
    });
    try {
      await assert.rejects(
        () => fetchNessieAccount({ apiKey: 'k', baseUrl: 'http://nessie.test', accountId: 'acc' }),
        /Nessie/
      );
    } finally {
      restore();
    }
  });

  test('payees come from .seed.json and are not invented when it is missing', async () => {
    const restore = installFetch((url) => {
      if (url.includes('/customers/')) return Response.json({ first_name: 'A', last_name: 'B' });
      if (
        url.includes('/deposits') ||
        url.includes('/withdrawals') ||
        url.includes('/transfers') ||
        url.includes('/purchases')
      ) {
        return Response.json([]);
      }
      return Response.json(ACCOUNT);
    });
    const env = {
      apiKey: 'k',
      baseUrl: 'http://nessie.test',
      accountId: 'acc',
    };
    try {
      await withSeed(null, async () => {
        const missing = await fetchNessieAccount(env);
        assert.deepEqual(missing.payees, []);
      });
      await withSeed(
        `${JSON.stringify({
          payees: [{ name: 'Oakwood Apartments', nessieAccountId: 'landlord-1', trusted: true }],
        })}\n`,
        async () => {
          const present = await fetchNessieAccount(env);
          assert.deepEqual(present.payees, [
            { name: 'Oakwood Apartments', nessieAccountId: 'landlord-1', trusted: true },
          ]);
        }
      );
    } finally {
      restore();
    }
  });

  test('refreshAccount does not call reducers when the key or account id is missing', async () => {
    const prevKey = process.env.NESSIE_API_KEY;
    const prevAcct = process.env.NESSIE_ACCOUNT_ID;
    const prevErr = console.error;
    const logs: string[] = [];
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    const restore = installFetch(() => {
      throw new Error('fetch should not run');
    });
    const calls: string[] = [];
    const conn = {
      reducers: {
        upsertAccountSnapshot: () => calls.push('snapshot'),
        replaceActivity: () => calls.push('activity'),
        upsertPayee: () => calls.push('payee'),
      },
    };
    try {
      delete process.env.NESSIE_API_KEY;
      process.env.NESSIE_ACCOUNT_ID = 'acc';
      await refreshAccount(conn);
      delete process.env.NESSIE_ACCOUNT_ID;
      process.env.NESSIE_API_KEY = 'k';
      await refreshAccount(conn);
      assert.deepEqual(calls, []);
      assert.match(logs.join('\n'), /NESSIE_API_KEY/);
      assert.match(logs.join('\n'), /NESSIE_ACCOUNT_ID/);
    } finally {
      console.error = prevErr;
      restore();
      if (prevKey === undefined) delete process.env.NESSIE_API_KEY;
      else process.env.NESSIE_API_KEY = prevKey;
      if (prevAcct === undefined) delete process.env.NESSIE_ACCOUNT_ID;
      else process.env.NESSIE_ACCOUNT_ID = prevAcct;
    }
  });

  test('refreshAccount logs a fetch failure and does not call reducers', async () => {
    const prevKey = process.env.NESSIE_API_KEY;
    const prevAcct = process.env.NESSIE_ACCOUNT_ID;
    const prevBase = process.env.NESSIE_BASE_URL;
    const prevErr = console.error;
    const logs: string[] = [];
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    const restore = installFetch(() => new Response('nope', { status: 404 }));
    const calls: string[] = [];
    try {
      process.env.NESSIE_API_KEY = 'k';
      process.env.NESSIE_ACCOUNT_ID = 'acc';
      process.env.NESSIE_BASE_URL = 'http://nessie.test';
      await refreshAccount({
        reducers: {
          upsertAccountSnapshot: () => calls.push('snapshot'),
          replaceActivity: () => calls.push('activity'),
          upsertPayee: () => calls.push('payee'),
        },
      });
      assert.deepEqual(calls, []);
      assert.match(logs.join('\n'), /Nessie/);
    } finally {
      console.error = prevErr;
      restore();
      if (prevKey === undefined) delete process.env.NESSIE_API_KEY;
      else process.env.NESSIE_API_KEY = prevKey;
      if (prevAcct === undefined) delete process.env.NESSIE_ACCOUNT_ID;
      else process.env.NESSIE_ACCOUNT_ID = prevAcct;
      if (prevBase === undefined) delete process.env.NESSIE_BASE_URL;
      else process.env.NESSIE_BASE_URL = prevBase;
    }
  });

  test('refreshAccount upserts the snapshot, replaces activity, and upserts each payee', async () => {
    const prevKey = process.env.NESSIE_API_KEY;
    const prevAcct = process.env.NESSIE_ACCOUNT_ID;
    const prevBase = process.env.NESSIE_BASE_URL;
    const restore = installFetch((url) => {
      if (url.includes('/customers/')) return Response.json({ first_name: 'Margaret', last_name: 'Hale' });
      if (url.includes('/deposits')) {
        return Response.json([
          { _id: 'd1', transaction_date: '2026-04-04', description: 'Social Security', amount: 1650 },
        ]);
      }
      if (url.includes('/withdrawals') || url.includes('/transfers') || url.includes('/purchases')) {
        return Response.json([]);
      }
      return Response.json(ACCOUNT);
    });
    const calls: { name: string; args: unknown }[] = [];
    try {
      process.env.NESSIE_API_KEY = 'k';
      process.env.NESSIE_ACCOUNT_ID = 'acc-9';
      process.env.NESSIE_BASE_URL = 'http://nessie.test';
      await withSeed(
        `${JSON.stringify({
          payees: [
            { name: 'Oakwood Apartments', nessieAccountId: 'landlord-1', trusted: true },
            { name: 'DTE Energy', nessieAccountId: '', trusted: false },
          ],
        })}\n`,
        async () => {
          await refreshAccount({
            reducers: {
              upsertAccountSnapshot: (args) => calls.push({ name: 'snapshot', args }),
              replaceActivity: (args) => calls.push({ name: 'activity', args }),
              upsertPayee: (args) => calls.push({ name: 'payee', args }),
            },
          });
        }
      );
      assert.deepEqual(calls, [
        {
          name: 'snapshot',
          args: {
            name: 'Margaret Hale',
            nickname: 'Everyday Checking',
            last4: '1234',
            balance: 7668,
          },
        },
        {
          name: 'activity',
          args: {
            rows: [
              {
                id: 'd1',
                kind: 'deposit',
                date: '2026-04-04',
                description: 'Social Security',
                amount: 1650,
                sortIndex: 0,
              },
            ],
          },
        },
        {
          name: 'payee',
          args: { name: 'Oakwood Apartments', nessieAccountId: 'landlord-1', trusted: true },
        },
        {
          name: 'payee',
          args: { name: 'DTE Energy', nessieAccountId: '', trusted: false },
        },
      ]);
    } finally {
      restore();
      if (prevKey === undefined) delete process.env.NESSIE_API_KEY;
      else process.env.NESSIE_API_KEY = prevKey;
      if (prevAcct === undefined) delete process.env.NESSIE_ACCOUNT_ID;
      else process.env.NESSIE_ACCOUNT_ID = prevAcct;
      if (prevBase === undefined) delete process.env.NESSIE_BASE_URL;
      else process.env.NESSIE_BASE_URL = prevBase;
    }
  });
});
