import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// A real Postgres, because what is under test lives there: the settle functions,
// their locking, the unique indexes, the append-only trigger. CI provides one;
// locally, point TEST_DATABASE_URL at any server you can create databases on.
const SERVER = process.env.TEST_DATABASE_URL;
// Skipping is for a laptop without Postgres. In CI a missing database is a
// broken setup, and a green run that skipped these would say nothing.
if (process.env.CI && !SERVER) throw new Error("TEST_DATABASE_URL is not set; CI must run the database tests");

const MIGRATIONS = "supabase/migrations";
const A = "00000000-0000-0000-0000-00000000000a"; // owes
const W = "00000000-0000-0000-0000-00000000000b"; // holds the wallet that pays
const SVC = "00000000-0000-0000-0000-0000000000c1";
const LIVE = "00000000-0000-0000-0000-0000000000d1";
const DELETED = "00000000-0000-0000-0000-0000000000d2";
const DELETED_ONE_OFF = "00000000-0000-0000-0000-0000000000d3";

const created: string[] = [];
let admin: pg.Client;

/** A fresh database with the schema built from the migrations, in order. */
async function database(): Promise<pg.Client> {
  const name = `playground_test_${process.pid}_${created.length}_${Date.now()}`;
  await admin.query(`create database "${name}"`);
  created.push(name);
  const url = new URL(SERVER!);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await client.query(readFileSync("test/sql/base-schema.sql", "utf8"));
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await client.query(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return client;
}

/** A live unpaid charge of 30 for A, two deleted unpaid ones of 50 and 20 (one of
 *  them a one-off), and a wallet of `wallet` held by W. */
async function seed(c: pg.Client, wallet = 100) {
  await c.query(`insert into subscribers (id, name) values ($1, 'Ann'), ($2, 'Wal')`, [A, W]);
  await c.query(`insert into services (id, name, monthly_cost, currency) values ($1, 'Svc', 10, 'SGD')`, [SVC]);
  await c.query(`insert into wallet_entries (subscriber_id, amount_cny, kind) values ($1, $2, 'topup')`, [W, wallet]);
  await c.query(
    `insert into charges (id, subscriber_id, service_id, label, period_start, period_end, monthly_cost, currency, exchange_rate, total_cny, deleted_at) values
      ($1, $4, $5, null,      '2026-08', '2026-08', 10, 'SGD', 3, 30, null),
      ($2, $4, $5, null,      '2026-07', '2026-07', 10, 'SGD', 5, 50, now()),
      ($3, $4, null, 'once',  '2026-06', '2026-06', 20, 'SGD', 1, 20, now())`,
    [LIVE, DELETED, DELETED_ONE_OFF, A, SVC],
  );
}

const Z = "00000000-0000-0000-0000-00000000000e"; // may pay from W's wallet

/** Ann, Wal and Zed, and a service, with no money and nothing owed. */
async function people(c: pg.Client) {
  await c.query(`insert into subscribers (id, name) values ($1, 'Ann'), ($2, 'Wal'), ($3, 'Zed')`, [A, W, Z]);
  await c.query(`insert into services (id, name, monthly_cost, currency) values ($1, 'Svc', 10, 'SGD')`, [SVC]);
}
const topUp = (c: pg.Client, who: string, amount: number) =>
  c.query(`insert into wallet_entries (subscriber_id, amount_cny, kind) values ($1, $2, 'topup')`, [who, amount]);
/** An unpaid one-off charge for `who` in `month`, and its id. */
async function charge(c: pg.Client, who: string, month: string, amount: number, { deleted = false } = {}): Promise<string> {
  return (await c.query(
    `insert into charges (subscriber_id, service_id, label, period_start, period_end, monthly_cost, currency, exchange_rate, total_cny, deleted_at)
     values ($1, null, 'once', $2, $2, $3, 'CNY', 1, $3, case when $4 then now() end) returning id`,
    [who, month, amount, deleted],
  )).rows[0].id;
}
const paidOf = async (c: pg.Client, ids: string[]) => {
  const { rows } = await c.query(`select id, paid from charges where id = any($1::uuid[])`, [ids]);
  return ids.map((id) => rows.find((r) => r.id === id)?.paid);
};

const balance = async (c: pg.Client, who = W) =>
  Number((await c.query(`select coalesce(sum(amount_cny), 0) as b from wallet_entries where subscriber_id = $1`, [who])).rows[0].b);
const paid = async (c: pg.Client) =>
  Object.fromEntries((await c.query(`select id, paid from charges`)).rows.map((r) => [r.id, r.paid]));

/** The error a statement raises, with the transaction kept usable afterwards. */
async function failure(c: pg.Client, sql: string, params: unknown[] = []): Promise<{ message: string; code?: string; constraint?: string }> {
  await c.query("savepoint probe");
  try {
    await c.query(sql, params);
  } catch (err) {
    await c.query("rollback to savepoint probe");
    return err as { message: string; code?: string; constraint?: string };
  }
  throw new Error(`expected this to fail: ${sql}`);
}

describe.skipIf(!SERVER)("database", () => {
  let c: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: SERVER });
    await admin.connect();
    c = await database();
  });

  afterAll(async () => {
    await c?.end();
    for (const name of created) await admin.query(`drop database if exists "${name}" with (force)`);
    await admin?.end();
  });

  // Every test runs in a transaction that is rolled back, so each starts from
  // the migrated schema and nothing else.
  beforeEach(async () => {
    await c.query("begin");
    return async () => { await c.query("rollback"); };
  });

  describe("settle_person", () => {
    it("settles the live charges only -- the total its dialog shows -- and leaves deleted ones unpaid", async () => {
      await seed(c);
      const row = (await c.query(`select * from settle_person($1, $2)`, [A, W])).rows[0];
      expect([row.settled, Number(row.total), Number(row.balance_left)]).toEqual([1, 30, 70]);
      expect(await balance(c)).toBe(70);
      expect(await paid(c)).toEqual({ [LIVE]: true, [DELETED]: false, [DELETED_ONE_OFF]: false });
      // The touch trigger stamps when it was paid.
      const stamped = (await c.query(`select paid_at, paid_date from charges where id = $1`, [LIVE])).rows[0];
      expect(stamped.paid_at).not.toBeNull();
      expect(stamped.paid_date).not.toBeNull();
    });

    it("finds nothing outstanding when everything unpaid has been deleted", async () => {
      await seed(c);
      await c.query(`update charges set deleted_at = now() where id = $1`, [LIVE]);
      expect((await failure(c, `select * from settle_person($1, $2)`, [A, W])).message).toBe("Nothing outstanding for that person");
    });

    it("settles none of it when the wallet cannot cover all of it", async () => {
      await seed(c, 20);
      expect((await failure(c, `select * from settle_person($1, $2)`, [A, W])).message)
        .toBe("Not enough in the wallet for all 1 charge(s): 20.00 available, 30.00 needed");
      expect(await balance(c)).toBe(20);
      expect((await paid(c))[LIVE]).toBe(false);
    });
  });

  describe("settle_charge and unsettle_charge", () => {
    it("refuses a deleted charge, and one already settled", async () => {
      await seed(c);
      expect((await failure(c, `select settle_charge($1, $2)`, [DELETED, W])).message).toBe("That charge has been deleted");
      expect(Number((await c.query(`select settle_charge($1, $2) as left`, [LIVE, W])).rows[0].left)).toBe(70);
      expect((await failure(c, `select settle_charge($1, $2)`, [LIVE, W])).message).toBe("That charge is already settled");
    });

    it("reverses a settlement by posting the opposite entry, keeping the original", async () => {
      await seed(c);
      await c.query(`select settle_charge($1, $2)`, [LIVE, W]);
      expect(Number((await c.query(`select unsettle_charge($1) as left`, [LIVE])).rows[0].left)).toBe(100);
      expect((await paid(c))[LIVE]).toBe(false);
      const kinds = (await c.query(`select kind from wallet_entries order by created_at, kind`)).rows.map((r) => r.kind);
      expect(kinds.sort()).toEqual(["adjustment", "charge", "topup"]);
    });
  });

  describe("auto_settle", () => {
    it("pays a person's charges from their own wallet, oldest first, each one the balance still covers", async () => {
      await people(c);
      await topUp(c, A, 60);
      // Written newest first, so the order paid is the months', not the rows'.
      const september = await charge(c, A, "2026-09", 20);
      const august = await charge(c, A, "2026-08", 30);
      const july = await charge(c, A, "2026-07", 40);
      const gone = await charge(c, A, "2026-06", 10, { deleted: true });
      const free = await charge(c, A, "2026-05", 0);

      const rows = (await c.query(`select * from auto_settle(array[$1]::uuid[])`, [A])).rows;
      // July's 40 first; August's 30 does not fit in the 20 left; September's 20 does.
      expect(rows.map((r) => [r.wallet, r.settled, Number(r.total), Number(r.balance_left)])).toEqual([[A, 2, 60, 0]]);
      expect(await paidOf(c, [july, august, september, gone, free])).toEqual([true, false, true, false, false]);
      expect(await balance(c, A)).toBe(0);
      const entries = (await c.query(`select charge_id, amount_cny, kind, note from wallet_entries where kind = 'charge' order by amount_cny`)).rows;
      expect(entries.map((e) => [e.charge_id, Number(e.amount_cny), e.note])).toEqual([[july, -40, "Auto-settled"], [september, -20, "Auto-settled"]]);
      // The touch trigger stamps when it was paid, as for any settlement.
      expect((await c.query(`select paid_at from charges where id = $1`, [july])).rows[0].paid_at).not.toBeNull();
    });

    it("pays from the wallet a person pays from, for everyone sharing it, and leaves their own wallet alone", async () => {
      await people(c);
      await c.query(`update subscribers set pays_from = $1 where id = $2`, [W, Z]);
      await topUp(c, W, 100);
      await topUp(c, Z, 40);
      const theirs = await charge(c, Z, "2026-08", 50);
      const mine = await charge(c, W, "2026-09", 30);

      // Asking for Zed settles the whole wallet Zed pays from, Wal's own charge too.
      const rows = (await c.query(`select * from auto_settle(array[$1]::uuid[])`, [Z])).rows;
      expect(rows.map((r) => [r.wallet, r.settled, Number(r.total), Number(r.balance_left)])).toEqual([[W, 2, 80, 20]]);
      expect(await paidOf(c, [theirs, mine])).toEqual([true, true]);
      expect([await balance(c, W), await balance(c, Z)]).toEqual([20, 40]);
    });

    it("settles every wallet when given nobody in particular, and nothing more the second time", async () => {
      await people(c);
      await topUp(c, A, 30);
      await topUp(c, W, 30);
      await charge(c, A, "2026-09", 30);
      await charge(c, W, "2026-09", 25);
      await charge(c, W, "2026-10", 25);

      const first = (await c.query(`select * from auto_settle()`)).rows;
      expect(first.map((r) => [r.wallet, r.settled]).sort()).toEqual([[A, 1], [W, 1]].sort());
      expect((await c.query(`select * from auto_settle()`)).rows).toEqual([]);
      expect([await balance(c, A), await balance(c, W)]).toEqual([0, 5]);
    });

    it("posts nothing for a wallet that covers none of it", async () => {
      await people(c);
      await topUp(c, A, 10);
      const owed = await charge(c, A, "2026-09", 30);
      expect((await c.query(`select * from auto_settle(array[$1]::uuid[])`, [A])).rows).toEqual([]);
      expect(await paidOf(c, [owed])).toEqual([false]);
      expect((await c.query(`select count(*)::int as n from wallet_entries`)).rows[0].n).toBe(1);
    });

    it("is undone like any settlement, and pays the charge again when asked again", async () => {
      await people(c);
      await topUp(c, A, 30);
      const owed = await charge(c, A, "2026-09", 30);
      await c.query(`select * from auto_settle(array[$1]::uuid[])`, [A]);
      expect(Number((await c.query(`select unsettle_charge($1) as left`, [owed])).rows[0].left)).toBe(30);
      expect(await paidOf(c, [owed])).toEqual([false]);
      expect((await c.query(`select * from auto_settle(array[$1]::uuid[])`, [A])).rows).toHaveLength(1);
      expect(await balance(c, A)).toBe(0);
    });

    it("keeps pays_from one wallet deep, and never pointing at the person themselves", async () => {
      await people(c);
      await c.query(`update subscribers set pays_from = $1 where id = $2`, [W, Z]);
      const deeper = await failure(c, `update subscribers set pays_from = $1 where id = $2`, [Z, A]);
      expect([deeper.code, deeper.message]).toEqual(["23514", "Zed pays from another wallet, so nobody can pay from theirs"]);
      const payer = await failure(c, `update subscribers set pays_from = $1 where id = $2`, [A, W]);
      expect([payer.code, payer.message]).toEqual(["23514", "Others pay from Wal's wallet, so it cannot pay from another"]);
      const self = await failure(c, `update subscribers set pays_from = $1 where id = $1`, [A]);
      expect(self.code).toBe("23514");
      // Back to their own wallet is always allowed, and then Wal may pay from another.
      await c.query(`update subscribers set pays_from = null where id = $1`, [Z]);
      await c.query(`update subscribers set pays_from = $1 where id = $2`, [A, W]);
      // A wallet others pay from cannot be deleted from under them.
      expect((await failure(c, `delete from subscribers where id = $1`, [A])).code).toBe("23503");
    });
  });

  describe("constraints", () => {
    it("keeps wallet entries append-only", async () => {
      await seed(c);
      expect((await failure(c, `update wallet_entries set amount_cny = 1`)).message).toMatch(/append-only/);
      expect((await failure(c, `delete from wallet_entries`)).message).toMatch(/append-only/);
    });

    it("allows one live charge per subscriber, service and month -- but not counting deleted ones or one-offs", async () => {
      await seed(c);
      const again = `insert into charges (subscriber_id, service_id, label, period_start, period_end, monthly_cost, currency, exchange_rate, total_cny)
                     values ($1, $2, $3, $4, $4, 10, 'SGD', 3, 30)`;
      const dup = await failure(c, again, [A, SVC, null, "2026-08"]);
      expect([dup.code, dup.constraint]).toEqual(["23505", "charges_one_per_service_month"]);
      // July's charge is deleted, so July can be billed again.
      await c.query(again, [A, SVC, null, "2026-07"]);
      // Two one-off expenses in one month are two expenses.
      await c.query(again, [A, null, "taxi", "2026-08"]);
      await c.query(again, [A, null, "taxi", "2026-08"]);
    });

    it("allows one default card, and the app's order -- clear all, then set one -- goes through", async () => {
      const card = `insert into payment_methods (cardholder_name, last4, expiry_month, expiry_year, is_default) values ('Ann', $1, 1, 2030, $2) returning id`;
      await c.query(card, ["1111", true]);
      const second = (await c.query(card, ["2222", false])).rows[0].id;
      const dup = await failure(c, `update payment_methods set is_default = true where id = $1`, [second]);
      expect([dup.code, dup.constraint]).toEqual(["23505", "payment_methods_one_default"]);
      await c.query(`update payment_methods set is_default = false where not (id is null)`);
      await c.query(`update payment_methods set is_default = true where id = $1`, [second]);
      expect((await c.query(`select last4 from payment_methods where is_default`)).rows).toEqual([{ last4: "2222" }]);
    });
  });

  // Supabase's advisors check a live project; these hold every migration to the
  // same rules before it gets there.
  describe("what Supabase's advisors check", () => {
    it("pins search_path on every function in public (lint 0011)", async () => {
      const { rows } = await c.query(`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
        order by 1`);
      expect(rows.map((r) => r.proname)).toEqual([]);
    });

    it("covers every foreign key in public with an index that starts with its columns (lint 0001)", async () => {
      // The advisor's own rule: an index counts when its leading columns are the
      // key's, in order. Partial indexes count too, as they do there.
      const { rows } = await c.query(`
        select con.conrelid::regclass || '.' || con.conname as fkey
        from pg_constraint con join pg_namespace n on n.oid = con.connamespace
        where n.nspname = 'public' and con.contype = 'f'
          and not exists (
            select 1 from pg_index i
            where i.indrelid = con.conrelid and i.indisvalid
              and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(con.conkey)] = con.conkey)
        order by 1`);
      expect(rows.map((r) => r.fkey)).toEqual([]);
    });
  });

  describe("the public key and the split bill", () => {
    const TABLES = ["services", "subscribers", "subscriptions", "charges", "payment_methods", "wallet_entries"];
    const SETTLE = ["settle_charge(uuid, uuid, text)", "settle_person(uuid, uuid, text)", "unsettle_charge(uuid, text)"];
    const may = async (sql: string, params: unknown[]) => (await c.query(`select ${sql} as ok`, params)).rows[0].ok as boolean;

    it("can read it, and hold no privilege to write it or to call the settle functions", async () => {
      for (const role of ["anon", "authenticated"]) {
        for (const table of TABLES) {
          expect(await may(`has_table_privilege($1, $2, 'select')`, [role, table]), `${role} select ${table}`).toBe(table !== "payment_methods");
          for (const privilege of ["insert", "update", "delete", "truncate"]) {
            expect(await may(`has_table_privilege($1, $2, $3)`, [role, table, privilege]), `${role} ${privilege} ${table}`).toBe(false);
          }
        }
        for (const fn of SETTLE) expect(await may(`has_function_privilege($1, $2, 'execute')`, [role, fn]), `${role} ${fn}`).toBe(false);
      }
      for (const fn of SETTLE) expect(await may(`has_function_privilege('service_role', $1, 'execute')`, [fn])).toBe(true);
      expect(await may(`has_table_privilege('service_role', 'charges', 'insert')`, [])).toBe(true);
    });

    it("sees which card pays, but not the holder's name or the expiry", async () => {
      await c.query(`insert into payment_methods (label, cardholder_name, card_type, last4, expiry_month, expiry_year) values ('Main', 'Ann Lee', 'visa', '4242', 4, 2031)`);
      await c.query(`set local role anon`);
      expect((await c.query(`select label, card_type, last4, is_default from payment_methods`)).rows).toEqual([
        { label: "Main", card_type: "visa", last4: "4242", is_default: false },
      ]);
      for (const sql of [`select * from payment_methods`, `select cardholder_name from payment_methods`, `select expiry_year from payment_methods`]) {
        expect((await failure(c, sql)).code, sql).toBe("42501");
      }
      expect((await failure(c, `select settle_charge($1, $2, null)`, [LIVE, W])).code).toBe("42501");
      await c.query(`reset role`);
    });

    it("can call no function in public: each migration that adds one revokes it", async () => {
      const { rows } = await c.query(`
        select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
        order by 1`);
      expect(rows.map((r) => r.fn)).toEqual([]);
    });
  });

  describe("finance", () => {
    it("keeps an API token only as a well-formed, unique hash, under a name", async () => {
      const hash = "ab".repeat(32);
      await c.query(`insert into finance_api_tokens (name, token_sha256) values ('Laptop agent', $1)`, [hash]);
      expect((await failure(c, `insert into finance_api_tokens (name, token_sha256) values ('again', $1)`, [hash])).code).toBe("23505");
      for (const [name, sha] of [["x", "pgf_not-a-hash"], ["x", "AB".repeat(32)], ["x", "ab".repeat(31)], ["  ", "cd".repeat(32)], ["x".repeat(61), "ef".repeat(32)]]) {
        expect((await failure(c, `insert into finance_api_tokens (name, token_sha256) values ($1, $2)`, [name, sha])).code, `${name} ${sha}`).toBe("23514");
      }
    });

    it("preserves legacy token authority and accepts only the three explicit scopes", async () => {
      const result = await c.query(`insert into finance_api_tokens (name,token_sha256) values ('Legacy',repeat('a',64)) returning scope`);
      expect(result.rows[0].scope).toBe("finance:write");
      for (const [k,scope] of ["housing:read","finance:read","finance:write"].entries()) {
        const row = await c.query(`insert into finance_api_tokens (name,token_sha256,scope) values ('Scoped',$1,$2) returning scope`, [String(k+1).repeat(64),scope]);
        expect(row.rows[0].scope).toBe(scope);
      }
      expect((await failure(c,`insert into finance_api_tokens (name,token_sha256,scope) values ('Bad',repeat('b',64),'all')`)).code).toBe("23514");
      expect((await failure(c,`update finance_api_tokens set scope=null`)).code).toBe("23502");
    });

    const ACCOUNT = "00000000-0000-0000-0000-0000000000f1";
    const account = (currency = "SGD") => c.query(
      `insert into finance_accounts (id, name, region, currency, kind, category) values ($1, 'DBS', 'SG', $2, 'asset', 'cash')`,
      [ACCOUNT, currency],
    );
    const balance = (as_of: string, currency = "SGD", amount = 1000) => c.query(
      `insert into finance_balances (account_id, as_of, currency, amount, cny_rate, sgd_rate, rate_date)
       values ($1, $2, $3, $4, 5.3, 1, $2) returning *`,
      [ACCOUNT, as_of, currency, amount],
    );

    it("is private: neither the anon key nor a signed-in session can read or write it, the service role can", async () => {
      await account();
      await balance("2026-09-30");
      for (const role of ["anon", "authenticated"]) {
        await c.query(`set local role ${role}`);
        for (const sql of [
          `select * from finance_accounts`,
          `select * from finance_balances`,
          `insert into finance_accounts (name, region, currency, kind, category) values ('x', 'CN', 'CNY', 'asset', 'cash')`,
          `update finance_balances set amount = 0`,
          `delete from finance_balances`,
          `select * from finance_api_tokens`,
          `insert into finance_api_tokens (name, token_sha256) values ('x', repeat('a', 64))`,
          `select * from finance_loan_rate_changes`,
          `insert into finance_loan_rate_changes (account_id, effective_date, rate) values ('${ACCOUNT}', '2027-01-01', 3)`,
          `select * from finance_loan_prepayments`,
          `insert into finance_loan_prepayments (account_id, paid_on, amount, mode) values ('${ACCOUNT}', '2027-01-01', 1000, 'shorten')`,
          `select * from finance_rsu_grants`,
          `insert into finance_rsu_grants (account_id, grant_no, profile, tranches) values ('${ACCOUNT}', 'G1', 'standard', '[{"vests_on":"2026-01-01","shares":1}]')`,
          `select * from finance_rsu_sales`,
          `insert into finance_rsu_sales (account_id, window_cutoff, shares) values ('${ACCOUNT}', '2026-10-01', 1)`,
          `select * from finance_stock_positions`,
          `insert into finance_stock_positions (account_id, symbol, quantity, cost, currency) values ('${ACCOUNT}', 'AAPL', 1, 1, 'USD')`,
        ]) {
          expect((await failure(c, sql)).code, `${role}: ${sql}`).toBe("42501");
        }
        // The contrast: the split-bill tables stay readable, as designed.
        await c.query(`select count(*) from charges`);
        await c.query(`reset role`);
      }
      await c.query(`set local role service_role`);
      expect((await c.query(`select count(*)::int as n from finance_balances`)).rows[0].n).toBe(1);
      await c.query(`reset role`);
    });

    it("holds RSUs on an asset only, their rules with a plan, a grant by its number and a sale by its window", async () => {
      await account();
      const rules = JSON.stringify({ currency: "USD", windows: { months: [3, 9], cutoff_day: 15 }, profiles: { standard: { rates: [40] } } });
      expect((await failure(c, `update finance_accounts set rsu_rules = $1 where id = $2`, [rules, ACCOUNT])).code).toBe("23514");
      expect((await failure(c, `update finance_accounts set rsu_plan = 'acme' where id = $1`, [ACCOUNT])).code).toBe("23514");
      await c.query(`update finance_accounts set rsu_plan = 'tiktok', rsu_rules = $1 where id = $2`, [rules, ACCOUNT]);
      expect((await failure(c, `update finance_accounts set kind = 'liability', category = 'loan' where id = $1`, [ACCOUNT])).code).toBe("23514");

      const grant = (no: string, tranches = '[{"vests_on":"2026-01-01","shares":10}]', profile = "standard") =>
        `insert into finance_rsu_grants (account_id, grant_no, profile, tranches) values ('${ACCOUNT}', '${no}', '${profile}', '${tranches}')`;
      await c.query(grant("G1"));
      expect((await failure(c, grant("G1"))).code).toBe("23505");
      for (const bad of [grant(" "), grant("G2", "[]"), grant("G3", '{"vests_on":"2026-01-01"}'), grant("G4", undefined, "Not A Profile")]) {
        expect((await failure(c, bad)).code, bad).toBe("23514");
      }
      const sale = (cutoff: string, shares = 5) => `insert into finance_rsu_sales (account_id, window_cutoff, shares) values ('${ACCOUNT}', '${cutoff}', ${shares})`;
      await c.query(sale("2026-03-15"));
      expect((await failure(c, sale("2026-03-15"))).code).toBe("23505");
      expect((await failure(c, sale("2026-09-15", 0))).code).toBe("23514");
      // Deleting the account takes its grants and sales with it.
      await c.query(`delete from finance_accounts where id = $1`, [ACCOUNT]);
      expect((await c.query(`select (select count(*) from finance_rsu_grants)::int + (select count(*) from finance_rsu_sales)::int as n`)).rows[0].n).toBe(0);
    });

    it("holds a position a symbol, bought and priced sensibly, and a balance's liquid share as a share", async () => {
      await account();
      const position = (symbol: string, quantity = "10", cost = "100", currency = "USD", price = "null") =>
        `insert into finance_stock_positions (account_id, symbol, quantity, cost, currency, price) values ('${ACCOUNT}', '${symbol}', ${quantity}, ${cost}, '${currency}', ${price})`;
      await c.query(position("AAPL", "10", "100", "USD", "120.5"));
      await c.query(position("0700.HK", "0.5", "0", "HKD"));
      expect((await failure(c, position("AAPL"))).code).toBe("23505");
      for (const bad of [position("aapl"), position(".HK"), position("BRK B"), position("X", "0"), position("Y", "1", "-1"), position("Z", "1", "1", "usd"), position("W", "1", "1", "USD", "0")]) {
        expect((await failure(c, bad)).code, bad).toBe("23514");
      }
      expect((await failure(c, `update finance_accounts set liquid_min_gain = 20000 where id = $1`, [ACCOUNT])).code).toBe("23514");
      await c.query(`update finance_accounts set liquid_min_gain = 12.5 where id = $1`, [ACCOUNT]);
      const [b] = (await balance("2026-09-30")).rows;
      expect((await failure(c, `update finance_balances set liquid_share = 1.5 where id = $1`, [b.id])).code).toBe("23514");
      await c.query(`update finance_balances set liquid_share = 0.4 where id = $1`, [b.id]);
      await c.query(`delete from finance_balances where id = $1`, [b.id]);
      // Deleting the account takes its positions with it.
      await c.query(`delete from finance_accounts where id = $1`, [ACCOUNT]);
      expect((await c.query(`select count(*)::int as n from finance_stock_positions`)).rows[0].n).toBe(0);
    });

    it("pins a balance to its account's currency, and the account's currency to its balances", async () => {
      await account("SGD");
      expect((await failure(c, `insert into finance_balances (account_id, as_of, currency, amount, cny_rate, sgd_rate, rate_date)
        values ($1, '2026-09-30', 'CNY', 1, 1, 0.19, '2026-09-30')`, [ACCOUNT])).code).toBe("23503");
      await balance("2026-09-30");
      expect((await failure(c, `update finance_accounts set currency = 'CNY' where id = $1`, [ACCOUNT])).code).toBe("23503");
      expect((await failure(c, `delete from finance_accounts where id = $1`, [ACCOUNT])).code).toBe("23503");
    });

    it("keeps one balance per account per day; recording the day again replaces it and stamps the edit", async () => {
      await account();
      await balance("2026-09-30", "SGD", 1000);
      expect((await failure(c, `insert into finance_balances (account_id, as_of, currency, amount, cny_rate, sgd_rate, rate_date)
        values ($1, '2026-09-30', 'SGD', 2000, 5.3, 1, '2026-09-30')`, [ACCOUNT])).code).toBe("23505");
      await c.query(`insert into finance_balances (account_id, as_of, currency, amount, cny_rate, sgd_rate, rate_date)
        values ($1, '2026-09-30', 'SGD', 2000, 5.31, 1, '2026-09-30')
        on conflict (account_id, as_of) do update set amount = excluded.amount, cny_rate = excluded.cny_rate`, [ACCOUNT]);
      const rows = (await c.query(`select amount, cny_rate, updated_at from finance_balances`)).rows;
      expect(rows).toHaveLength(1);
      expect([Number(rows[0].amount), Number(rows[0].cny_rate)]).toEqual([2000, 5.31]);
      expect(rows[0].updated_at).not.toBeNull();
    });

    it("refuses nonsense: an unknown region or kind, a lowercase currency, a zero rate", async () => {
      const bad = [
        `insert into finance_accounts (name, region, currency, kind, category) values ('x', 'US', 'USD', 'asset', 'cash')`,
        `insert into finance_accounts (name, region, currency, kind, category) values ('x', 'SG', 'SGD', 'debt', 'loan')`,
        `insert into finance_accounts (name, region, currency, kind, category) values ('x', 'SG', 'sgd', 'asset', 'cash')`,
        `insert into finance_accounts (name, region, currency, kind, category) values ('  ', 'SG', 'SGD', 'asset', 'cash')`,
      ];
      for (const sql of bad) expect((await failure(c, sql)).code, sql).toBe("23514");
      await account();
      expect((await failure(c, `insert into finance_balances (account_id, as_of, currency, amount, cny_rate, sgd_rate, rate_date)
        values ($1, '2026-09-30', 'SGD', 1, 0, 1, '2026-09-30')`, [ACCOUNT])).code).toBe("23514");
    });

    it("starts an account held by nobody in particular, its liquidity and debt-length left to its category", async () => {
      await account();
      const row = (await c.query(`select owner, liquidity, long_term, loan_principal from finance_accounts`)).rows[0];
      expect(row).toEqual({ owner: null, liquidity: null, long_term: null, loan_principal: null });
    });

    const loanColumns = `loan_principal, loan_rate, loan_start, loan_term_months, loan_method`;
    const liability = (terms: string) =>
      `insert into finance_accounts (name, region, currency, kind, category, ${loanColumns})
       values ('Mortgage', 'CN', 'CNY', 'liability', 'mortgage', ${terms})`;

    it("takes a loan's terms all together, on a liability, or not at all", async () => {
      await c.query(liability(`1000000, 4.9, '2020-01-15', 360, 'annuity'`));
      await c.query(liability(`null, null, null, null, null`));
      for (const terms of [
        `1000000, null, null, null, null`,
        `1000000, 4.9, '2020-01-15', 360, null`,
        `null, 4.9, '2020-01-15', 360, 'annuity'`,
      ]) {
        const err = await failure(c, liability(terms));
        expect([err.code, err.constraint], terms).toEqual(["23514", "finance_accounts_loan_terms"]);
      }
      const onAnAsset = await failure(c, `insert into finance_accounts (name, region, currency, kind, category, ${loanColumns})
        values ('x', 'CN', 'CNY', 'asset', 'property', 1000, 3, '2020-01-01', 12, 'annuity')`);
      expect([onAnAsset.code, onAnAsset.constraint]).toEqual(["23514", "finance_accounts_loan_terms"]);
    });

    it("refuses a liquidity outside 0 to 1, a blank owner, and loan terms no loan has", async () => {
      await account();
      for (const sql of [
        `update finance_accounts set liquidity = 1.2`,
        `update finance_accounts set liquidity = -0.1`,
        `update finance_accounts set owner = '  '`,
        liability(`0, 4.9, '2020-01-15', 360, 'annuity'`),
        liability(`1000, 100, '2020-01-15', 360, 'annuity'`),
        liability(`1000, 4.9, '2020-01-15', 0, 'annuity'`),
        liability(`1000, 4.9, '2020-01-15', 360, 'balloon'`),
      ]) {
        expect((await failure(c, sql)).code, sql).toBe("23514");
      }
    });

    const loan = (method: string, extras: string, maturity = "null") =>
      `insert into finance_accounts (name, region, currency, kind, category, ${loanColumns}, loan_payment, loan_first_interest, loan_maturity)
       values ('Mortgage', 'CN', 'CNY', 'liability', 'mortgage', 1439520.79, 3.2, '2026-11-01', 195, '${method}', ${extras}, ${maturity}) returning id`;

    it("takes the bank's stated payment, first interest and end date on a loan, each optional, and none without one", async () => {
      await c.query(loan("annuity", `9476.90, 3836.22`, `'2043-01-16'`));
      await c.query(loan("equal_principal", `null, null`, `'2043-01-16'`));
      await c.query(loan("annuity", `null, 3836.22`));
      await c.query(loan("annuity", `9476.90, null`));
      await c.query(loan("equal_principal", `null, 3836.22`));
      await c.query(loan("annuity", `null, 0`));
      for (const extras of [`0, null`, `-1, null`, `null, -0.01`]) {
        expect((await failure(c, loan("annuity", extras))).code, extras).toBe("23514");
      }
      // A stated payment is a level one: 等额本金's falls every month.
      const falling = await failure(c, loan("equal_principal", `6861.11, null`));
      expect([falling.code, falling.constraint]).toEqual(["23514", "finance_accounts_loan_extras"]);
      // And none means anything without the terms it qualifies.
      for (const extras of [`9476.90, null, null`, `null, 3836.22, null`, `null, null, '2043-01-16'`]) {
        const err = await failure(c, `insert into finance_accounts (name, region, currency, kind, category, loan_payment, loan_first_interest, loan_maturity)
          values ('x', 'CN', 'CNY', 'liability', 'loan', ${extras})`);
        expect([err.code, err.constraint], extras).toEqual(["23514", "finance_accounts_loan_extras"]);
      }
    });

    it("takes 等本等息 and 先息后本, a stated payment on a flat loan too, and a day count on a loan", async () => {
      for (const method of ["flat", "interest_only"]) await c.query(loan(method, `null, null`));
      await c.query(loan("flat", `1422.14, null`));
      for (const count of ["30/360", "actual/365", "actual/360"]) {
        await c.query(`update finance_accounts set loan_day_count = $1 where loan_method = 'flat'`, [count]);
      }
      const bullet = await failure(c, loan("interest_only", `1000, null`));
      expect([bullet.code, bullet.constraint]).toEqual(["23514", "finance_accounts_loan_extras"]);
      const other = await failure(c, loan("balloon", `null, null`));
      expect([other.code, other.constraint]).toEqual(["23514", "finance_accounts_loan_method_check"]);
      expect((await failure(c, `update finance_accounts set loan_day_count = 'daily'`)).code).toBe("23514");
      const noLoan = await failure(c, `insert into finance_accounts (name, region, currency, kind, category, loan_day_count)
        values ('x', 'SG', 'SGD', 'liability', 'loan', 'actual/365')`);
      expect([noLoan.code, noLoan.constraint]).toEqual(["23514", "finance_accounts_loan_extras"]);
    });

    it("keeps a loan's prepayments, one a day, positive, and lets them go with the loan", async () => {
      const { id } = (await c.query(loan("annuity", `9476.90, 3836.22`))).rows[0];
      const prepay = (day: string, amount: string, mode = "'shorten'", payment = "null") =>
        c.query(`insert into finance_loan_prepayments (account_id, paid_on, amount, mode, payment) values ($1, $2, ${amount}, ${mode}, ${payment})`, [id, day]);
      await prepay("2027-01-01", "100000");
      await prepay("2028-01-01", "50000", "'reduce'", "8000");
      expect((await failure(c, `insert into finance_loan_prepayments (account_id, paid_on, amount, mode) values ($1, '2027-01-01', 1, 'shorten')`, [id])).code).toBe("23505");
      for (const [amount, mode, payment] of [["0", "'shorten'", "null"], ["-1", "'shorten'", "null"], ["1", "'halve'", "null"], ["1", "'reduce'", "0"]]) {
        expect((await failure(c, `insert into finance_loan_prepayments (account_id, paid_on, amount, mode, payment) values ($1, '2029-01-01', ${amount}, ${mode}, ${payment})`, [id])).code, `${amount} ${mode} ${payment}`).toBe("23514");
      }
      expect((await failure(c, `insert into finance_loan_prepayments (account_id, paid_on, amount, mode) values (gen_random_uuid(), '2029-01-01', 1, 'shorten')`)).code).toBe("23503");
      await c.query(`delete from finance_accounts where id = $1`, [id]);
      expect((await c.query(`select count(*)::int as n from finance_loan_prepayments`)).rows[0].n).toBe(0);
    });

    it("will not finish widening the loan methods while an older list is in place under another name", async () => {
      await c.query(`alter table finance_accounts add constraint legacy_methods check (loan_method in ('annuity', 'equal_principal'))`);
      const again = readFileSync(join(MIGRATIONS, "20260926_finance_loan_schedule_prepayments.sql"), "utf8");
      const err = await failure(c, again);
      expect([err.code, err.message]).toEqual(["P0001", "finance_accounts still has a check that lists only the old loan methods"]);
    });

    it("keeps a loan's rate changes, one a day, in range, and lets them go with the loan", async () => {
      const { id } = (await c.query(loan("annuity", `9476.90, 3836.22`))).rows[0];
      const change = (day: string, rate: string, payment = "null") =>
        c.query(`insert into finance_loan_rate_changes (account_id, effective_date, rate, payment) values ($1, $2, ${rate}, ${payment})`, [id, day]);
      await change("2027-01-01", "3", "9300");
      await change("2028-01-01", "2.8");
      expect((await failure(c, `insert into finance_loan_rate_changes (account_id, effective_date, rate) values ($1, '2027-01-01', 2.9)`, [id])).code).toBe("23505");
      for (const [rate, payment] of [["-0.1", "null"], ["100", "null"], ["3", "0"]]) {
        expect((await failure(c, `insert into finance_loan_rate_changes (account_id, effective_date, rate, payment) values ($1, '2029-01-01', ${rate}, ${payment})`, [id])).code, `${rate} ${payment}`).toBe("23514");
      }
      expect((await failure(c, `insert into finance_loan_rate_changes (account_id, effective_date, rate) values (gen_random_uuid(), '2029-01-01', 3)`)).code).toBe("23503");
      await c.query(`delete from finance_accounts where id = $1`, [id]);
      expect((await c.query(`select count(*)::int as n from finance_loan_rate_changes`)).rows[0].n).toBe(0);
    });
  });

  describe("housing", () => {
    const SCENARIO = "00000000-0000-0000-0000-0000000000f2";
    const figure = (quarter = "2026-04-01", value = 600000, series = "hdb_resale", area = "BEDOK", segment = "4-room") => c.query(
      `insert into housing_market (series, area, segment, quarter, value) values ($1, $2, $3, $4, $5)`,
      [series, area, segment, quarter, value],
    );

    it("is private: neither the anon key nor a signed-in session can read or write it, the service role can", async () => {
      await figure();
      await c.query(`insert into housing_scenarios (id, name, inputs) values ($1, 'Bedok', '{"price": 600000}')`, [SCENARIO]);
      await c.query(`insert into housing_sources (dataset, source_updated_at, points) values ('d_14f63e595975691e7c24a27ae4c07c79', now(), 146)`);
      await c.query(`insert into housing_snapshot (id, version, market) values ('market', 1, '{"series": []}')`);
      for (const role of ["anon", "authenticated"]) {
        await c.query(`set local role ${role}`);
        for (const sql of [
          `select * from housing_market`,
          `insert into housing_market (series, area, segment, quarter, value) values ('hdb_rpi', 'ALL', 'all', '2026-01-01', 1)`,
          `select * from housing_scenarios`,
          `insert into housing_scenarios (name, inputs) values ('x', '{}')`,
          `update housing_scenarios set name = 'y'`,
          `delete from housing_scenarios`,
          `select * from housing_sources`,
          `delete from housing_sources`,
          `select * from housing_snapshot`,
          `update housing_snapshot set version = 2`,
        ]) {
          expect((await failure(c, sql)).code, `${role}: ${sql}`).toBe("42501");
        }
        await c.query(`reset role`);
      }
      await c.query(`set local role service_role`);
      expect((await c.query(`select count(*)::int as n from housing_scenarios`)).rows[0].n).toBe(1);
      await c.query(`reset role`);
    });

    it("keeps one figure a series, place, kind and quarter -- on the quarter's first day, and above zero", async () => {
      await figure();
      expect((await failure(c, `insert into housing_market (series, area, segment, quarter, value) values ('hdb_resale', 'BEDOK', '4-room', '2026-04-01', 1)`)).code).toBe("23505");
      for (const [quarter, value, series, area, segment] of [
        ["2026-04-02", 1, "hdb_resale", "BEDOK", "4-room"],
        ["2026-05-01", 1, "hdb_resale", "BEDOK", "4-room"],
        ["2026-07-01", 0, "hdb_resale", "BEDOK", "4-room"],
        ["2026-07-01", 1, "HDB resale", "BEDOK", "4-room"],
        ["2026-07-01", 1, "hdb_resale", "bedok", "4-room"],
        ["2026-07-01", 1, "hdb_resale", "BEDOK", "4 Room"],
      ] as const) {
        expect((await failure(c, `insert into housing_market (series, area, segment, quarter, value) values ($1, $2, $3, $4, $5)`, [series, area, segment, quarter, value])).code,
          `${quarter} ${value} ${series} ${area} ${segment}`).toBe("23514");
      }
      await figure("2026-07-01", 3000, "hdb_rent", "KALLANG/WHAMPOA", "executive");
      await figure("2026-10-01", 172.3, "ura_rri", "RCR", "non-landed");
    });

    it("names a scenario, keeps its inputs as an object, and knows a dataset by data.gov.sg's id", async () => {
      for (const [name, inputs] of [["", "{}"], ["   ", "{}"], ["x".repeat(81), "{}"], ["ok", "[]"], ["ok", "1"]]) {
        expect((await failure(c, `insert into housing_scenarios (name, inputs) values ($1, $2::jsonb)`, [name, inputs])).code, `${name} ${inputs}`).toBe("23514");
      }
      expect((await failure(c, `insert into housing_sources (dataset, points) values ('resale-prices', 1)`)).code).toBe("23514");
      expect((await failure(c, `insert into housing_sources (dataset, points) values ('d_14f63e595975691e7c24a27ae4c07c79', -1)`)).code).toBe("23514");
    });

    it("keeps the developments followed and their records private, checked, and gone with the development", async () => {
      await c.query(`insert into housing_projects (name) values ('WATERTOWN')`);
      await c.query(`insert into housing_project_sales (project, month, price, area_sqm, floor_range, sale_type, property_type) values ('WATERTOWN', '2026-08-01', 1550000, 98, '06-10', 'resale', 'Condominium')`);
      await c.query(`insert into housing_project_rents (project, quarter, month, rent, sqft_low, sqft_high, bedrooms) values ('WATERTOWN', '2026-07-01', '2026-08-01', 4500, 1000, 1100, 3)`);
      for (const role of ["anon", "authenticated"]) {
        await c.query(`set local role ${role}`);
        for (const sql of [
          `select * from housing_projects`,
          `insert into housing_projects (name) values ('X')`,
          `select * from housing_project_sales`,
          `delete from housing_project_sales`,
          `select * from housing_project_rents`,
          `update housing_project_rents set rent = 1`,
        ]) {
          expect((await failure(c, sql)).code, `${role}: ${sql}`).toBe("42501");
        }
        await c.query(`reset role`);
      }
      for (const sql of [
        `insert into housing_projects (name) values ('Watertown')`,
        `insert into housing_projects (name) values (' WATERTOWN')`,
        `insert into housing_projects (name, district) values ('A', '9')`,
        `insert into housing_projects (name, segment) values ('B', 'NORTH')`,
        `insert into housing_project_sales (project, month, price, area_sqm) values ('WATERTOWN', '2026-08-02', 1, 1)`,
        `insert into housing_project_sales (project, month, price, area_sqm) values ('WATERTOWN', '2026-08-01', 0, 1)`,
        `insert into housing_project_sales (project, month, price, area_sqm, sale_type) values ('WATERTOWN', '2026-08-01', 1, 1, 'auction')`,
        `insert into housing_project_rents (project, quarter, month, rent) values ('WATERTOWN', '2026-08-01', '2026-08-01', 1)`,
        `insert into housing_project_rents (project, quarter, month, rent, bedrooms) values ('WATERTOWN', '2026-07-01', '2026-08-01', 1, 0)`,
      ]) {
        expect((await failure(c, sql)).code, sql).toBe("23514");
      }
      expect((await failure(c, `insert into housing_project_sales (project, month, price, area_sqm) values ('NOWHERE', '2026-08-01', 1, 1)`)).code).toBe("23503");
      // Its tenure as URA writes it, kept to a sensible length, and as private as the rest.
      await c.query(`update housing_projects set tenure = '99 yrs lease commencing from 2012' where name = 'WATERTOWN'`);
      expect((await failure(c, `update housing_projects set tenure = repeat('x', 81) where name = 'WATERTOWN'`)).code).toBe("23514");
      await c.query(`set local role anon`);
      expect((await failure(c, `update housing_projects set tenure = 'Freehold'`)).code).toBe("42501");
      await c.query(`reset role`);
      await c.query(`delete from housing_projects where name = 'WATERTOWN'`);
      expect((await c.query(`select (select count(*) from housing_project_sales) + (select count(*) from housing_project_rents) as n`)).rows[0].n).toBe("0");
    });

    it("keeps the market whole as one row, in a shape it names", async () => {
      await c.query(`insert into housing_snapshot (id, version, market) values ('market', 1, '{"series": [], "refreshed_at": null}')`);
      expect((await failure(c, `insert into housing_snapshot (id, version, market) values ('market', 1, '{}')`)).code).toBe("23505");
      for (const [id, version, market] of [["prices", "1", "{}"], ["market", "0", "{}"], ["market", "1", "[]"]]) {
        await c.query(`delete from housing_snapshot`);
        expect((await failure(c, `insert into housing_snapshot (id, version, market) values ($1, $2, $3::jsonb)`, [id, version, market])).code, `${id} ${version} ${market}`).toBe("23514");
      }
    });
  });

  describe("the damage report in 20260925_settle_skips_deleted_charges", () => {
    it("counts settlements posted against an already-deleted charge, until they are reversed", async () => {
      await seed(c);
      // What the old settle_person left behind: a settlement of the deleted
      // charge, posted after it was deleted.
      await c.query(`update charges set paid = true where id = $1`, [DELETED]);
      await c.query(`insert into wallet_entries (subscriber_id, amount_cny, kind, charge_id, created_at) values ($1, -50, 'charge', $2, now() + interval '1 minute')`, [W, DELETED]);
      const report = async () => {
        const notices: string[] = [];
        const listen = (n: { message?: string }) => notices.push(n.message ?? "");
        c.on("notice", listen);
        await c.query(readFileSync(join(MIGRATIONS, "20260925_settle_skips_deleted_charges.sql"), "utf8"));
        c.off("notice", listen);
        return notices.find((n) => n.startsWith("settlements posted after"));
      };
      expect(await report()).toBe("settlements posted after their charge was deleted, not reversed: 1 (CNY 50.00)");
      await c.query(`insert into wallet_entries (subscriber_id, amount_cny, kind, charge_id, created_at) values ($1, 50, 'adjustment', $2, now() + interval '2 minutes')`, [W, DELETED]);
      expect(await report()).toBe("settlements posted after their charge was deleted, not reversed: 0 (CNY 0.00)");
    });
  });
});

