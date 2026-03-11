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

// ─── Supabase operations ─────────────────────────────────────────────

export async function fetchSubscriptionData(): Promise<SubscriptionData> {
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
  const { data, error } = await supabase.from("services").insert(service).select().single();
  if (error) throw error;
  return data as Service;
}

export async function updateService(id: string, updates: Partial<Service>) {
  const { error } = await supabase.from("services").update(updates).eq("id", id);
  if (error) throw error;
}

export async function deleteService(id: string) {
  const { error } = await supabase.from("services").delete().eq("id", id);
  if (error) throw error;
}

// Subscribers
export async function addSubscriber(name: string) {
  const { data, error } = await supabase.from("subscribers").insert({ name }).select().single();
  if (error) throw error;
  return data as Subscriber;
}

export async function deleteSubscriber(id: string) {
  const { error } = await supabase.from("subscribers").delete().eq("id", id);
  if (error) throw error;
}

// Charges
export async function addCharge(charge: Omit<ChargeRecord, "id">) {
  const { data, error } = await supabase.from("charges").insert(charge).select().single();
  if (error) throw error;
  return data as ChargeRecord;
}

export async function updateCharge(id: string, updates: Partial<ChargeRecord>) {
  const { error } = await supabase.from("charges").update(updates).eq("id", id);
  if (error) throw error;
}

export async function deleteCharge(id: string) {
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
