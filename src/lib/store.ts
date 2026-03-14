import { supabase } from "./supabase";

// ─── Server write helper ────────────────────────────────────────────

async function serverWrite(action: string, table: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, table, ...payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ─── Types ───────────────────────────────────────────────────────────

export type Currency = "USD" | "SGD";

export interface Service {
  id: string;
  name: string;
  monthly_cost: number;
  currency: Currency;
}

export interface Subscriber {
  id: string;
  name: string;
}

export interface Subscription {
  id: string;
  subscriber_id: string;
  service_id: string;
  start_date: string; // YYYY-MM-DD
  exchange_rate?: number; // legacy, now set at charge time
  active: boolean;
  payment_method_id?: string;
  created_at?: string;
}

export interface ChargeRecord {
  id: string;
  subscriber_id: string;
  service_id: string;
  period_start: string;
  period_end: string;
  months: number;
  monthly_cost: number;
  currency: Currency;
  exchange_rate: number;
  total_cny: number;
  paid: boolean;
  paid_date?: string;
  payment_method_id?: string;
  note?: string;
  created_at?: string;
}

export type CardType = "visa" | "mastercard" | "amex" | "discover" | "unionpay" | "jcb" | "diners" | "unknown";

export interface PaymentMethod {
  id: string;
  label: string;
  cardholder_name: string;
  card_type: CardType;
  last4: string;
  expiry_month: number;
  expiry_year: number;
  is_default: boolean;
  created_at?: string;
}

export function detectCardType(cardNumber: string): CardType {
  const n = cardNumber.replace(/\D/g, "");
  if (!n) return "unknown";
  if (/^4/.test(n)) return "visa";
  if (/^5[1-5]/.test(n) || /^2(2[2-9][1-9]|2[3-9]\d|[3-6]\d{2}|7[01]\d|720)/.test(n)) return "mastercard";
  if (/^3[47]/.test(n)) return "amex";
  if (/^6(?:011|5)/.test(n)) return "discover";
  if (/^62/.test(n)) return "unionpay";
  if (/^35(?:2[89]|[3-8])/.test(n)) return "jcb";
  if (/^3(?:0[0-5]|[68])/.test(n)) return "diners";
  return "unknown";
}

export function maskCardNumber(cardNumber: string): string {
  const n = cardNumber.replace(/\D/g, "");
  if (n.length < 4) return n;
  return `**** **** **** ${n.slice(-4)}`;
}

export interface SubscriptionData {
  services: Service[];
  subscribers: Subscriber[];
  subscriptions: Subscription[];
  charges: ChargeRecord[];
  payment_methods: PaymentMethod[];
}

// ─── localStorage fallback helpers ───────────────────────────────────

const LS_KEY = "subscriptionData";

function readLocal(): SubscriptionData {
  if (typeof window === "undefined") return { services: [], subscribers: [], subscriptions: [], charges: [], payment_methods: [] };
  try {
    const raw = localStorage.getItem(LS_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return {
      services: data.services ?? [],
      subscribers: data.subscribers ?? [],
      subscriptions: data.subscriptions ?? [],
      charges: data.charges ?? [],
      payment_methods: data.payment_methods ?? [],
    };
  } catch {
    return { services: [], subscribers: [], subscriptions: [], charges: [], payment_methods: [] };
  }
}

function writeLocal(data: SubscriptionData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function localId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ─── Fetch all ───────────────────────────────────────────────────────

export async function fetchSubscriptionData(): Promise<SubscriptionData> {
  if (!supabase) return readLocal();

  const [{ data: services }, { data: subscribers }, { data: subscriptions }, { data: charges }, { data: payment_methods }] = await Promise.all([
    supabase.from("services").select("*").order("name"),
    supabase.from("subscribers").select("*").order("name"),
    supabase.from("subscriptions").select("*").order("created_at"),
    supabase.from("charges").select("*").order("created_at"),
    supabase.from("payment_methods").select("*").order("created_at"),
  ]);
  return {
    services: (services ?? []) as Service[],
    subscribers: (subscribers ?? []) as Subscriber[],
    subscriptions: (subscriptions ?? []) as Subscription[],
    charges: (charges ?? []) as ChargeRecord[],
    payment_methods: (payment_methods ?? []) as PaymentMethod[],
  };
}

// ─── Services ────────────────────────────────────────────────────────

export async function addService(service: Omit<Service, "id">) {
  if (!supabase) {
    const data = readLocal();
    const newService: Service = { id: localId(), ...service };
    data.services.push(newService);
    writeLocal(data);
    return newService;
  }
  return await serverWrite("insert", "services", { data: service }) as Service;
}

export async function updateService(id: string, updates: Partial<Service>) {
  if (!supabase) {
    const data = readLocal();
    data.services = data.services.map((s) => (s.id === id ? { ...s, ...updates } : s));
    writeLocal(data);
    return;
  }
  await serverWrite("update", "services", { id, updates });
}

export async function deleteService(id: string) {
  if (!supabase) {
    const data = readLocal();
    data.services = data.services.filter((s) => s.id !== id);
    writeLocal(data);
    return;
  }
  await serverWrite("delete", "services", { id });
}

// ─── Subscribers ─────────────────────────────────────────────────────

export async function addSubscriber(name: string) {
  if (!supabase) {
    const data = readLocal();
    const newSub: Subscriber = { id: localId(), name };
    data.subscribers.push(newSub);
    writeLocal(data);
    return newSub;
  }
  return await serverWrite("insert", "subscribers", { data: { name } }) as Subscriber;
}

export async function updateSubscriber(id: string, updates: Partial<Subscriber>) {
  if (!supabase) {
    const data = readLocal();
    data.subscribers = data.subscribers.map((s) => (s.id === id ? { ...s, ...updates } : s));
    writeLocal(data);
    return;
  }
  await serverWrite("update", "subscribers", { id, updates });
}

export async function deleteSubscriber(id: string) {
  if (!supabase) {
    const data = readLocal();
    data.subscribers = data.subscribers.filter((s) => s.id !== id);
    writeLocal(data);
    return;
  }
  await serverWrite("delete", "subscribers", { id });
}

// ─── Subscriptions ───────────────────────────────────────────────────

export async function addSubscription(sub: Omit<Subscription, "id" | "created_at">) {
  if (!supabase) {
    const data = readLocal();
    const newSub: Subscription = { id: localId(), ...sub };
    data.subscriptions.push(newSub);
    writeLocal(data);
    return newSub;
  }
  return await serverWrite("insert", "subscriptions", { data: sub }) as Subscription;
}

export async function updateSubscription(id: string, updates: Partial<Subscription>) {
  if (!supabase) {
    const data = readLocal();
    data.subscriptions = data.subscriptions.map((s) => (s.id === id ? { ...s, ...updates } : s));
    writeLocal(data);
    return;
  }
  await serverWrite("update", "subscriptions", { id, updates });
}

export async function deleteSubscription(id: string) {
  if (!supabase) {
    const data = readLocal();
    data.subscriptions = data.subscriptions.filter((s) => s.id !== id);
    writeLocal(data);
    return;
  }
  await serverWrite("delete", "subscriptions", { id });
}

// ─── Charges ─────────────────────────────────────────────────────────

export async function addCharge(charge: Omit<ChargeRecord, "id">) {
  if (!supabase) {
    const data = readLocal();
    const newCharge: ChargeRecord = { id: localId(), ...charge };
    data.charges.push(newCharge);
    writeLocal(data);
    return newCharge;
  }
  return await serverWrite("insert", "charges", { data: charge }) as ChargeRecord;
}

export async function updateCharge(id: string, updates: Partial<ChargeRecord>) {
  if (!supabase) {
    const data = readLocal();
    data.charges = data.charges.map((c) => (c.id === id ? { ...c, ...updates } : c));
    writeLocal(data);
    return;
  }
  await serverWrite("update", "charges", { id, updates });
}

export async function deleteCharge(id: string) {
  if (!supabase) {
    const data = readLocal();
    data.charges = data.charges.filter((c) => c.id !== id);
    writeLocal(data);
    return;
  }
  await serverWrite("delete", "charges", { id });
}

// ─── Payment Methods ──────────────────────────────────────────────────

export async function addPaymentMethod(pm: Omit<PaymentMethod, "id" | "created_at">) {
  if (!supabase) {
    const data = readLocal();
    if (pm.is_default) data.payment_methods = data.payment_methods.map((p) => ({ ...p, is_default: false }));
    const newPm: PaymentMethod = { id: localId(), ...pm };
    data.payment_methods.push(newPm);
    writeLocal(data);
    return newPm;
  }
  if (pm.is_default) {
    await serverWrite("update", "payment_methods", { id: "__all__", updates: { is_default: false } }).catch(() => {});
  }
  return await serverWrite("insert", "payment_methods", { data: pm }) as PaymentMethod;
}

export async function updatePaymentMethod(id: string, updates: Partial<PaymentMethod>) {
  if (!supabase) {
    const data = readLocal();
    if (updates.is_default) data.payment_methods = data.payment_methods.map((p) => ({ ...p, is_default: false }));
    data.payment_methods = data.payment_methods.map((p) => (p.id === id ? { ...p, ...updates } : p));
    writeLocal(data);
    return;
  }
  if (updates.is_default) {
    await serverWrite("update", "payment_methods", { id: "__all__", updates: { is_default: false } }).catch(() => {});
  }
  await serverWrite("update", "payment_methods", { id, updates });
}

export async function deletePaymentMethod(id: string) {
  if (!supabase) {
    const data = readLocal();
    data.payment_methods = data.payment_methods.filter((p) => p.id !== id);
    writeLocal(data);
    return;
  }
  await serverWrite("delete", "payment_methods", { id });
}

// ─── Client-side billing (localStorage fallback) ─────────────────────

/** Generate list of YYYY-MM strings from startMonth to endMonth inclusive */
function monthRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

export async function billNowClient(month: string, exchangeRate: number): Promise<number> {
  const data = readLocal();
  let count = 0;
  for (const sub of data.subscriptions) {
    if (!sub.active) continue;
    const startDate = sub.start_date ?? sub.created_at?.slice(0, 10) ?? `${month}-01`;
    const startMonth = startDate.slice(0, 7);
    const service = data.services.find((s) => s.id === sub.service_id);
    if (!service) continue;
    const monthlyCost = Number(service.monthly_cost);

    for (const m of monthRange(startMonth, month)) {
      const exists = data.charges.some(
        (c) => c.subscriber_id === sub.subscriber_id && c.service_id === sub.service_id && c.period_start === m
      );
      if (exists) continue;
      const ratio = prorateRatio(startDate, m);
      if (ratio === 0) continue;
      const totalCny = monthlyCost * ratio * exchangeRate;
      const note = ratio < 1 ? `Prorated (${Math.round(ratio * 100)}%)` : "Auto-generated";
      data.charges.push({
        id: localId(),
        subscriber_id: sub.subscriber_id,
        service_id: sub.service_id,
        period_start: m,
        period_end: m,
        months: 1,
        monthly_cost: monthlyCost,
        currency: service.currency,
        exchange_rate: exchangeRate,
        total_cny: Number(totalCny.toFixed(2)),
        paid: false,
        note,
      });
      count++;
    }
  }
  writeLocal(data);
  return count;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Days in a given month (YYYY-MM) */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Calculate the prorate ratio for a subscription in a given billing month.
 * - If start_date is before the month → 1 (full month)
 * - If start_date is within the month → (remaining days) / (total days)
 * - If start_date is after the month → 0 (don't bill)
 */
export function prorateRatio(startDate: string, billingMonth: string): number {
  const monthStart = `${billingMonth}-01`;
  const totalDays = daysInMonth(billingMonth);
  const monthEnd = `${billingMonth}-${String(totalDays).padStart(2, "0")}`;

  if (startDate <= monthStart) return 1;
  if (startDate > monthEnd) return 0;

  const startDay = parseInt(startDate.split("-")[2], 10);
  return (totalDays - startDay + 1) / totalDays;
}

export function calcMonths(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

export function calcTotalCNY(months: number, monthlyCost: number, exchangeRate: number): number {
  return months * monthlyCost * exchangeRate;
}

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Machine (kept as localStorage) ──────────────────────────────────

function getItem<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setItem<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

export interface Machine {
  id: string;
  hostname: string;
  ip: string;
  os: string;
  specs: string;
  location: string;
  status: "ordered" | "shipped" | "delivered" | "deployed";
  notes: string;
  createdAt: string;
  updatedAt: string;
  timeline: { status: string; date: string; note?: string }[];
}

const MACHINES_KEY = "playground_machines";

export function getMachines(): Machine[] {
  return getItem<Machine[]>(MACHINES_KEY, []);
}

export function saveMachines(machines: Machine[]): void {
  setItem(MACHINES_KEY, machines);
}

export function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
