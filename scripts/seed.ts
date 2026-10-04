/**
 * `pnpm seed`: creates the demo customer in the real Nessie API and writes the
 * ids to .seed.json, which the relay reads at startup.
 *
 *   Margaret Hale, with a checking account that shows $8,400
 *   a landlord (Oakwood Apartments) with its own account, as a trusted payee
 *   a recurring $94 DTE Energy bill
 *   a $1,650 Social Security deposit
 *
 *   pnpm seed            # does nothing if .seed.json already exists
 *   pnpm seed --force    # replaces the seeded accounts and overwrites .seed.json
 *
 * This is a Node script, not part of the Spacetime module.
 */
// SPEC-QUESTION: the spec says this matches seed() in nessie_guard.py, which
// was not in the repo. It is written from section 5 and from what the live API
// accepts (checked 2026-10-03):
//   - Nessie never changes an account's `balance` when a deposit posts, so the
//     account opens at $6,750 and the $1,650 deposit brings the dashboard
//     balance (opening balance plus activity) to $8,400.
//   - `account_number` is assigned by the server; one sent in the request is ignored.
//   - Deposits need a `status`. Customers cannot be deleted, so they are reused.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = resolve(ROOT, ".seed.json");
const DAY_MS = 24 * 60 * 60 * 1000;

const BALANCE = 8400;
const DEPOSIT = 1650;
const DTE_BILL = 94;

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = resolve(ROOT, ".env");
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return { ...out, ...(process.env as Record<string, string>) };
}

const env = readEnv();
const KEY = (env.NESSIE_KEY ?? "").trim();
const BASE = (env.NESSIE_BASE || "https://prod-api.nessieisreal.com").replace(/\/+$/, "");

const day = (offset: number): string => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

