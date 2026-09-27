import { CATEGORIES, KINDS, LOAN_DAY_COUNTS, LOAN_METHODS, PREPAYMENT_MODES, REGIONS } from "./finance";
import { FINANCE_CURRENCIES } from "./fx";
import { LIQUID_WITHIN_MONTHS, RSU_PLANS } from "./rsu";
import { LIQUID_MIN_GAIN } from "./stocks";

/** The actions POST /api/finance takes. The route's switch is what handles them;
 *  a test holds the two to each other. */
export const FINANCE_ACTIONS = [
  "createAccount", "updateAccount", "deleteAccount", "recordBalances", "deleteBalance", "addLoanRateChange", "deleteLoanRateChange",
  "addLoanPrepayment", "deleteLoanPrepayment", "addRsuGrant", "updateRsuGrant", "deleteRsuGrant", "addRsuSale", "deleteRsuSale",
  "importStockPositions", "addStockPosition", "updateStockPosition", "deleteStockPosition", "revalueStocks",
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
  rsu_plan: nullable("string", {
    enum: [...RSU_PLANS, null],
    description: "An asset holding RSUs: the plan they follow. tiktok: double-trigger RSUs a private company buys back in windows, each tranche counting once vested by a window's cutoff, at the rate its profile sets for the full years it has been vested; a window buys the floor of the sum, less every share sold in windows before. Set with rsu_rules.",
  }),
  rsu_rules: { oneOf: [ref("RsuRules"), { type: "null" }], description: "The plan's numbers, which are the owner's: only with rsu_plan. Every grant's profile must stay in them." },
  liquid_min_gain: nullable("number", {
    minimum: -100, maximum: 10000,
    description: `For an account holding stocks: how far up a position has to be, in percent, to count as liquid -- more than this. Null: ${LIQUID_MIN_GAIN}. Changing it records today's balance again, its liquid share with it.`,
  }),
};

