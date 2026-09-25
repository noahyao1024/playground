import { CATEGORIES, KINDS, REGIONS } from "./finance";
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
};

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
          description: "Totals on the latest recorded day, the change since the record before it, every account with its newest balance, and one point per recorded day.",
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
        Recorded: {
          type: "object",
          required: ["balances", "rate_date"],
          properties: { balances: { type: "array", items: ref("Balance") }, rate_date: day },
        },
        Summary: {
          type: "object",
          required: ["as_of", "assets", "liabilities", "net", "change", "by_region", "by_category", "accounts", "history"],
          properties: {
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
                    required: ["counted", "latest"],
                    properties: {
                      counted: { type: "boolean", description: "Whether it is in as_of's totals: open then, and recorded by then." },
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
