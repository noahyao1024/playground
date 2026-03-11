import { supabase } from "./supabase";

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
  note?: string;
}

export interface SubscriptionData {
  services: Service[];
  subscribers: Subscriber[];
  charges: ChargeRecord[];
}

// ─── localStorage fallback helpers ───────────────────────────────────

const LS_KEY = "subscriptionData";

function readLocal(): SubscriptionData {
  if (typeof window === "undefined") return { services: [], subscribers: [], charges: [] };
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : { services: [], subscribers: [], charges: [] };
  } catch {
    return { services: [], subscribers: [], charges: [] };
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

// ─── Supabase operations (with localStorage fallback) ────────────────

export async function fetchSubscriptionData(): Promise<SubscriptionData> {
  if (!supabase) return readLocal();

  const [{ data: services }, { data: subscribers }, { data: charges }] = await Promise.all([
    supabase.from("services").select("*").order("created_at"),
    supabase.from("subscribers").select("*").order("created_at"),
    supabase.from("charges").select("*").order("created_at"),
  ]);
  return {
    services: (services ?? []) as Service[],
    subscribers: (subscribers ?? []) as Subscriber[],
    charges: (charges ?? []) as ChargeRecord[],
  };
}

// Services
export async function addService(service: Omit<Service, "id">) {
  if (!supabase) {
    const data = readLocal();
    const newService: Service = { id: localId(), ...service };
    data.services.push(newService);
    writeLocal(data);
    return newService;
  }
  const { data, error } = await supabase.from("services").insert(service).select().single();
  if (error) throw error;
  return data as Service;
}

export async function updateService(id: string, updates: Partial<Service>) {
  if (!supabase) {
    const data = readLocal();
    data.services = data.services.map((s) => (s.id === id ? { ...s, ...updates } : s));
    writeLocal(data);
    return;
  }
  const { error } = await supabase.from("services").update(updates).eq("id", id);
  if (error) throw error;
}

export async function deleteService(id: string) {
  if (!supabase) {
    const data = readLocal();
    data.services = data.services.filter((s) => s.id !== id);
    writeLocal(data);
    return;
  }
  const { error } = await supabase.from("services").delete().eq("id", id);
  if (error) throw error;
}

// Subscribers
export async function addSubscriber(name: string) {
  if (!supabase) {
    const data = readLocal();
    const newSub: Subscriber = { id: localId(), name };
    data.subscribers.push(newSub);
    writeLocal(data);
    return newSub;
  }
  const { data, error } = await supabase.from("subscribers").insert({ name }).select().single();
  if (error) throw error;
  return data as Subscriber;
}

export async function deleteSubscriber(id: string) {
  if (!supabase) {
    const data = readLocal();
    data.subscribers = data.subscribers.filter((s) => s.id !== id);
    writeLocal(data);
    return;
  }
  const { error } = await supabase.from("subscribers").delete().eq("id", id);
  if (error) throw error;
}

// Charges
export async function addCharge(charge: Omit<ChargeRecord, "id">) {
  if (!supabase) {
    const data = readLocal();
    const newCharge: ChargeRecord = { id: localId(), ...charge };
    data.charges.push(newCharge);
    writeLocal(data);
    return newCharge;
  }
  const { data, error } = await supabase.from("charges").insert(charge).select().single();
  if (error) throw error;
  return data as ChargeRecord;
}

export async function updateCharge(id: string, updates: Partial<ChargeRecord>) {
  if (!supabase) {
    const data = readLocal();
    data.charges = data.charges.map((c) => (c.id === id ? { ...c, ...updates } : c));
    writeLocal(data);
    return;
  }
  const { error } = await supabase.from("charges").update(updates).eq("id", id);
  if (error) throw error;
}

export async function deleteCharge(id: string) {
  if (!supabase) {
    const data = readLocal();
    data.charges = data.charges.filter((c) => c.id !== id);
    writeLocal(data);
    return;
  }
  const { error } = await supabase.from("charges").delete().eq("id", id);
  if (error) throw error;
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function calcMonths(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

export function calcTotalCNY(months: number, monthlyCost: number, exchangeRate: number): number {
  return months * monthlyCost * exchangeRate;
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