/** A position as given to importStockPositions and addStockPosition. */
const stockInput = {
  symbol: { type: "string", description: "As the market spells it -- AAPL, 0700.HK, 600519.SS, 000001.SZ, D05.SI -- or as Futu writes it: US.AAPL, HK.00700, SH.600519. A bare six-digit code is taken as an A-share, a five-digit one starting 0 as Hong Kong's." },
  quantity: { type: "number", exclusiveMinimum: 0, description: "The shares held." },
  cost: { type: "number", minimum: 0, description: "The average cost of a share, in the currency it trades in." },
  currency: { type: "string", pattern: "^[A-Z]{3}$", description: "Optional: checked against the quote's." },
  note: nullable("string", { maxLength: 500 }),
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
        "**RSUs.** An asset with `rsu_plan` holds shares granted in tranches (`addRsuGrant`), sold only as the plan allows. Under tiktok a window buys the floor of Σ(tranche shares × its profile's rate for the full years vested by the window's cutoff), less the shares sold in windows before (`addRsuSale`); a grant not yet signed counts only where asked. `GET /api/finance/rsu` works a window out, tranche by tranche, and prices it; the summary gives each RSU account's position, next window and price. The rules carry the plan's price trend (`prices`): a window is priced at the price in effect by its cutoff, one still to come at the latest. With `liquidity` null, an RSU account's liquid share is what a window within " + LIQUID_WITHIN_MONTHS + " months may still buy of the shares held, and none while no window is that near: record its balance as the held shares at their price.",
        "**Stocks.** An asset may hold stock positions (`importStockPositions`, `addStockPosition`): shares of a symbol, as the market spells it -- AAPL, 0700.HK, 600519.SS, 000001.SZ, D05.SI -- at an average cost in the currency it trades in. They are priced from Yahoo Finance, and the account's balance for the day is recorded from them: on every change, on `revalueStocks`, and every day by the Daily jobs workflow. A position up more than the account's `liquid_min_gain` percent counts as liquid, the rest not; the balance keeps its liquid share (`liquid_share`), so each day of the history counts what was liquid then.",
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
            200: ok("createAccount, updateAccount and the loan and RSU actions: the account, with its rate changes, prepayments, RSU grants and sales and stock positions as they now stand. recordBalances: the balances written and the day their rates are from. The stock position actions: the account, and what valuing it did; revalueStocks: every account holding stocks, and the same (StockValuation). deleteAccount and deleteBalance: `{ok: true}`.", {
              oneOf: [ref("Account"), ref("Recorded"), ref("StockValuation"), { type: "object", properties: { ok: { const: true } } }],
            }),
            400: error("The request does not make sense: the message says what"),
            401: error("Not the owner"),
            404: error("updateAccount, addLoanRateChange, addLoanPrepayment, addRsuGrant, addRsuSale and the stock actions: no such account. The update and delete actions: no such one."),
            409: error("deleteAccount on an account with balances (archive it instead), a new currency for one, a second rate change or prepayment on the same day for one loan, a grant number used twice, a second sale in one window, or addStockPosition for a symbol already held"),
            502: error("recordBalances: the day's rates could not be had; nothing was written. importStockPositions and addStockPosition: a price could not be had; nothing was imported. The other stock actions: the change is kept, but the account could not be valued; revalueStocks later."),
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
      "/api/finance/rsu": {
        get: {
          operationId: "getRsuWindow",
          summary: "One RSU account's window, worked out and priced",
          description: "Which tranches count in the window and at what rate, what it may buy, and what that comes to: at the price given, or else at the plan's price in effect by the cutoff -- the latest, for a window still to come. A grant not yet signed is left out, as the employer's estimate leaves it; with_proposed and outlook_with_proposed give what it would add.",
          parameters: [
            { name: "id", in: "query", required: true, schema: uuid, description: "The RSU account." },
            { name: "window", in: "query", required: false, schema: day, description: "A window's cutoff. Absent: the next one on or after today." },
            { name: "price", in: "query", required: false, schema: { type: "number", exclusiveMinimum: 0 }, description: "Per share, in the rules' currency, to price what the window may still buy. Absent: the plan's price in effect by the cutoff." },
            { name: "tax_rate", in: "query", required: false, schema: { type: "number", minimum: 0, exclusiveMaximum: 1 }, description: "0.22 for 22%, to give what is left after tax." },
          ],
          responses: {
            200: ok("The window", ref("RsuCalculation")),
            400: error("No id, a window that is not a cutoff, or a price or tax_rate out of range"),
            401: error("Not the owner"),
            404: error("No such account, or it holds no RSUs"),
          },
        },
      },
      "/api/finance/openapi": {
        get: {
          operationId: "getOpenApi",
          summary: "This description, asked for with the token like every other call",
          responses: { 200: ok("OpenAPI 3.1", { type: "object" }), 401: error("Not the owner") },
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
            rsu_grants: {
              type: "array",
              items: ref("RsuGrant"),
              readOnly: true,
              description: "Its RSU grants, by number; empty for most accounts. Changed with addRsuGrant, updateRsuGrant and deleteRsuGrant.",
            },
            rsu_sales: {
              type: "array",
              items: ref("RsuSale"),
              readOnly: true,
              description: "What has been sold of its RSUs, by window. Changed with addRsuSale and deleteRsuSale.",
            },
            stock_positions: {
              type: "array",
              items: ref("StockPosition"),
              readOnly: true,
              description: "Its stock positions, by symbol; empty for most accounts. Changed with the stock actions.",
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
        RsuRules: {
          type: "object",
          required: ["currency", "windows", "profiles"],
          properties: {
            currency: { type: "string", enum: [...FINANCE_CURRENCIES], description: "What the share price is quoted in." },
            windows: {
              type: "object",
              required: ["months", "cutoff_day"],
              properties: {
                months: { type: "array", items: { type: "integer", minimum: 1, maximum: 12 }, minItems: 1, uniqueItems: true, description: "The months a window falls in." },
                cutoff_day: { type: "integer", minimum: 1, maximum: 28, description: "Its cutoff's day of the month: a tranche counts once vested on or before it." },
              },
            },
            profiles: {
              type: "object",
              additionalProperties: {
                type: "object",
                required: ["rates"],
                properties: {
                  label: { type: "string", maxLength: 40 },
                  rates: { type: "array", items: { type: "number", minimum: 0, maximum: 100 }, minItems: 1, maxItems: 10, description: "Percent a window buys of a tranche, by the full years it has been vested: under one, one, two... The last holds beyond; counting on it marks a window projected." },
                },
              },
              description: "By name (lowercase letters, digits, _); each grant follows one.",
            },
            verified_through: nullable("string", { format: "date", description: "The last cutoff checked against the employer's own estimate. Later windows are projected." }),
            prices: {
              type: "array",
              items: {
                type: "object",
                required: ["effective_date", "price"],
                properties: {
                  effective_date: day,
                  price: { type: "number", exclusiveMinimum: 0, description: "Per share, in the rules' currency. Given as a string -- \"100.00\", as the plan's price trend writes it -- it is kept as a number." },
                },
              },
              maxItems: 200,
              description: "The plan's price over time, one a day, kept oldest first. A window is priced at the one in effect by its cutoff.",
            },
          },
        },
        RsuGrant: {
          type: "object",
          required: ["id", "account_id", "grant_no", "profile", "signed", "tranches"],
          properties: {
            id: uuid,
            account_id: uuid,
            grant_no: { type: "string", maxLength: 40, description: "As the employer numbers it; one per account." },
            label: nullable("string", { maxLength: 80, description: "What kind of grant." }),
            profile: { type: "string", description: "Which of the account's rsu_rules profiles it sells by." },
            granted_on: nullable("string", { format: "date" }),
            vest_start: nullable("string", { format: "date", description: "The day its vesting is counted from." }),
            signed: { type: "boolean", description: "False for a grant offered and not yet accepted, which counts only where asked." },
            tranches: {
              type: "array",
              minItems: 1,
              items: { type: "object", required: ["vests_on", "shares"], properties: { vests_on: day, shares: { type: "integer", minimum: 1 } } },
              description: "Oldest first, one a day.",
            },
            note: nullable("string", { maxLength: 500 }),
            created_at: { type: "string", format: "date-time" },
          },
        },
        RsuSale: {
          type: "object",
          required: ["id", "account_id", "window_cutoff", "shares"],
          properties: {
            id: uuid,
            account_id: uuid,
            window_cutoff: { ...day, description: "The cutoff of the window it was sold in; one sale a window." },
            shares: { type: "integer", minimum: 1 },
            price: nullable("number", { description: "Per share, in the rules' currency." }),
            tax: nullable("number", { description: "Withheld, in the same currency." }),
            note: nullable("string", { maxLength: 500 }),
            created_at: { type: "string", format: "date-time" },
          },
        },
        StockPosition: {
          type: "object",
          required: ["id", "account_id", "symbol", "quantity", "cost", "currency"],
          properties: {
            id: uuid,
            account_id: uuid,
            symbol: { type: "string", description: "As the market spells it: AAPL, 0700.HK, 600519.SS, 000001.SZ, D05.SI." },
            name: nullable("string", { description: "As the quote gives it." }),
            quantity: { type: "number", exclusiveMinimum: 0 },
            cost: { type: "number", minimum: 0, description: "The average cost of a share, in `currency`." },
            currency: { type: "string", description: "What it trades in, as its quote gives it." },
            price: nullable("number", { description: "The last price it was valued at, in `currency`." }),
            fx: nullable("number", { description: "One unit of `currency` in the account's currency, when priced." }),
            priced_at: nullable("string", { format: "date-time" }),
            note: nullable("string", { maxLength: 500 }),
            created_at: { type: "string", format: "date-time" },
          },
        },
        StockPositionInput: { type: "object", required: ["symbol", "quantity", "cost"], properties: stockInput },
        StockValuation: {
          type: "object",
          properties: {
            account: { ...ref("Account"), description: "The stock position actions: the account, as it now stands." },
            accounts: { type: "array", items: ref("Account"), description: "revalueStocks: every account holding stocks." },
            balances: { type: "array", items: ref("Balance"), description: "Today's balances recorded from the positions." },
            recorded: { type: "array", items: uuid, description: "The accounts those are for." },
            priced: { type: "integer", description: "Positions given a price just now." },
            failures: {
              type: "array",
              items: { type: "object", properties: { symbol: { type: "string" }, reason: { type: "string" } } },
              description: "Symbols that could not be priced: they keep their last price.",
            },
            skipped: {
              type: "array",
              items: { type: "object", properties: { account_id: uuid, reason: { type: "string" } } },
              description: "Accounts not recorded: a position has never been priced.",
            },
          },
        },
        RsuPosition: {
          type: "object",
          description: "Where the shares stand on a day: signed grants only, a proposed one apart.",
          properties: {
            as_of: day,
            granted: { type: "integer" },
            vested: { type: "integer" },
            unvested: { type: "integer" },
            sold: { type: "integer", description: "In windows cut off by as_of." },
            held: { type: "integer", description: "Vested and not sold." },
            proposed: { type: "integer", description: "In grants not yet signed." },
          },
        },
        RsuWindow: {
          type: "object",
          properties: {
            cutoff: day,
            projected: { type: "boolean", description: "Past verified_through, or counting a tranche vested longer than its profile's rates go." },
            vested: { type: "integer", description: "Shares vested by the cutoff." },
            cumulative: { type: "integer", description: "The floor of every counted tranche's shares × rate: what this window and all before it could buy." },
            sold_before: { type: "integer" },
            quota: { type: "integer", description: "cumulative less sold_before: what the window may buy." },
            sold: { type: "integer", description: "Already sold in it." },
            remaining: { type: "integer", description: "What it may still buy." },
            lines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  grant_no: { type: "string" },
                  signed: { type: "boolean" },
                  vests_on: day,
                  shares: { type: "integer" },
                  full_years: { type: "integer", description: "Vested by the cutoff, the anniversary itself counting." },
                  rate: { type: "number", description: "Percent." },
                  sellable: { type: "number", description: "shares × rate, before the sum is rounded down." },
                  extrapolated: { type: "boolean" },
                },
              },
              description: "Every tranche the window counts, oldest first.",
            },
          },
        },
        RsuOutlook: {
          type: "array",
          items: {
            type: "object",
            properties: {
              cutoff: day,
              projected: { type: "boolean" },
              vested: { type: "integer" },
              cumulative: { type: "integer" },
              quota: { type: "integer", description: "cumulative less what was really sold before." },
              if_sold_in_full: { type: "integer", description: "What it may buy if every window from the first here is sold in full." },
              price: nullable("number", { description: "From GET /api/finance/rsu only: the price given, or else the plan's in effect by the cutoff." }),
            },
          },
          description: "The windows from today on.",
        },
        RsuStatus: {
          type: "object",
          description: "An RSU account today: the shares, the next window without its lines, what counts as liquid, and the price.",
          properties: {
            plan: { type: "string", enum: [...RSU_PLANS] },
            currency: { type: "string" },
            position: ref("RsuPosition"),
            next_window: ref("RsuWindow"),
            liquid: {
              type: "object",
              properties: {
                within_months: { type: "integer", description: `How near a window has to be to count: ${LIQUID_WITHIN_MONTHS}.` },
                window: nullable("string", { format: "date", description: "The last window cut off within that many months; null with none." }),
                shares: { type: "integer", description: "What it may still buy, and those before it with it, no more than are held." },
              },
            },
            liquidity: { type: "number", description: "liquid.shares as a share of the shares held: the account's liquidity while none is set by hand. 0 while no window is near enough." },
            price: {
              oneOf: [{ type: "object", properties: { effective_date: day, price: { type: "number" } } }, { type: "null" }],
              description: "The plan's price today, and the day it took effect; null without a price trend.",
            },
            value: nullable("number", { description: "The shares held at that price, in the rules' currency." }),
          },
        },
        RsuCalculation: {
          type: "object",
          properties: {
            account_id: uuid,
            plan: { type: "string", enum: [...RSU_PLANS] },
            currency: { type: "string", description: "The rules' currency, which the prices are in." },
            position: ref("RsuPosition"),
            window: ref("RsuWindow"),
            with_proposed: {
              oneOf: [{ type: "object", properties: { vested: { type: "integer" }, cumulative: { type: "integer" }, quota: { type: "integer" }, remaining: { type: "integer" } } }, { type: "null" }],
              description: "The window counting grants not yet signed; null with none.",
            },
            proceeds: {
              oneOf: [{
                type: "object",
                properties: {
                  price: { type: "number" },
                  price_effective_date: nullable("string", { format: "date", description: "When the plan's price used took effect; null for a price given." }),
                  tax_rate: nullable("number"),
                  gross: { type: "number", description: "window.remaining × price, before tax." },
                  tax: nullable("number"),
                  net: nullable("number", { description: "After tax; null without tax_rate." }),
                },
              }, { type: "null" }],
              description: "Null with no price given and none in the rules.",
            },
            outlook: ref("RsuOutlook"),
            outlook_with_proposed: { oneOf: [ref("RsuOutlook"), { type: "null" }] },
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
            liquid_share: nullable("number", {
              minimum: 0, maximum: 1,
              description: "The share of it that was liquid when recorded, for a stock account valued from its positions. Null follows the account.",
            }),
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
                    required: ["display_name", "is_long_term", "weight", "counted", "latest", "loan", "rsu", "stocks"],
                    properties: {
                      display_name: { type: "string", description: "Institution and name, as the page shows them: 微信余额, DBS Multiplier." },
                      is_long_term: { type: "boolean", description: "long_term, with the category's default applied." },
                      weight: { type: "number", description: "The share of its balance the filters count: 1, 0, or its liquidity." },
                      counted: { type: "boolean", description: "Whether it is in as_of's totals: open then, recorded by then, and not filtered out." },
                      loan: { oneOf: [ref("LoanStatus"), { type: "null" }], description: "For a liability with loan terms." },
                      rsu: { oneOf: [ref("RsuStatus"), { type: "null" }], description: "For an asset holding RSUs." },
                      stocks: {
                        oneOf: [{
                          type: "object",
                          properties: {
                            positions: { type: "integer" },
                            value: { type: "number", description: "At the prices last fetched, in the account's currency." },
                            cost: { type: "number" },
                            gain: nullable("number", { description: "value against cost, as a share: 0.12 for 12%." }),
                            liquid_value: { type: "number", description: "Of the positions up more than min_gain percent." },
                            liquidity: { type: "number" },
                            min_gain: { type: "number" },
                            unpriced: { type: "array", items: { type: "string" }, description: "Symbols never priced, left out of the sums." },
                            priced_at: nullable("string", { format: "date-time" }),
                          },
                        }, { type: "null" }],
                        description: "For an asset holding stocks.",
                      },
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
        addRsuGrant: {
          type: "object",
          required: ["action", "account_id", "grant_no", "profile", "tranches"],
          properties: {
            action: { const: "addRsuGrant" },
            account_id: { ...uuid, description: "An asset with rsu_plan and rsu_rules." },
            grant_no: { type: "string", maxLength: 40, description: "One per account." },
            label: nullable("string", { maxLength: 80 }),
            profile: { type: "string", description: "One of the account's rsu_rules profiles." },
            granted_on: nullable("string", { format: "date" }),
            vest_start: nullable("string", { format: "date" }),
            signed: { type: "boolean", description: "Absent: true. False for a grant offered and not yet accepted." },
            tranches: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", required: ["vests_on", "shares"], properties: { vests_on: day, shares: { type: "integer", minimum: 1 } } }, description: "In any order; one a day." },
            note: nullable("string", { maxLength: 500 }),
          },
        },
        updateRsuGrant: {
          type: "object",
          required: ["action", "id", "updates"],
          properties: {
            action: { const: "updateRsuGrant" },
            id: { ...uuid, description: "The grant's." },
            updates: {
              type: "object",
              properties: {
                grant_no: { type: "string" }, label: nullable("string"), profile: { type: "string" }, granted_on: nullable("string", { format: "date" }),
                vest_start: nullable("string", { format: "date" }), signed: { type: "boolean" }, note: nullable("string"),
                tranches: { type: "array", items: { type: "object", properties: { vests_on: day, shares: { type: "integer", minimum: 1 } } } },
              },
              description: "Only what changes: signed true once a proposed grant is accepted, or tranches corrected.",
            },
          },
        },
        deleteRsuGrant: {
          type: "object",
          required: ["action", "id"],
          properties: { action: { const: "deleteRsuGrant" }, id: { ...uuid, description: "The grant's." } },
        },
        addRsuSale: {
          type: "object",
          required: ["action", "account_id", "window_cutoff", "shares"],
          properties: {
            action: { const: "addRsuSale" },
            account_id: { ...uuid, description: "An asset with rsu_plan and rsu_rules." },
            window_cutoff: { ...day, description: "A window's cutoff, per the rules; one sale a window." },
            shares: { type: "integer", minimum: 1, description: "No more than held by the cutoff: vested, less sold in windows before. The window's quota is the plan's estimate, not a limit." },
            price: nullable("number", { exclusiveMinimum: 0, description: "Per share, in the rules' currency." }),
            tax: nullable("number", { minimum: 0, description: "Withheld, in the same currency." }),
            note: nullable("string", { maxLength: 500 }),
          },
          description: "Later windows' quotas are net of it. To correct a sale, delete it and add it again.",
        },
        deleteRsuSale: {
          type: "object",
          required: ["action", "id"],
          properties: { action: { const: "deleteRsuSale" }, id: { ...uuid, description: "The sale's." } },
        },
        importStockPositions: {
          type: "object",
          required: ["action", "account_id", "positions"],
          properties: {
            action: { const: "importStockPositions" },
            account_id: { ...uuid, description: "An open asset holding no RSUs." },
            positions: { type: "array", minItems: 1, maxItems: 200, items: ref("StockPositionInput") },
            replace: { type: "boolean", default: true, description: "Remove the positions not listed, as a broker's statement would. False adds and updates only." },
          },
          description: "Each symbol is checked against the quote source first: one it does not know refuses the lot. The account is then valued and today's balance recorded.",
        },
        addStockPosition: {
          type: "object",
          required: ["action", "account_id", "symbol", "quantity", "cost"],
          properties: { action: { const: "addStockPosition" }, account_id: { ...uuid, description: "An open asset holding no RSUs." }, ...stockInput },
        },
        updateStockPosition: {
          type: "object",
          required: ["action", "id", "updates"],
          properties: {
            action: { const: "updateStockPosition" },
            id: { ...uuid, description: "The position's." },
            updates: {
              type: "object",
              properties: { quantity: stockInput.quantity, cost: stockInput.cost, note: stockInput.note },
              description: "Only what changes. The account is valued again at the prices already kept.",
            },
          },
        },
        deleteStockPosition: {
          type: "object",
          required: ["action", "id"],
          properties: { action: { const: "deleteStockPosition" }, id: { ...uuid, description: "The position's." } },
          description: "The account is valued again without it: at nothing, with none left.",
        },
        revalueStocks: {
          type: "object",
          required: ["action"],
          properties: {
            action: { const: "revalueStocks" },
            account_id: { ...uuid, description: "One account; absent, every account holding stocks." },
            prices: { type: "string", enum: ["fetch", "kept"], default: "fetch", description: "fetch: price each position now. kept: at the prices already fetched." },
          },
          description: "Records today's balance of each account from its positions.",
        },
      },
    },
  };
}