/** A database of its own, for tests that have to commit -- each call its own
 *  transaction, as it is when it arrives through the API -- and a second
 *  connection to it. Dropped afterwards. */
async function committing(test: (first: pg.Client, second: pg.Client) => Promise<void>) {
  admin = new pg.Client({ connectionString: SERVER });
  await admin.connect();
  const first = await database();
  const url = new URL(SERVER!);
  url.pathname = `/${created.at(-1)}`;
  const second = new pg.Client({ connectionString: url.toString() });
  await second.connect();
  try {
    await test(first, second);
  } finally {
    await second.end();
    await first.end();
    for (const name of created.splice(0)) await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
}

describe.skipIf(!SERVER)("unsettle_charge across requests", () => {
  it("reverses a settlement once, and refuses a second reversal", async () => {
    // Committed call by call on purpose. The check compares when the reversal
    // was posted with when the settlement was, and inside one transaction every
    // now() is the same instant -- a single-transaction test cannot tell the two
    // apart, where two requests always can.
    await committing(async (c) => {
      await seed(c);
      await c.query(`select settle_charge($1, $2)`, [LIVE, W]);
      await c.query(`select unsettle_charge($1)`, [LIVE]);
      await expect(c.query(`select unsettle_charge($1)`, [LIVE])).rejects.toThrow("That settlement has already been reversed");
      expect(await balance(c)).toBe(100);
    });
  });
});

describe.skipIf(!SERVER)("settle_person under a concurrent write", () => {
  it("settles only the charges it checked, even when another one lands mid-run", async () => {
    await committing(async (first, second) => {
      // A owes 30, and W -- a different person, so the insert below is not
      // held up by the lock on W's row -- pays from a wallet of 50.
      await first.query(`insert into subscribers (id, name) values ($1, 'Ann'), ($2, 'Wal')`, [A, W]);
      await first.query(`insert into services (id, name, monthly_cost, currency) values ($1, 'Svc', 10, 'SGD')`, [SVC]);
      await first.query(`insert into wallet_entries (subscriber_id, amount_cny, kind) values ($1, 50, 'topup')`, [W]);
      await first.query(`insert into charges (subscriber_id, service_id, period_start, period_end, monthly_cost, currency, exchange_rate, total_cny)
                         values ($1, $2, '2026-08', '2026-08', 10, 'SGD', 3, 30)`, [A, SVC]);

      // The deployed settle_person, with a pause just before the loop that pays:
      // the window a charge written by the monthly run could fall into.
      const def: string = (await first.query(`select pg_get_functiondef('settle_person'::regproc) as d`)).rows[0].d;
      const slow = def
        .replace("public.settle_person(", "public.settle_person_slow(")
        .replace(/\n  for r in\n/, "\n  perform pg_sleep(1);\n  for r in\n");
      expect(slow).toContain("pg_sleep");
      await first.query(slow);

      const settling = first.query(`select * from settle_person_slow($1, $2)`, [A, W]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await second.query(`insert into charges (subscriber_id, service_id, period_start, period_end, monthly_cost, currency, exchange_rate, total_cny)
                          values ($1, $2, '2026-09', '2026-09', 10, 'SGD', 4, 40)`, [A, SVC]);
      const row = (await settling).rows[0];

      expect([row.settled, Number(row.total), Number(row.balance_left)]).toEqual([1, 30, 20]);
      expect(await balance(first)).toBe(20);
      const late = (await first.query(`select paid from charges where period_start = '2026-09'`)).rows[0];
      expect(late.paid).toBe(false);
    });
  });
});

describe.skipIf(!SERVER)("auto_settle against a settlement from the same wallet", () => {
  it("holds the wallet while it pays, so a settlement from it waits and finds what it left", async () => {
    await committing(async (first, second) => {
      await people(first);
      await topUp(first, A, 30);
      await charge(first, A, "2026-09", 30);
      const walsCharge = await charge(first, W, "2026-09", 30);

      // The deployed auto_settle, with a pause before it reads the balance: the
      // window in which someone could settle from the same wallet.
      const def: string = (await first.query(`select pg_get_functiondef('auto_settle'::regproc) as d`)).rows[0].d;
      const slow = def
        .replace("public.auto_settle(", "public.auto_settle_slow(")
        .replace(/\n  foreach v_wallet in array v_wallets loop\n/, "\n  perform pg_sleep(1);\n  foreach v_wallet in array v_wallets loop\n");
      expect(slow).toContain("pg_sleep");
      await first.query(slow);

      const running = first.query(`select * from auto_settle_slow(array[$1]::uuid[])`, [A]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Wal's charge, paid from Ann's wallet meanwhile. Reading the balance before
      // the run is done would see 30 and pay it, and the run would pay its own
      // 30 from the same 30.
      const meanwhile = await second.query(`select settle_charge($1, $2)`, [walsCharge, A]).then(() => "paid", (e: Error) => e.message);
      expect((await running).rows.map((r) => r.settled)).toEqual([1]);
      expect(meanwhile).toBe("Not enough in the wallet: 0.00 available, 30.00 needed");
      expect(await balance(first, A)).toBe(0);
    });
  });
});