/** The key goes in the query string, so URLs are never printed: only the path is. */
async function request(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
  const init: RequestInit = { method, headers: { accept: "application/json", "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}?key=${encodeURIComponent(KEY)}`, init);
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, json };
}

/**
 * POSTs and returns the new object's id. Create calls may return a plain
 * string instead of the new object; then the list is fetched again and the
 * newest item is used.
 */
async function create(path: string, body: unknown, listPath = path): Promise<string> {
  const res = await request("POST", path, body);
  if (!res.ok) throw new Error(`POST ${path} failed (${res.status}): ${JSON.stringify(res.json).slice(0, 200)}`);
  const created = (res.json as { objectCreated?: { _id?: string }; _id?: string } | undefined) ?? {};
  const id = created.objectCreated?._id ?? created._id;
  if (typeof id === "string") return id;

  const list = await request("GET", listPath);
  const items = Array.isArray(list.json) ? (list.json as { _id?: string }[]) : [];
  const newest = items[items.length - 1]?._id;
  if (!newest) throw new Error(`POST ${path} did not return an id, and GET ${listPath} found nothing.`);
  return newest;
}

interface Customer {
  _id: string;
  first_name: string;
  last_name: string;
}

/** Customers cannot be deleted, so a second run reuses the one it finds. */
async function customer(firstName: string, lastName: string, address: Record<string, string>): Promise<string> {
  const list = await request("GET", "/customers");
  const existing = Array.isArray(list.json) ? (list.json as Customer[]).find((c) => c.first_name === firstName && c.last_name === lastName) : undefined;
  return existing?._id ?? create("/customers", { first_name: firstName, last_name: lastName, address });
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error("NESSIE_KEY is not set. Add it to .env (get a key at https://nessieisreal.com).");
    process.exit(1);
  }
  if (existsSync(SEED_PATH)) {
    if (!process.argv.includes("--force")) {
      console.log(".seed.json already exists. Use `pnpm seed --force` to replace the seeded accounts.");
      return;
    }
    const old = JSON.parse(readFileSync(SEED_PATH, "utf8")) as { accountId?: string; payees?: { nessieAccountId?: string }[] };
    for (const id of [old.accountId, ...(old.payees ?? []).map((p) => p.nessieAccountId)]) {
      if (id) await request("DELETE", `/accounts/${id}`);
    }
  }

  console.log(`Seeding ${BASE} ...`);
  const address = { street_number: "418", street_name: "Linden Street", city: "Ann Arbor", state: "MI", zip: "48104" };
  const customerId = await customer("Margaret", "Hale", address);
  console.log(`  customer   Margaret Hale (${customerId})`);

  // History the dashboard and the account analysis read back. Nessie stores
  // whole dollars and never changes `balance`, so the account opens at the
  // amount that makes opening balance plus activity come to $8,400.
  const deposits = [
    { transaction_date: day(-3), amount: DEPOSIT, description: "Social Security" },
    { transaction_date: day(-17), amount: 420, description: "Pension, Washtenaw County Schools" },
  ];
  const withdrawals = [{ transaction_date: day(-9), amount: 60, description: "ATM withdrawal" }];
  const transfers = [{ transaction_date: day(-2), amount: 1100, description: "Transfer to Oakwood Apartments" }];
  const shops = [
    { name: "Kroger", category: "grocery", purchases: [{ purchase_date: day(-11), amount: 72 }, { purchase_date: day(-4), amount: 64 }] },
    { name: "Corner Pharmacy", category: "pharmacy", purchases: [{ purchase_date: day(-6), amount: 18 }] },
    { name: "Stadium Hardware", category: "hardware_store", purchases: [{ purchase_date: day(-1), amount: 23 }] },
  ];
  const sum = (rows: { amount: number }[]): number => rows.reduce((total, r) => total + r.amount, 0);
  const opening = BALANCE - sum(deposits) + sum(withdrawals) + sum(transfers) + sum(shops.flatMap((m) => m.purchases));

  const accountId = await create(`/customers/${customerId}/accounts`, { type: "Checking", nickname: "Everyday Checking", rewards: 0, balance: opening });
  console.log(`  account    Everyday Checking (${accountId}): opens at $${opening}, dashboard balance $${BALANCE}`);

  let depositId = "";
  for (const d of deposits) {
    const id = await create(`/accounts/${accountId}/deposits`, { medium: "balance", status: "completed", ...d });
    depositId ||= id;
  }
  for (const w of withdrawals) await create(`/accounts/${accountId}/withdrawals`, { medium: "balance", status: "completed", ...w });
  for (const t of transfers) await create(`/accounts/${accountId}/transfers`, { status: "completed", ...t });
  console.log(`  history    ${deposits.length} deposits, ${withdrawals.length} withdrawal, ${transfers.length} transfer`);

  // Merchants are shared across the key, so existing ones are reused.
  const existing = await request("GET", "/merchants");
  const known = Array.isArray(existing.json) ? (existing.json as { _id: string; name: string }[]) : [];
  let purchaseCount = 0;
  for (const shop of shops) {
    const merchantId =
      known.find((m) => m.name === shop.name)?._id ??
      (await create("/merchants", { name: shop.name, category: shop.category, address: { ...address, street_number: "100", street_name: "Main Street" }, geocode: { lat: 42.28, lng: -83.74 } }));
    for (const p of shop.purchases) {
      await create(`/accounts/${accountId}/purchases`, { merchant_id: merchantId, medium: "balance", status: "completed", description: shop.name, ...p });
      purchaseCount++;
    }
  }
  console.log(`  purchases  ${purchaseCount} at ${shops.length} merchants`);

  const billId = await create(`/accounts/${accountId}/bills`, {
    status: "recurring",
    payee: "DTE Energy",
    nickname: "Electric and gas",
    payment_date: day(9),
    recurring_date: Number(day(9).slice(8, 10)),
    payment_amount: DTE_BILL,
  });
  // Every bill needs recurring_date: one saved without it makes the account's bill list fail.
  const dayOfMonth = (offset: number): number => Number(day(offset).slice(8, 10));
  await create(`/accounts/${accountId}/bills`, { status: "pending", payee: "Ann Arbor Water", nickname: "Water", payment_date: day(5), recurring_date: dayOfMonth(5), payment_amount: 38 });
  await create(`/accounts/${accountId}/bills`, { status: "completed", payee: "Oakwood Apartments", nickname: "Rent", payment_date: day(-2), recurring_date: dayOfMonth(-2), payment_amount: 1100 });
  console.log(`  bills      $${DTE_BILL} DTE Energy (recurring), $38 water (pending), $1,100 rent (paid)`);

  const landlordCustomerId = await customer("Oakwood", "Apartments", { ...address, street_number: "1200", street_name: "Oakwood Avenue" });
  const landlordAccountId = await create(`/customers/${landlordCustomerId}/accounts`, { type: "Checking", nickname: "Oakwood Apartments rent", rewards: 0, balance: 0 });
  console.log(`  landlord   Oakwood Apartments (${landlordAccountId})`);

  const seed = {
    customerId,
    accountId,
    billId,
    depositId,
    landlordCustomerId,
    payees: [
      { name: "Oakwood Apartments", nessieAccountId: landlordAccountId, trusted: true },
      { name: "DTE Energy", nessieAccountId: "", trusted: true },
    ],
  };
  writeFileSync(SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`);
  console.log("Wrote .seed.json. Run `pnpm dev` with MOCK=0 to use it.");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
