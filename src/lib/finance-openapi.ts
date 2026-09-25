import { CATEGORIES, KINDS, LOAN_METHODS, REGIONS } from "./finance";
import { FINANCE_CURRENCIES } from "./fx";

/** The actions POST /api/finance takes. The route's switch is what handles them;
 *  a test holds the two to each other. */
export const FINANCE_ACTIONS = ["createAccount", "updateAccount", "deleteAccount", "recordBalances", "deleteBalance"] as const;

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
  loan_principal: nullable("number", { exclusiveMinimum: 0, description: "Loan terms go all five together, on a liability, or none. The amount borrowed, in the account's currency." }),
  loan_rate: nullable("number", { minimum: 0, exclusiveMaximum: 100, description: "Annual interest, in percent: 3.95 is 3.95%." }),
  loan_start: nullable("string", { format: "date", description: "The first repayment; each later one falls on the same day of the month." }),
  loan_term_months: nullable("integer", { minimum: 1, maximum: 600, description: "How many monthly repayments in all: 360 for thirty years." }),
  loan_method: nullable("string", { enum: [...LOAN_METHODS, null], description: "annuity is 等额本息 (a level payment); equal_principal is 等额本金 (level principal, falling payments)." }),
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
        "**Auth.** `Authorization: Bearer <FINANCE_API_TOKEN>`, reading and writing as the owner; or the owner's signed-in session. Anything else is 401. Every answer is `Cache-Control: private, no-store`.",
        "**Money.** A balance is kept in its account's own currency, with `cny_rate` and `sgd_rate`: what one unit was worth in CNY and SGD on `rate_date` (ECB mid-market; a weekend or a day not yet published takes the last published day). Totals multiply by those stored rates, so history never re-prices. A liability's balance is what is owed, as a positive number.",
        "**Days.** An account not recorded on a day carries its last balance before it forward. Recording a day again replaces that day's balance for each account sent. An archived account stops counting the day after it was archived, in Singapore (UTC+8), which is also the timezone `as_of` may not be later than today in.",
        "**Family.** Each account may name its `owner`; an asset's `liquidity` says how much of it could be spent now; a liability may carry loan terms, from which the summary works out its repayment schedule.",
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
            200: ok("createAccount and updateAccount: the account. recordBalances: the balances written and the day their rates are from. The deletes: `{ok: true}`.", {
              oneOf: [ref("Account"), ref("Recorded"), { type: "object", properties: { ok: { const: true } } }],
            }),
            400: error("The request does not make sense: the message says what"),
            401: error("Not the owner"),
            404: error("updateAccount: no such account"),
            409: error("deleteAccount on an account with balances (archive it instead), or a new currency for one"),
            502: error("recordBalances: the day's rates could not be had. Nothing was written; try again."),
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
      securitySchemes: { token: { type: "http", scheme: "bearer", description: "FINANCE_API_TOKEN" } },
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
            archived_at: nullable("string", { format: "date-time", description: "Set while archived." }),
            created_at: { type: "string", format: "date-time" },
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
          description: "Where a loan's schedule stands today, in its own currency. A prepaid loan owes less than principal_left: its recorded balance is the truth, this is the plan.",
          properties: {
            payment: { type: "number", description: "This month's payment: level under annuity, the next and falling one under equal_principal. 0 once repaid." },
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
      },
    },
  };
}
