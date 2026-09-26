import { CATEGORIES, KINDS, LOAN_DAY_COUNTS, LOAN_METHODS, PREPAYMENT_MODES, REGIONS } from "./finance";
import { FINANCE_CURRENCIES } from "./fx";

/** The actions POST /api/finance takes. The route's switch is what handles them;
 *  a test holds the two to each other. */
export const FINANCE_ACTIONS = [
  "createAccount", "updateAccount", "deleteAccount", "recordBalances", "deleteBalance", "addLoanRateChange", "deleteLoanRateChange",
  "addLoanPrepayment", "deleteLoanPrepayment",
] as const;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });
const day = { type: "string", format: "date", description: "YYYY-MM-DD" };
const uuid = { type: "string", format: "uuid" };
const error = (description: string) => ({ description, content: { "application/json": { schema: ref("Error") } } });
const ok = (description: string, schema: unknown) => ({ description, content: { "application/json": { schema } } });

const categories = KINDS.map((k) => `${k}: ${Object.keys(CATEGORIES[k]).join(", ")}`).join("; ");

/** Fields of an account a request may set. What each must be is enforced by the
 *  route; this says the same thing for whoever calls it. */
const accountFields = {
  name: { type: "string", minLength: 1, maxLength: 80 },
  institution: nullable("string", { maxLength: 80 }),
  region: { type: "string", enum: [...REGIONS], description: "Where the account is held. OTHER for anywhere else." },
  currency: { type: "string", enum: [...FINANCE_CURRENCIES], description: "What the account is kept in. Fixed once it has balances." },
  kind: { type: "string", enum: [...KINDS], description: "A liability holds what is owed." },
  category: {
    type: "string",
    enum: [...new Set(KINDS.flatMap((k) => Object.keys(CATEGORIES[k])))],
    description: `Must belong to the kind -- ${categories}.`,
  },
  note: nullable("string", { maxLength: 500 }),
  sort_order: { type: "integer", description: "Order within its region; lower first." },
  owner: nullable("string", { maxLength: 40, description: "Who in the family holds it. Blank or null: nobody in particular." }),
  liquidity: nullable("number", {
    minimum: 0, maximum: 1,
    description: "The share of an asset that could be spent or sold now: 1 all of it, 0 none, 0.6 for shares partly under water. Null follows the category: retirement and property 0, anything else 1. Ignored on a liability.",
  }),
  long_term: nullable("boolean", { description: "Whether a liability is long-term debt, which exclude_long_term leaves out. Null follows the category: a mortgage is." }),
  loan_principal: nullable("number", { exclusiveMinimum: 0, description: "Loan terms go all five together, on a liability, or none. The amount borrowed, in the account's currency -- or what was owed when the bank last re-lent it, as its repayment plan starts from." }),
  loan_rate: nullable("number", { minimum: 0, exclusiveMaximum: 100, description: "Annual interest, in percent: 3.95 is 3.95%." }),
  loan_start: nullable("string", { format: "date", description: "The first repayment; each later one falls on the same day of the month." }),
  loan_term_months: nullable("integer", { minimum: 1, maximum: 600, description: "How many monthly repayments in all: 360 for thirty years." }),
  loan_method: nullable("string", {
    enum: [...LOAN_METHODS, null],
    description: "annuity is 等额本息 (a level payment); equal_principal is 等额本金 (level principal, falling payments); flat is 等本等息 (a flat rate: the same interest every month on the amount borrowed, beside level principal -- card instalments, car and personal loans in Singapore); interest_only is 先息后本 (interest each month, the principal with the last repayment).",
  }),
  loan_payment: nullable("number", {
    exclusiveMinimum: 0,
    description: "The monthly payment as the bank states it, which the schedule then takes each month. annuity or flat only, and only with the terms. Null: the formula's, to the cent.",
  }),
  loan_first_interest: nullable("number", {
    minimum: 0,
    description: "The first repayment's interest as the bank charged it: after a rate reset it covers a stretch other than a plain month. To at most 4 decimal places: a bank that carries the balance unrounded charges it to a fraction of a cent (3836.2239) while its plan shows 3836.22, and the schedule needs the fraction to stay on the bank's to the cent. Only with the terms. Null: a month's interest on loan_principal.",
  }),
  loan_maturity: nullable("string", {
    format: "date",
    description: "The contract's end date, when the last repayment falls due on it rather than on the monthly day: from the last monthly repayment to before the month after it. That repayment's interest is then charged by the day, balance × rate / 360 × days, the days counted 30/360 from the repayment before (1 Dec to 16 Jan is 45). Only with the terms. Null: the last repayment is a monthly one.",
  }),
  loan_day_count: nullable("string", {
    enum: [...LOAN_DAY_COUNTS, null],
    description: "How interest is counted. 30/360: a month's interest is a year's / 12, as Chinese banks count it. actual/365: by the day, a year of 365 -- daily rest, as Singapore banks count a home loan. actual/360: by the day, a year of 360. Null: 30/360. Only with the terms.",
  }),
};

