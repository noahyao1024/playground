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

  describe("finance", () => {
    it("keeps an API token only as a well-formed, unique hash, under a name", async () => {
      const hash = "ab".repeat(32);
      await c.query(`insert into finance_api_tokens (name, token_sha256) values ('Laptop agent', $1)`, [hash]);
      expect((await failure(c, `insert into finance_api_tokens (name, token_sha256) values ('again', $1)`, [hash])).code).toBe("23505");
      for (const [name, sha] of [["x", "pgf_not-a-hash"], ["x", "AB".repeat(32)], ["x", "ab".repeat(31)], ["  ", "cd".repeat(32)], ["x".repeat(61), "ef".repeat(32)]]) {
        expect((await failure(c, `insert into finance_api_tokens (name, token_sha256) values ($1, $2)`, [name, sha])).code, `${name} ${sha}`).toBe("23514");
      }
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
