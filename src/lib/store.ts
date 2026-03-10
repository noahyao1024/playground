// localStorage-based storage with typed helpers

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

// ─── Types ───────────────────────────────────────────────────────────

export interface BillMember {
  id: string;
  name: string;
}

export interface ExchangeRates {
  SGD_CNY: number;
  USD_CNY: number;
}

export interface BillTerm {
  id: string;
  name: string;
  rates: ExchangeRates;
}

export interface BillEntry {
  id: string;
  termId: string;
  memberId: string;
  date: string; // day of month or full date
  amount: number;
  currency: "SGD" | "USD";
  note?: string;
}

export interface BillGroup {
  id: string;
  name: string;
  members: BillMember[];
  terms: BillTerm[];
  entries: BillEntry[];
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

// ─── Default data ────────────────────────────────────────────────────

const DEFAULT_MEMBERS: BillMember[] = [
  { id: "m1", name: "小明大哥" },
  { id: "m2", name: "袁老板" },
  { id: "m3", name: "周岩" },
  { id: "m4", name: "帅哥" },
  { id: "m5", name: "Xinyu" },
];

const DEFAULT_TERMS: BillTerm[] = [
  { id: "t1", name: "Term 1", rates: { SGD_CNY: 5.47, USD_CNY: 6.91 } },
  { id: "t2", name: "Term 2", rates: { SGD_CNY: 5.45, USD_CNY: 6.99 } },
];

const DEFAULT_ENTRIES: BillEntry[] = [
  // Term 1 entries
  { id: "e1", termId: "t1", memberId: "m1", date: "12", amount: 28.99, currency: "SGD", note: "Monthly subscription" },
  { id: "e2", termId: "t1", memberId: "m2", date: "17", amount: 21.8, currency: "USD", note: "Monthly subscription" },
  { id: "e3", termId: "t1", memberId: "m3", date: "25", amount: 21.8, currency: "USD", note: "Monthly subscription" },
  { id: "e4", termId: "t1", memberId: "m4", date: "7", amount: 28.99, currency: "SGD", note: "Monthly subscription" },
  // Term 2 entries
  { id: "e5", termId: "t2", memberId: "m1", date: "12", amount: 28.99, currency: "SGD", note: "Monthly subscription" },
  { id: "e6", termId: "t2", memberId: "m2", date: "17", amount: 28.99, currency: "SGD", note: "Switched to SGD" },
  { id: "e7", termId: "t2", memberId: "m3", date: "25", amount: 21.8, currency: "USD", note: "Monthly subscription" },
  { id: "e8", termId: "t2", memberId: "m4", date: "7", amount: 28.99, currency: "SGD", note: "Monthly subscription" },
  { id: "e9", termId: "t2", memberId: "m5", date: "20", amount: 30, currency: "USD", note: "Joined Term 2" },
];

const DEFAULT_BILL_GROUP: BillGroup = {
  id: "bg1",
  name: "Subscription Split / 订阅分摊",
  members: DEFAULT_MEMBERS,
  terms: DEFAULT_TERMS,
  entries: DEFAULT_ENTRIES,
};

// ─── Store operations ────────────────────────────────────────────────

const BILL_KEY = "playground_bill_group";
const MACHINES_KEY = "playground_machines";

export function getBillGroup(): BillGroup {
  return getItem<BillGroup>(BILL_KEY, DEFAULT_BILL_GROUP);
}

export function saveBillGroup(group: BillGroup): void {
  setItem(BILL_KEY, group);
}

export function getMachines(): Machine[] {
  return getItem<Machine[]>(MACHINES_KEY, []);
}

export function saveMachines(machines: Machine[]): void {
  setItem(MACHINES_KEY, machines);
}

// ─── Bill calculation helpers ────────────────────────────────────────

export function toCNY(amount: number, currency: "SGD" | "USD", rates: ExchangeRates): number {
  return currency === "SGD" ? amount * rates.SGD_CNY : amount * rates.USD_CNY;
}

export interface TermSummary {
  termId: string;
  termName: string;
  totalCNY: number;
  memberCount: number;
  equalShare: number;
  memberSummaries: {
    memberId: string;
    memberName: string;
    paidCNY: number;
    owes: number; // positive = underpaid, negative = overpaid
    entries: BillEntry[];
  }[];
}

export function calculateTermSummary(group: BillGroup, termId: string): TermSummary {
  const term = group.terms.find((t) => t.id === termId)!;
  const termEntries = group.entries.filter((e) => e.termId === termId);

  // Figure out which members have entries in this term
  const activeMemberIds = new Set(termEntries.map((e) => e.memberId));
  const activeMembers = group.members.filter((m) => activeMemberIds.has(m.id));

  const totalCNY = termEntries.reduce((sum, e) => sum + toCNY(e.amount, e.currency, term.rates), 0);
  const memberCount = activeMembers.length;
  const equalShare = memberCount > 0 ? totalCNY / memberCount : 0;

  const memberSummaries = activeMembers.map((member) => {
    const entries = termEntries.filter((e) => e.memberId === member.id);
    const paidCNY = entries.reduce((sum, e) => sum + toCNY(e.amount, e.currency, term.rates), 0);
    return {
      memberId: member.id,
      memberName: member.name,
      paidCNY,
      owes: equalShare - paidCNY,
      entries,
    };
  });

  return { termId, termName: term.name, totalCNY, memberCount, equalShare, memberSummaries };
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
}

export function calculateSettlements(summary: TermSummary): Settlement[] {
  const debtors = summary.memberSummaries
    .filter((m) => m.owes > 0.01)
    .map((m) => ({ name: m.memberName, amount: m.owes }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = summary.memberSummaries
    .filter((m) => m.owes < -0.01)
    .map((m) => ({ name: m.memberName, amount: -m.owes }))
    .sort((a, b) => b.amount - a.amount);

  const settlements: Settlement[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const transfer = Math.min(debtors[i].amount, creditors[j].amount);
    if (transfer > 0.01) {
      settlements.push({ from: debtors[i].name, to: creditors[j].name, amount: transfer });
    }
    debtors[i].amount -= transfer;
    creditors[j].amount -= transfer;
    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }

  return settlements;
}

// ─── ID generation ───────────────────────────────────────────────────

export function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