const flagParameter = (name: string, description: string) => ({
  name, in: "query", required: false, description, schema: { type: "string", enum: ["1", "true", "0", "false"] },
});

/** What /api/finance takes and returns, as OpenAPI 3.1, served at `origin`. */
export function financeOpenApi(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Playground Finance",
      version: "1",
      description: [
        "One person's accounts in China and Singapore: what each held on the days it was recorded, and what is owed.",
        "**Auth.** `Authorization: Bearer <token>`, reading and writing as the owner: a token the owner made on the /finance page (API access), or FINANCE_API_TOKEN. Or the owner's signed-in session. Anything else is 401. Every answer is `Cache-Control: private, no-store`.",
        "**Money.** A balance is kept in its account's own currency, with `cny_rate` and `sgd_rate`: what one unit was worth in CNY and SGD on `rate_date` (ECB mid-market; a weekend or a day not yet published takes the last published day). Totals multiply by those stored rates, so history never re-prices. A liability's balance is what is owed, as a positive number.",
        "**Days.** An account not recorded on a day carries its last balance before it forward. Recording a day again replaces that day's balance for each account sent. An archived account stops counting the day after it was archived, in Singapore (UTC+8), which is also the timezone `as_of` may not be later than today in.",
        "**Family.** Each account may name its `owner`; an asset's `liquidity` says how much of it could be spent now; a liability may carry loan terms, from which the summary works out its repayment schedule.",
        "**Loans.** A loan is scheduled the way a bank's repayment plan (还款计划) has it, to the cent: each month's interest is what is owed times the monthly rate, rounded half up; annuity takes it out of the level payment, equal_principal repays P/n to the cent; the last repayment clears what is left. Where the bank's plan differs, give its stated `loan_payment` and `loan_first_interest`, and `loan_maturity` when the contract ends after the last monthly day. At a stated payment an annuity's balance is carried unrounded, as 建设银行 carries it, and shown to the cent: each repayment's principal is what the shown balance fell by, its interest the rest of the payment. `loan_day_count` counts interest by the day instead. A rate change is kept as history (`addLoanRateChange`): from its first repayment the rate is the new one and the payment the one given, or what repays the balance then owed over the repayments left. A prepayment (`addLoanPrepayment`) comes off what is owed on its day, interest running on what was owed before it up to that day; after it the payment stays and the loan ends sooner, or the end stays and the payment falls. `GET /api/finance/loan-schedule` lists every repayment.",
        "For where things stand, read `GET /api/finance/summary` rather than recomputing it from `GET /api/finance`.",
      ].join("\n\n"),
    },
    servers: [{ url: origin }],
    security: [{ token: [] }],
    paths: {
      "/api/finance/summary": {
        get: {
          operationId: "getSummary",
          summary: "Where things stand, worked out",
          description: "Totals on the latest recorded day, the change since the record before it, every account with its newest balance, and one point per recorded day. The filters apply to every total and to the history, as the page's do.",
          parameters: [
            flagParameter("exclude_long_term", "Leave out long-term debt: mortgages, and anything marked long_term."),
            flagParameter("liquid_only", "Count only each asset's liquid share."),
            {
              name: "owner", in: "query", required: false, schema: { type: "string" },
              description: "Only this person's accounts. Present but empty: accounts nobody in particular holds.",
            },
          ],
          responses: { 200: ok("The summary", ref("Summary")), 401: error("Not the owner") },
        },
      },
      "/api/finance": {
        get: {
          operationId: "getRecords",
          summary: "Every account and every balance, as stored",
          responses: {
            200: ok("Accounts and balances, balances oldest first", {
              type: "object",
              required: ["accounts", "balances"],
              properties: { accounts: { type: "array", items: ref("Account") }, balances: { type: "array", items: ref("Balance") } },
            }),
            401: error("Not the owner"),
          },
        },
        post: {
          operationId: "act",
          summary: "Change something, named by `action`",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: FINANCE_ACTIONS.map((a) => ref(a)),
                  discriminator: { propertyName: "action", mapping: Object.fromEntries(FINANCE_ACTIONS.map((a) => [a, `#/components/schemas/${a}`])) },
                },
              },
            },
          },
          responses: {
            200: ok("createAccount, updateAccount and the loan actions: the account, with its rate changes and prepayments as they now stand. recordBalances: the balances written and the day their rates are from. deleteAccount and deleteBalance: `{ok: true}`.", {
              oneOf: [ref("Account"), ref("Recorded"), { type: "object", properties: { ok: { const: true } } }],
            }),
            400: error("The request does not make sense: the message says what"),
            401: error("Not the owner"),
            404: error("updateAccount, addLoanRateChange and addLoanPrepayment: no such account. deleteLoanRateChange and deleteLoanPrepayment: no such one."),
            409: error("deleteAccount on an account with balances (archive it instead), a new currency for one, or a second rate change or prepayment on the same day for one loan"),
            502: error("recordBalances: the day's rates could not be had. Nothing was written; try again."),
          },
        },
      },
      "/api/finance/loan-schedule": {
        get: {
          operationId: "getLoanSchedule",
          summary: "Every repayment of one loan, to the cent",
          description: "The lines of the bank's repayment plan, with its rate changes applied, and the totals: to set beside the bank's app line by line. The summary's loan figures are read off the same schedule.",
          parameters: [{ name: "id", in: "query", required: true, schema: uuid, description: "The loan's account." }],
          responses: {
            200: ok("The schedule", ref("LoanSchedule")),
            400: error("No id, or not an id"),
            401: error("Not the owner"),
            404: error("No such account, or it has no loan terms"),
          },
        },
      },
      "/api/finance/openapi": {
        get: {
          operationId: "getOpenApi",
          summary: "This description",
          security: [],
          responses: { 200: ok("OpenAPI 3.1", { type: "object" }) },
        },
      },
    },
    components: {
      securitySchemes: { token: { type: "http", scheme: "bearer", description: "A token made on the /finance page (API access), or FINANCE_API_TOKEN" } },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
        Money: {
          type: "object",
          required: ["cny", "sgd"],
          properties: { cny: { type: "number" }, sgd: { type: "number" } },
          description: "One amount in both reporting currencies.",
        },
        Totals: {
          type: "object",
          required: ["assets", "liabilities", "net"],
          properties: { assets: ref("Money"), liabilities: ref("Money"), net: { ...ref("Money"), description: "Assets less liabilities." } },
        },
        Account: {
          type: "object",
          required: ["id", "name", "region", "currency", "kind", "category", "sort_order", "created_at"],
          properties: {
            id: uuid,
            ...accountFields,
            rate_changes: {
              type: "array",
              items: ref("LoanRateChange"),
              readOnly: true,
              description: "Its loan's rate changes, oldest first; empty for most accounts. Changed with addLoanRateChange and deleteLoanRateChange, not updateAccount.",
            },
            prepayments: {
              type: "array",
              items: ref("LoanPrepayment"),
              readOnly: true,
              description: "Its loan's prepayments, oldest first; empty for most accounts. Changed with addLoanPrepayment and deleteLoanPrepayment.",
            },
            archived_at: nullable("string", { format: "date-time", description: "Set while archived." }),
            created_at: { type: "string", format: "date-time" },
          },
        },
        LoanRateChange: {
          type: "object",
          required: ["id", "account_id", "effective_date", "rate", "payment", "created_at"],
          properties: {
            id: uuid,
            account_id: uuid,
            effective_date: { ...day, description: "The first repayment charged at the new rate. A date between repayments takes effect from the next." },
            rate: { type: "number", description: "Annual, in percent." },
            payment: nullable("number", { description: "The payment from then on as the bank states it. Null: what repays the balance then owed over the repayments left, to the cent." }),
            created_at: { type: "string", format: "date-time" },
          },
        },
        LoanPrepayment: {
          type: "object",
          required: ["id", "account_id", "paid_on", "amount", "mode", "payment", "created_at"],
          properties: {
            id: uuid,
            account_id: uuid,
            paid_on: { ...day, description: "The day it was paid." },
            amount: { type: "number", description: "Principal repaid, in the loan's currency." },
            mode: { type: "string", enum: [...PREPAYMENT_MODES], description: "shorten: the payment stays, the loan ends sooner. reduce: the end stays, the payment falls." },
            payment: nullable("number", { description: "The payment from then on as the bank states it, under reduce on a level payment. Null: worked out." }),
            created_at: { type: "string", format: "date-time" },
          },
        },
        LoanPeriod: {
          type: "object",
          required: ["n", "date", "rate", "payment", "principal", "interest", "balance"],
          properties: {
            n: { type: "integer", minimum: 1, description: "Which repayment: 1 for the first." },
            date: day,
            rate: { type: "number", description: "Annual, in percent: what this repayment's interest ran at." },
            payment: { type: "number", description: "principal + interest." },
            principal: { type: "number" },
            interest: { type: "number" },
            balance: { type: "number", description: "Principal still owed once it is paid." },
            prepaid: {
              type: "array",
              items: { type: "object", required: ["paid_on", "amount"], properties: { paid_on: day, amount: { type: "number" } } },
              description: "Principal repaid early since the repayment before, taken off before this one's interest, which runs on what was owed before each up to its day. Only where there is any. A loan cleared by a prepayment ends with a repayment dated that day: the interest owed up to it.",
            },
          },
        },
        LoanSchedule: {
          type: "object",
          required: ["account_id", "currency", "method", "periods", "totals"],
          properties: {
            account_id: uuid,
            currency: { type: "string", description: "The loan's, which every amount is in." },
            method: { type: "string", enum: [...LOAN_METHODS] },
            periods: { type: "array", items: ref("LoanPeriod"), description: "Every repayment, first to last. Fewer than loan_term_months only if a stated payment repays it early." },
            totals: {
              type: "object",
              required: ["payment", "principal", "interest"],
              properties: { payment: { type: "number" }, principal: { type: "number" }, interest: { type: "number" } },
              description: "The repayments added up.",
            },
          },
        },
        Balance: {
          type: "object",
          required: ["id", "account_id", "as_of", "currency", "amount", "cny_rate", "sgd_rate", "rate_date"],
          properties: {
            id: uuid,
            account_id: uuid,
            as_of: day,
            currency: { type: "string", description: "Its account's currency." },
            amount: { type: "number" },
            cny_rate: { type: "number", description: "CNY per one unit of `currency` on rate_date." },
            sgd_rate: { type: "number", description: "SGD per one unit of `currency` on rate_date." },
            rate_date: day,
            note: nullable("string"),
            created_at: { type: "string", format: "date-time" },
            updated_at: nullable("string", { format: "date-time" }),
          },
        },
        LoanStatus: {
          type: "object",
          description: "Where a loan's schedule stands today, in its own currency, read off its repayments to the cent (see /api/finance/loan-schedule). A prepaid loan owes less than principal_left: its recorded balance is the truth, this is the plan.",
          properties: {
            payment: { type: "number", description: "The next repayment: level under annuity but for the last, which clears what is left; falling under equal_principal. 0 once repaid." },
            rate: { type: "number", description: "Annual, in percent: what the next repayment runs at, with any rate change in force, or what the last did." },
            payments_made: { type: "integer" },
            payments_left: { type: "integer" },
            principal_left: { type: "number" },
            interest_left: { type: "number", description: "Interest in the payments still to come." },
            total_left: { type: "number", description: "Principal and interest still to pay." },
            total_interest: { type: "number", description: "Interest over the life of the loan." },
            next_payment: nullable("string", { format: "date" }),
            last_payment: day,
          },
        },
        Recorded: {
          type: "object",
          required: ["balances", "rate_date"],
          properties: { balances: { type: "array", items: ref("Balance") }, rate_date: day },
        },
        Summary: {
          type: "object",
          required: ["lens", "as_of", "assets", "liabilities", "net", "change", "by_region", "by_category", "accounts", "history"],
          properties: {
            lens: {
              type: "object",
              description: "The filters these totals were worked out through.",
              properties: { exclude_long_term: { type: "boolean" }, liquid_only: { type: "boolean" }, owner: nullable("string") },
            },
            as_of: nullable("string", { format: "date", description: "The latest recorded day; null before the first record. The totals are for it." }),
            assets: ref("Money"),
            liabilities: ref("Money"),
            net: ref("Money"),
            change: {
              oneOf: [{ allOf: [ref("Totals"), { type: "object", required: ["since"], properties: { since: day } }] }, { type: "null" }],
              description: "Against the record before as_of; null with fewer than two records.",
            },
            by_region: { type: "object", properties: Object.fromEntries(REGIONS.map((r) => [r, ref("Totals")])) },
            by_category: { type: "object", additionalProperties: ref("Money"), description: "Gross, keyed `kind:category`." },
            accounts: {
              type: "array",
              items: {
                allOf: [
                  ref("Account"),
                  {
                    type: "object",
                    required: ["display_name", "is_long_term", "weight", "counted", "latest", "loan"],
                    properties: {
                      display_name: { type: "string", description: "Institution and name, as the page shows them: 微信余额, DBS Multiplier." },
                      is_long_term: { type: "boolean", description: "long_term, with the category's default applied." },
                      weight: { type: "number", description: "The share of its balance the filters count: 1, 0, or its liquidity." },
                      counted: { type: "boolean", description: "Whether it is in as_of's totals: open then, recorded by then, and not filtered out." },
                      loan: { oneOf: [ref("LoanStatus"), { type: "null" }], description: "For a liability with loan terms." },
                      latest: {
                        oneOf: [
                          {
                            type: "object",
                            properties: {
                              as_of: day,
                              amount: { type: "number" },
                              cny_rate: { type: "number" },
                              sgd_rate: { type: "number" },
                              rate_date: day,
                              value: ref("Money"),
                            },
                          },
                          { type: "null" },
                        ],
                        description: "Its newest balance, whatever day it is from.",
                      },
                    },
                  },
                ],
              },
            },
            history: {
              type: "array",
              items: { allOf: [ref("Totals"), { type: "object", required: ["day"], properties: { day } }] },
              description: "One point per recorded day, oldest first.",
            },
          },
        },
        createAccount: {
          type: "object",
          required: ["action", "account"],
          properties: {
            action: { const: "createAccount" },
            account: { type: "object", required: ["name", "region", "currency", "kind", "category"], properties: accountFields },
          },
        },
        updateAccount: {
          type: "object",
          required: ["action", "id", "updates"],
          properties: {
            action: { const: "updateAccount" },
            id: uuid,
            updates: {
              type: "object",
              properties: { ...accountFields, archived: { type: "boolean", description: "Archive, or bring back. History stays either way." } },
              description: "Only what changes. A new kind needs a category of that kind.",
            },
          },
        },
        deleteAccount: {
          type: "object",
          required: ["action", "id"],
          properties: { action: { const: "deleteAccount" }, id: uuid },
          description: "Only an account with no balances; archive one that has them.",
        },
        recordBalances: {
          type: "object",
          required: ["action", "as_of", "entries"],
          properties: {
            action: { const: "recordBalances" },
            as_of: { ...day, description: "The day the balances are for; not later than today in Singapore." },
            entries: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["account_id", "amount"],
                properties: {
                  account_id: uuid,
                  amount: { type: "number", description: "In the account's own currency. What is owed, for a liability." },
                  note: nullable("string", { maxLength: 500 }),
                },
              },
              description: "One per account, each account once, none archived. Accounts left out carry their last balance forward.",
            },
          },
        },
        deleteBalance: {
          type: "object",
          required: ["action", "id"],
          properties: { action: { const: "deleteBalance" }, id: uuid },
        },
        addLoanRateChange: {
          type: "object",
          required: ["action", "account_id", "effective_date", "rate"],
          properties: {
            action: { const: "addLoanRateChange" },
            account_id: { ...uuid, description: "A liability with loan terms." },
            effective_date: { ...day, description: "The first repayment charged at the new rate: after loan_start, not after the last repayment. One change per day per loan." },
            rate: { type: "number", minimum: 0, exclusiveMaximum: 100, description: "Annual, in percent." },
            payment: nullable("number", { exclusiveMinimum: 0, description: "The payment from then on as the bank states it; annuity or flat only. Absent or null: what repays the balance then owed over the repayments left, to the cent." }),
          },
          description: "The months before keep the rate they were charged at. To correct a change, delete it and add it again.",
        },
        deleteLoanRateChange: {
          type: "object",
          required: ["action", "id"],
          properties: { action: { const: "deleteLoanRateChange" }, id: { ...uuid, description: "The rate change's." } },
        },
        addLoanPrepayment: {
          type: "object",
          required: ["action", "account_id", "paid_on", "amount", "mode"],
          properties: {
            action: { const: "addLoanPrepayment" },
            account_id: { ...uuid, description: "A liability with loan terms." },
            paid_on: { ...day, description: "The day it was paid: not after the last repayment. One prepayment per day per loan." },
            amount: { type: "number", exclusiveMinimum: 0, description: "Principal repaid: no more than is owed that day, which clears the loan." },
            mode: { type: "string", enum: [...PREPAYMENT_MODES], description: "shorten: the payment stays, the loan ends sooner. reduce: the end stays, the payment falls." },
            payment: nullable("number", { exclusiveMinimum: 0, description: "The payment from then on as the bank states it: reduce only, on a level payment (annuity or flat). Absent or null: worked out." }),
          },
          description: "To correct a prepayment, delete it and add it again.",
        },
        deleteLoanPrepayment: {
          type: "object",
          required: ["action", "id"],
          properties: { action: { const: "deleteLoanPrepayment" }, id: { ...uuid, description: "The prepayment's." } },
        },
      },
    },
  };
}
