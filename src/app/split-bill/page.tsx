"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  fetchSubscriptionData,
  addService as apiAddService,
  updateService as apiUpdateService,
  deleteService as apiDeleteService,
  addSubscriber as apiAddSubscriber,
  updateSubscriber as apiUpdateSubscriber,
  deleteSubscriber as apiDeleteSubscriber,
  addSubscription as apiAddSubscription,
  updateSubscription as apiUpdateSubscription,
  deleteSubscription as apiDeleteSubscription,
  addCharge as apiAddCharge,
  updateCharge as apiUpdateCharge,
  deleteCharge as apiDeleteCharge,
  addPaymentMethod as apiAddPaymentMethod,
  updatePaymentMethod as apiUpdatePaymentMethod,
  deletePaymentMethod as apiDeletePaymentMethod,
  detectCardType,
  maskCardNumber,
  billNowClient,
  calcMonths,
  calcTotalCNY,
  currentMonth as getCurrentMonth,
  type SubscriptionData,
  type Service,
  type Subscription,
  type ChargeRecord,
  type PaymentMethod,
  type CardType,
  type Currency,
} from "@/lib/store";

import { ALLOWED_EMAILS } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MonthPicker } from "@/components/month-picker";
import {
  Plus, Trash2, Edit2, Check, X, Users, DollarSign, Settings,
  Search, Download, CheckCheck, TrendingUp, Clock,
  ArrowUpDown, ChevronLeft, ChevronRight, BarChart3, Keyboard,
  Zap, Pause, Play, Receipt, Lock, CreditCard, Star,
} from "lucide-react";
import { SpendingPieChart } from "@/components/charts/spending-pie-chart";
import { PersonBarChart } from "@/components/charts/person-bar-chart";

const PAGE_SIZE = 20;

// ─── Helpers ──────────────────────────────────────────────────────────
function getInitial(name: string) { return name[0]?.toUpperCase() ?? "?"; }

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96" />
    </div>
  );
}

function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const s = size === "md" ? "h-8 w-8 text-xs" : "h-6 w-6 text-[10px]";
  return <div className={`flex ${s} items-center justify-center rounded-full bg-muted font-medium text-muted-foreground`}>{getInitial(name)}</div>;
}

function ConfirmDialog({ open, onOpenChange, title, description, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={() => { onConfirm(); onOpenChange(false); }}>Delete</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KeyboardHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Keyboard Shortcuts</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          {[["?", "Show help"], ["n", "New subscription"], ["/", "Focus search"], ["1-6", "Switch tabs"]].map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-muted-foreground">{desc}</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">{key}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function exportToCSV(charges: ChargeRecord[], services: Service[], subscribers: { id: string; name: string }[]) {
  const headers = ["Subscriber", "Service", "Month", "Monthly Cost", "Currency", "Exchange Rate", "Total CNY", "Paid", "Paid Date", "Note"];
  const rows = charges.map((c) => {
    const sub = subscribers.find((s) => s.id === c.subscriber_id);
    const svc = services.find((s) => s.id === c.service_id);
    return [sub?.name ?? "", svc?.name ?? "", c.period_start, c.monthly_cost, c.currency, c.exchange_rate, Number(c.total_cny).toFixed(2), c.paid ? "Yes" : "No", c.paid_date ?? "", c.note ?? ""];
  });
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("CSV exported");
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${active ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
      {children}
    </button>
  );
}

const CARD_TYPE_LABELS: Record<string, string> = {
  visa: "Visa", mastercard: "MC", amex: "Amex", discover: "Discover",
  unionpay: "UnionPay", jcb: "JCB", diners: "Diners", unknown: "Card",
};

function CardIcon({ type, className = "h-4 w-4" }: { type: string; className?: string }) {
  const colors: Record<string, string> = {
    visa: "text-blue-500", mastercard: "text-orange-500", amex: "text-indigo-500",
    discover: "text-amber-500", unionpay: "text-red-500", jcb: "text-green-500",
    diners: "text-cyan-500", unknown: "text-muted-foreground",
  };
  return <CreditCard className={`${className} ${colors[type] ?? colors.unknown}`} />;
}

function PaymentMethodBadge({ pm }: { pm: PaymentMethod | undefined }) {
  if (!pm) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CardIcon type={pm.card_type} className="h-3 w-3" />
      <span>{CARD_TYPE_LABELS[pm.card_type] ?? "Card"} ****{pm.last4}</span>
    </span>
  );
}

function formatCardInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

// ═══════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════
export default function SubscriptionPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  const canEdit = !!session?.user?.email && ALLOWED_EMAILS.includes(session.user.email);

  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("subscriptions");
  const [addSubOpen, setAddSubOpen] = useState(false);
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [editServiceOpen, setEditServiceOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editingSubRate, setEditingSubRate] = useState<{ id: string; rate: number } | null>(null);
  const [newSubscriberName, setNewSubscriberName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ type: string; id: string; name: string } | null>(null);
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null);
  const [editingChargeNote, setEditingChargeNote] = useState("");
  const [billMonth, setBillMonth] = useState(getCurrentMonth());
  const [billing, setBilling] = useState(false);
  const [editingSubscriberId, setEditingSubscriberId] = useState<string | null>(null);
  const [editingSubscriberName, setEditingSubscriberName] = useState("");

  const [subForm, setSubForm] = useState({ subscriberId: "", serviceId: "", startDate: new Date().toISOString().slice(0, 10) });
  const [chargeForm, setChargeForm] = useState({ subscriberId: "", serviceId: "", date: new Date().toISOString().slice(0, 10), exchangeRate: 7.25, note: "" });
  const [billExchangeRate, setBillExchangeRate] = useState(7.25);
  const [liveRates, setLiveRates] = useState<Record<string, number> | null>(null);

  // Payment methods
  const [addPmOpen, setAddPmOpen] = useState(false);
  const [editingPm, setEditingPm] = useState<PaymentMethod | null>(null);
  const [pmForm, setPmForm] = useState({ label: "", cardholderName: "", cardNumber: "", expiryMonth: new Date().getMonth() + 1, expiryYear: new Date().getFullYear() + 1, isDefault: false });
  const [payChargeMethodOpen, setPayChargeMethodOpen] = useState<string | null>(null);
  const [subPayMethodOpen, setSubPayMethodOpen] = useState<string | null>(null);

  function requireEdit(): boolean {
    if (canEdit) return true;
    if (!session?.user) { toast.error("Sign in to make changes"); router.push("/auth/signin"); return false; }
    toast.error("You don't have permission to make changes");
    return false;
  }

  const reload = useCallback(async () => {
    try {
      const d = await fetchSubscriptionData();
      setData(d);
    } catch (err) {
      console.error("Failed to load data:", err);
      setData({ services: [], subscribers: [], subscriptions: [], charges: [], payment_methods: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  // Load data regardless of auth status
  useEffect(() => { reload(); }, [reload]);

  // Fetch live exchange rates
  useEffect(() => {
    fetch("/api/exchange-rate")
      .then((r) => r.json())
      .then((rates) => {
        if (rates && !rates.error) {
          setLiveRates(rates);
          if (rates.USD) {
            setBillExchangeRate(rates.USD);
            setChargeForm((f) => ({ ...f, exchangeRate: rates.USD }));
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "?") { e.preventDefault(); setKeyboardHelpOpen(true); }
      if (e.key === "n") { e.preventDefault(); setAddSubOpen(true); }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "1") setActiveTab("subscriptions");
      if (e.key === "2") setActiveTab("charges");
      if (e.key === "3") setActiveTab("people");
      if (e.key === "4") setActiveTab("payment-methods");
      if (e.key === "5") setActiveTab("charts");
      if (e.key === "6") setActiveTab("settings");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ─── Summary ──────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!data) return { totalPaid: 0, totalUnpaid: 0, activeSubs: 0, avgRates: {} as Record<string, number> };
    const totalPaid = data.charges.filter((c) => c.paid).reduce((s, c) => s + Number(c.total_cny), 0);
    const totalUnpaid = data.charges.filter((c) => !c.paid).reduce((s, c) => s + Number(c.total_cny), 0);
    const activeSubs = data.subscriptions.filter((s) => s.active).length;
    const rateByCurrency: Record<string, number[]> = {};
    for (const c of data.charges) {
      const cur = c.currency ?? "USD";
      if (!rateByCurrency[cur]) rateByCurrency[cur] = [];
      rateByCurrency[cur].push(Number(c.exchange_rate));
    }
    const avgRates: Record<string, number> = {};
    for (const [cur, rates] of Object.entries(rateByCurrency)) {
      avgRates[cur] = rates.reduce((a, b) => a + b, 0) / rates.length;
    }
    return { totalPaid, totalUnpaid, activeSubs, avgRates };
  }, [data]);

  // ─── Filtered charges ─────────────────────────────────────────────
  const filteredCharges = useMemo(() => {
    if (!data) return [];
    let charges = [...data.charges];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      charges = charges.filter((c) => {
        const sub = data.subscribers.find((s) => s.id === c.subscriber_id);
        const svc = data.services.find((s) => s.id === c.service_id);
        return (sub?.name ?? "").toLowerCase().includes(q) || (svc?.name ?? "").toLowerCase().includes(q) || c.period_start.includes(q) || (c.note ?? "").toLowerCase().includes(q);
      });
    }
    if (sortColumn) {
      charges.sort((a, b) => {
        let va: string | number = 0, vb: string | number = 0;
        switch (sortColumn) {
          case "subscriber": { va = data.subscribers.find((s) => s.id === a.subscriber_id)?.name ?? ""; vb = data.subscribers.find((s) => s.id === b.subscriber_id)?.name ?? ""; break; }
          case "service": { va = data.services.find((s) => s.id === a.service_id)?.name ?? ""; vb = data.services.find((s) => s.id === b.service_id)?.name ?? ""; break; }
          case "month": va = a.period_start; vb = b.period_start; break;
          case "date": va = a.created_at ?? ""; vb = b.created_at ?? ""; break;
          case "total": va = Number(a.total_cny); vb = Number(b.total_cny); break;
          case "paid": va = a.paid ? 1 : 0; vb = b.paid ? 1 : 0; break;
        }
        if (typeof va === "string") { const cmp = va.localeCompare(vb as string); return sortDir === "asc" ? cmp : -cmp; }
        return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
      });
    }
    return charges;
  }, [data, searchQuery, sortColumn, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredCharges.length / PAGE_SIZE));
  const paginatedCharges = filteredCharges.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => { setCurrentPage(1); }, [searchQuery, sortColumn, sortDir]);

  function handleSort(col: string) {
    if (sortColumn === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortColumn(col); setSortDir("asc"); }
  }

  // ─── Loading ─────────────────────────────────────────────────────
  if (loading) return <LoadingSkeleton />;
  if (!data) return <div className="flex justify-center py-20 text-muted-foreground">Failed to load data</div>;

  // ─── Subscription actions ─────────────────────────────────────────
  async function handleAddSubscription() {
    if (!requireEdit()) return;
    const { subscriberId, serviceId, startDate } = subForm;
    if (!subscriberId || !serviceId) { toast.error("Please select both a subscriber and a service"); return; }
    const exists = data!.subscriptions.find((s) => s.subscriber_id === subscriberId && s.service_id === serviceId);
    if (exists) { toast.error("This subscription already exists"); return; }
    try {
      await apiAddSubscription({ subscriber_id: subscriberId, service_id: serviceId, start_date: startDate, active: true });
      setSubForm({ subscriberId: "", serviceId: "", startDate: new Date().toISOString().slice(0, 10) });
      setAddSubOpen(false);
      toast.success("Subscription added");
      await reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      toast.error(`Failed: ${msg}`);
    }
  }

  async function handleToggleSubscription(sub: Subscription) {
    if (!requireEdit()) return;
    await apiUpdateSubscription(sub.id, { active: !sub.active });
    toast.success(sub.active ? "Paused" : "Activated");
    await reload();
  }

  async function handleSaveSubRate(id: string, rate: number) {
    if (!requireEdit()) return;
    await apiUpdateSubscription(id, { exchange_rate: rate });
    setEditingSubRate(null);
    toast.success("Rate updated");
    await reload();
  }

  async function handleDeleteSubscription(id: string) {
    if (!requireEdit()) return;
    await apiDeleteSubscription(id);
    toast.success("Removed");
    await reload();
  }

  // ─── Bill now ─────────────────────────────────────────────────────
  async function handleBillNow() {
    if (!requireEdit()) return;
    setBilling(true);
    try {
      const res = await fetch("/api/bill-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: billMonth, exchangeRate: billExchangeRate }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      const result = await res.json();
      toast.success(result.generated > 0 ? `Generated ${result.generated} charge(s) for ${billMonth}` : `No new charges for ${billMonth}`);
      await reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Bill failed: ${msg}`);
    } finally {
      setBilling(false);
    }
  }

  // ─── Subscriber actions ───────────────────────────────────────────
  async function handleAddSubscriber() {
    if (!requireEdit()) return;
    if (!newSubscriberName.trim()) return;
    await apiAddSubscriber(newSubscriberName.trim());
    setNewSubscriberName("");
    toast.success(`Added ${newSubscriberName.trim()}`);
    await reload();
  }
  async function handleRenameSubscriber(id: string) {
    if (!requireEdit()) return;
    const name = editingSubscriberName.trim();
    if (!name) { toast.error("Name cannot be empty"); return; }
    try {
      await apiUpdateSubscriber(id, { name });
      setEditingSubscriberId(null);
      toast.success("Renamed");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename");
    }
  }
  async function handleRemoveSubscriber(id: string) { if (!requireEdit()) return; await apiDeleteSubscriber(id); toast.success("Removed"); await reload(); }

  // ─── Service actions ──────────────────────────────────────────────
  async function handleSaveService() {
    if (!requireEdit()) return;
    if (!editingService) return;
    const exists = data!.services.find((s) => s.id === editingService.id);
    if (exists) {
      await apiUpdateService(editingService.id, { name: editingService.name, monthly_cost: editingService.monthly_cost, currency: editingService.currency });
      toast.success("Updated");
    } else {
      await apiAddService({ name: editingService.name, monthly_cost: editingService.monthly_cost, currency: editingService.currency });
      toast.success(`Added ${editingService.name}`);
    }
    setEditServiceOpen(false); setEditingService(null); await reload();
  }
  async function handleRemoveService(id: string) { if (!requireEdit()) return; await apiDeleteService(id); toast.success("Removed"); await reload(); }

  // ─── Charge actions ──────────────────────────────────────────────
  async function handleAddCharge() {
    if (!requireEdit()) return;
    const { subscriberId, serviceId, date, exchangeRate, note } = chargeForm;
    if (!subscriberId || !serviceId || !date) { toast.error("Fill in all required fields"); return; }
    const service = data!.services.find((s) => s.id === serviceId);
    if (!service) return;
    const month = date.slice(0, 7); // YYYY-MM
    const totalCny = Number((Number(service.monthly_cost) * exchangeRate).toFixed(2));
    try {
      await apiAddCharge({
        subscriber_id: subscriberId, service_id: serviceId,
        period_start: month, period_end: month,
        months: 1, monthly_cost: Number(service.monthly_cost),
        currency: service.currency, exchange_rate: exchangeRate,
        total_cny: totalCny, paid: false, note: note || "Manual",
      });
      setChargeForm({ subscriberId: "", serviceId: "", date: new Date().toISOString().slice(0, 10), exchangeRate: 7.25, note: "" });
      setAddChargeOpen(false);
      toast.success("Charge added");
      await reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      toast.error(`Failed: ${msg}`);
    }
  }

  async function handleTogglePaid(charge: ChargeRecord) {
    if (!requireEdit()) return;
    await apiUpdateCharge(charge.id, { paid: !charge.paid, paid_date: !charge.paid ? new Date().toISOString().slice(0, 10) : undefined });
    toast.success(charge.paid ? "Marked unpaid" : "Marked paid"); await reload();
  }
  async function handleRemoveCharge(id: string) { if (!requireEdit()) return; await apiDeleteCharge(id); toast.success("Removed"); await reload(); }
  async function handleBulkMarkPaid() {
    if (!requireEdit()) return;
    const unpaid = filteredCharges.filter((c) => !c.paid);
    if (unpaid.length === 0) { toast.info("No unpaid charges"); return; }
    await Promise.all(unpaid.map((c) => apiUpdateCharge(c.id, { paid: true, paid_date: new Date().toISOString().slice(0, 10) })));
    toast.success(`Marked ${unpaid.length} as paid`); await reload();
  }
  async function handleSaveChargeNote(chargeId: string) {
    if (!requireEdit()) return;
    await apiUpdateCharge(chargeId, { note: editingChargeNote || undefined });
    setEditingChargeId(null); toast.success("Note updated"); await reload();
  }

  // ─── Payment method actions ──────────────────────────────────────
  function resetPmForm() {
    setPmForm({ label: "", cardholderName: "", cardNumber: "", expiryMonth: new Date().getMonth() + 1, expiryYear: new Date().getFullYear() + 1, isDefault: false });
  }

  async function handleSavePaymentMethod() {
    if (!requireEdit()) return;
    const digits = pmForm.cardNumber.replace(/\D/g, "");
    if (digits.length < 4) { toast.error("Enter a valid card number"); return; }
    if (!pmForm.cardholderName.trim()) { toast.error("Enter cardholder name"); return; }
    const pm = {
      label: pmForm.label.trim() || `${CARD_TYPE_LABELS[detectCardType(digits)]} ****${digits.slice(-4)}`,
      cardholder_name: pmForm.cardholderName.trim(),
      card_type: detectCardType(digits),
      last4: digits.slice(-4),
      expiry_month: pmForm.expiryMonth,
      expiry_year: pmForm.expiryYear,
      is_default: pmForm.isDefault,
    };
    try {
      if (editingPm) {
        await apiUpdatePaymentMethod(editingPm.id, pm);
        toast.success("Payment method updated");
      } else {
        await apiAddPaymentMethod(pm);
        toast.success("Payment method added");
      }
      setAddPmOpen(false);
      setEditingPm(null);
      resetPmForm();
      await reload();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function handleDeletePaymentMethod(id: string) {
    if (!requireEdit()) return;
    await apiDeletePaymentMethod(id);
    toast.success("Payment method removed");
    await reload();
  }

  async function handleSetChargePaymentMethod(chargeId: string, pmId: string | undefined) {
    if (!requireEdit()) return;
    await apiUpdateCharge(chargeId, { payment_method_id: pmId || undefined });
    setPayChargeMethodOpen(null);
    toast.success("Payment method updated");
    await reload();
  }

  async function handleSetSubPaymentMethod(subId: string, pmId: string | undefined) {
    if (!requireEdit()) return;
    await apiUpdateSubscription(subId, { payment_method_id: pmId || undefined });
    setSubPayMethodOpen(null);
    toast.success("Payment method updated");
    await reload();
  }

  // ─── Per-subscriber helpers ───────────────────────────────────────
  function subscriberCharges(subscriberId: string) { return data!.charges.filter((c) => c.subscriber_id === subscriberId); }
  function subscriberUnpaid(subscriberId: string) { return subscriberCharges(subscriberId).filter((c) => !c.paid).reduce((s, c) => s + Number(c.total_cny), 0); }

  function SortHeader({ column, children }: { column: string; children: React.ReactNode }) {
    return (
      <th className="h-9 px-3 text-left text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSort(column)}>
        <span className="inline-flex items-center gap-1">{children}<ArrowUpDown className={`h-3 w-3 ${sortColumn === column ? "text-foreground" : "text-muted-foreground/30"}`} /></span>
      </th>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">Manage subscriptions. Bill monthly, track payments.</p>
        </div>
        <div className="flex gap-2 items-center">
          {!session?.user && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => router.push("/auth/signin")}>
              <Lock className="mr-1.5 h-3 w-3" /> Sign in to edit
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setKeyboardHelpOpen(true)}>
            <Keyboard className="h-3.5 w-3.5" />
          </Button>
          {canEdit && <Dialog open={addSubOpen} onOpenChange={setAddSubOpen}>
            <DialogTrigger render={<Button size="sm" className="h-8" />}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New subscription
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Subscription</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">Link a person to a service. Charges are generated when you bill.</p>
              <div className="grid gap-4 pt-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Subscriber</Label>
                  <select
                    value={subForm.subscriberId}
                    onChange={(e) => setSubForm({ ...subForm, subscriberId: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select person</option>
                    {data.subscribers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Service</Label>
                  <select
                    value={subForm.serviceId}
                    onChange={(e) => setSubForm({ ...subForm, serviceId: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select service</option>
                    {data.services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.monthly_cost} {s.currency}/mo)</option>)}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Start date</Label>
                  <Input type="date" className="h-9" value={subForm.startDate} onChange={(e) => setSubForm({ ...subForm, startDate: e.target.value })} />
                </div>
                <Button size="sm" onClick={handleAddSubscription}>Add subscription</Button>
              </div>
            </DialogContent>
          </Dialog>}
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Paid", value: `\u00a5${summary.totalPaid.toFixed(2)}`, icon: Check, color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Unpaid", value: `\u00a5${summary.totalUnpaid.toFixed(2)}`, icon: Clock, color: "text-amber-600 dark:text-amber-400" },
          { label: "Active subscriptions", value: String(summary.activeSubs), icon: Receipt, color: "text-foreground" },
          { label: liveRates ? "Live rate" : "Avg rate", value: liveRates ? Object.entries(liveRates).map(([cur, rate]) => `${cur} ${rate}`).join(" / ") : Object.keys(summary.avgRates).length > 0 ? Object.entries(summary.avgRates).map(([cur, rate]) => `${cur} ${rate.toFixed(2)}`).join(" / ") : "\u2014", icon: TrendingUp, color: "text-foreground" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><stat.icon className="h-3.5 w-3.5" />{stat.label}</div>
            <div className={`text-xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </motion.div>

      {/* Tabs */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
            <Tab active={activeTab === "subscriptions"} onClick={() => setActiveTab("subscriptions")}>Subscriptions</Tab>
            <Tab active={activeTab === "charges"} onClick={() => setActiveTab("charges")}>Charges</Tab>
            <Tab active={activeTab === "people"} onClick={() => setActiveTab("people")}>People</Tab>
            <Tab active={activeTab === "payment-methods"} onClick={() => setActiveTab("payment-methods")}>Cards</Tab>
            <Tab active={activeTab === "charts"} onClick={() => setActiveTab("charts")}>Charts</Tab>
            <Tab active={activeTab === "settings"} onClick={() => setActiveTab("settings")}>Settings</Tab>
          </div>
          {activeTab === "charges" && (
            <div className="flex gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input ref={searchRef} placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 w-44 pl-8 text-sm" />
              </div>
              {canEdit && (
                <>
                  <Dialog open={addChargeOpen} onOpenChange={setAddChargeOpen}>
                    <DialogTrigger render={<Button size="sm" className="h-8" />}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add charge
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Add Manual Charge</DialogTitle></DialogHeader>
                      <div className="grid gap-4 pt-2">
                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">Subscriber</Label>
                          <select value={chargeForm.subscriberId} onChange={(e) => setChargeForm({ ...chargeForm, subscriberId: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                            <option value="">Select person</option>
                            {data.subscribers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">Service</Label>
                          <select value={chargeForm.serviceId} onChange={(e) => {
                            const svc = data.services.find((s) => s.id === e.target.value);
                            const rate = svc && liveRates?.[svc.currency] ? liveRates[svc.currency] : chargeForm.exchangeRate;
                            setChargeForm({ ...chargeForm, serviceId: e.target.value, exchangeRate: rate });
                          }} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                            <option value="">Select service</option>
                            {data.services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.monthly_cost} {s.currency}/mo)</option>)}
                          </select>
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">Date</Label>
                          <Input type="date" className="h-9" value={chargeForm.date} onChange={(e) => setChargeForm({ ...chargeForm, date: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-1.5">
                            <Label className="text-xs text-muted-foreground">Exchange rate (to CNY) {liveRates && <span className="text-emerald-600 dark:text-emerald-400">Live</span>}</Label>
                            <Input type="number" step="0.01" className="h-9" value={chargeForm.exchangeRate} onChange={(e) => setChargeForm({ ...chargeForm, exchangeRate: Number(e.target.value) })} />
                          </div>
                          <div className="grid gap-1.5">
                            <Label className="text-xs text-muted-foreground">Note</Label>
                            <Input className="h-9" value={chargeForm.note} onChange={(e) => setChargeForm({ ...chargeForm, note: e.target.value })} placeholder="Optional" />
                          </div>
                        </div>
                        {chargeForm.subscriberId && chargeForm.serviceId && (() => {
                          const service = data.services.find((s) => s.id === chargeForm.serviceId);
                          if (!service) return null;
                          const total = Number(service.monthly_cost) * chargeForm.exchangeRate;
                          return (
                            <div className="rounded-md border bg-muted/50 px-3 py-2.5 text-sm">
                              <span className="text-muted-foreground">{service.monthly_cost} {service.currency} x {chargeForm.exchangeRate} = </span>
                              <span className="font-semibold tabular-nums">{"\u00a5"}{total.toFixed(2)}</span>
                            </div>
                          );
                        })()}
                        <Button size="sm" onClick={handleAddCharge}>Add charge</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button variant="outline" size="sm" className="h-8" onClick={handleBulkMarkPaid}><CheckCheck className="mr-1 h-3.5 w-3.5" /> Bulk pay</Button>
                </>
              )}
              <Button variant="outline" size="sm" className="h-8" onClick={() => exportToCSV(data.charges, data.services, data.subscribers)}><Download className="mr-1 h-3.5 w-3.5" /> CSV</Button>
            </div>
          )}
        </div>

        {/* ═══ Subscriptions tab ═══════════════════════════════════════ */}
        {activeTab === "subscriptions" && (
          <div className="space-y-4">
            {/* Bill now */}
            {canEdit && (
              <div className="flex items-center gap-2 rounded-lg border bg-card p-3 flex-wrap">
                <Zap className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Generate charges for</span>
                <MonthPicker value={billMonth} onChange={setBillMonth} />
                <span className="text-sm text-muted-foreground">at rate</span>
                <Input type="number" step="0.01" className="h-8 w-20 text-sm" value={billExchangeRate} onChange={(e) => setBillExchangeRate(Number(e.target.value))} />
                {liveRates && (
                  <span className="text-xs text-muted-foreground">
                    Live: {Object.entries(liveRates).map(([c, r]) => `${c} ${r}`).join(" / ")}
                  </span>
                )}
                <Button size="sm" className="h-8" onClick={handleBillNow} disabled={billing}>
                  {billing ? "Billing..." : "Bill now"}
                </Button>
              </div>
            )}

            {/* Subscriptions list */}
            <div className="rounded-lg border bg-card">
              {data.subscriptions.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-center">
                  <p className="text-sm text-muted-foreground">No subscriptions yet. Add one above to get started.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {data.subscriptions.map((sub) => {
                    const subscriber = data.subscribers.find((s) => s.id === sub.subscriber_id);
                    const service = data.services.find((s) => s.id === sub.service_id);
                    return (
                      <div key={sub.id} className={`flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/30 ${!sub.active ? "opacity-50" : ""}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar name={subscriber?.name ?? "?"} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-medium">{subscriber?.name ?? "?"}</span>
                              <span className="text-muted-foreground">{"\u2192"}</span>
                              <span>{service?.name ?? "?"}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                              <span>{service?.monthly_cost} {service?.currency}/mo {"\u00b7"} since {sub.start_date ?? sub.created_at?.slice(0, 10) ?? "—"}</span>
                              {"\u00b7"}
                              {canEdit && subPayMethodOpen === sub.id ? (
                                <select
                                  value={sub.payment_method_id ?? ""}
                                  onChange={(e) => handleSetSubPaymentMethod(sub.id, e.target.value || undefined)}
                                  className="h-6 rounded border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                  autoFocus
                                  onBlur={() => setSubPayMethodOpen(null)}
                                >
                                  <option value="">No card</option>
                                  {(data.payment_methods ?? []).map((pm) => (
                                    <option key={pm.id} value={pm.id}>{pm.label || `${CARD_TYPE_LABELS[pm.card_type]} ****${pm.last4}`}</option>
                                  ))}
                                </select>
                              ) : (
                                <button onClick={() => canEdit && setSubPayMethodOpen(sub.id)} className={`${canEdit ? "hover:bg-muted/50 rounded px-1 py-0.5 transition-colors cursor-pointer" : ""}`}>
                                  <PaymentMethodBadge pm={(data.payment_methods ?? []).find((p) => p.id === sub.payment_method_id)} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        {canEdit && (
                          <div className="flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger render={<button onClick={() => handleToggleSubscription(sub)} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors" />}>
                                {sub.active ? <Pause className="h-3 w-3 text-muted-foreground" /> : <Play className="h-3 w-3 text-muted-foreground" />}
                              </TooltipTrigger>
                              <TooltipContent>{sub.active ? "Pause" : "Activate"}</TooltipContent>
                            </Tooltip>
                            <button onClick={() => setConfirmDelete({ type: "subscription", id: sub.id, name: `${subscriber?.name} - ${service?.name}` })} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors">
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ Charges tab ═════════════════════════════════════════════ */}
        {activeTab === "charges" && (
          <div className="rounded-lg border bg-card">
            {filteredCharges.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <p className="text-sm text-muted-foreground">{searchQuery ? "No matching charges." : "No charges yet. Use \"Bill now\" to generate."}</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b">
                      <tr>
                        <SortHeader column="subscriber">Person</SortHeader>
                        <SortHeader column="service">Service</SortHeader>
                        <SortHeader column="month">Month</SortHeader>
                        <SortHeader column="date">Bill Date</SortHeader>
                        <th className="h-9 px-3 text-left text-xs font-medium text-muted-foreground">Price</th>
                        <th className="h-9 px-3 text-left text-xs font-medium text-muted-foreground">Rate</th>
                        <SortHeader column="total">Total</SortHeader>
                        <SortHeader column="paid">Status</SortHeader>
                        <th className="h-9 px-3 text-left text-xs font-medium text-muted-foreground">Card</th>
                        {canEdit && <th className="h-9 px-3 w-16"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      <AnimatePresence>
                        {paginatedCharges.map((charge) => {
                          const subscriber = data.subscribers.find((s) => s.id === charge.subscriber_id);
                          const service = data.services.find((s) => s.id === charge.service_id);
                          return (
                            <motion.tr key={charge.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                              <td className="px-3 py-2.5"><div className="flex items-center gap-2"><Avatar name={subscriber?.name ?? "?"} /><span className="font-medium text-sm">{subscriber?.name ?? "?"}</span></div></td>
                              <td className="px-3 py-2.5 text-sm">{service?.name ?? "?"}</td>
                              <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{charge.period_start}</td>
                              <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{charge.created_at?.slice(0, 10) ?? "—"}</td>
                              <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{charge.monthly_cost} {charge.currency}</td>
                              <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{charge.exchange_rate}</td>
                              <td className="px-3 py-2.5 font-medium tabular-nums">{"\u00a5"}{Number(charge.total_cny).toFixed(2)}</td>
                              <td className="px-3 py-2.5">
                                {canEdit ? (
                                  <button onClick={() => handleTogglePaid(charge)} className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${charge.paid ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20" : "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"}`}>
                                    {charge.paid ? "Paid" : "Unpaid"}
                                  </button>
                                ) : (
                                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${charge.paid ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                                    {charge.paid ? "Paid" : "Unpaid"}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                {canEdit ? (
                                  payChargeMethodOpen === charge.id ? (
                                    <div className="flex items-center gap-1">
                                      <select
                                        value={charge.payment_method_id ?? ""}
                                        onChange={(e) => handleSetChargePaymentMethod(charge.id, e.target.value || undefined)}
                                        className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        autoFocus
                                        onBlur={() => setPayChargeMethodOpen(null)}
                                      >
                                        <option value="">None</option>
                                        {(data.payment_methods ?? []).map((pm) => (
                                          <option key={pm.id} value={pm.id}>{pm.label || `${CARD_TYPE_LABELS[pm.card_type]} ****${pm.last4}`}</option>
                                        ))}
                                      </select>
                                    </div>
                                  ) : (
                                    <button onClick={() => setPayChargeMethodOpen(charge.id)} className="hover:bg-muted/50 rounded px-1 py-0.5 transition-colors">
                                      <PaymentMethodBadge pm={(data.payment_methods ?? []).find((p) => p.id === charge.payment_method_id)} />
                                    </button>
                                  )
                                ) : (
                                  <PaymentMethodBadge pm={(data.payment_methods ?? []).find((p) => p.id === charge.payment_method_id)} />
                                )}
                              </td>
                              {canEdit && (
                                <td className="px-3 py-2.5">
                                  <div className="flex gap-0.5">
                                    {editingChargeId === charge.id ? (
                                      <div className="flex gap-1">
                                        <Input className="h-7 w-24 text-xs" value={editingChargeNote} onChange={(e) => setEditingChargeNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSaveChargeNote(charge.id); if (e.key === "Escape") setEditingChargeId(null); }} autoFocus />
                                        <button onClick={() => handleSaveChargeNote(charge.id)} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"><Check className="h-3 w-3" /></button>
                                      </div>
                                    ) : (
                                      <>
                                        <button onClick={() => { setEditingChargeId(charge.id); setEditingChargeNote(charge.note ?? ""); }} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"><Edit2 className="h-3 w-3 text-muted-foreground" /></button>
                                        <button onClick={() => setConfirmDelete({ type: "charge", id: charge.id, name: `${subscriber?.name} - ${service?.name}` })} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"><Trash2 className="h-3 w-3 text-muted-foreground" /></button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              )}
                            </motion.tr>
                          );
                        })}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
                    <span>{(currentPage - 1) * PAGE_SIZE + 1}{"\u2013"}{Math.min(currentPage * PAGE_SIZE, filteredCharges.length)} of {filteredCharges.length}</span>
                    <div className="flex gap-1">
                      <button className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted disabled:opacity-30 transition-colors" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}><ChevronLeft className="h-3.5 w-3.5" /></button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <button key={page} onClick={() => setCurrentPage(page)} className={`h-7 w-7 flex items-center justify-center rounded-md text-xs transition-colors ${currentPage === page ? "bg-foreground text-background font-medium" : "hover:bg-muted"}`}>{page}</button>
                      ))}
                      <button className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted disabled:opacity-30 transition-colors" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}><ChevronRight className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ People tab ══════════════════════════════════════════════ */}
        {activeTab === "people" && (
          <div className="space-y-3">
            {data.subscribers.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center"><p className="text-sm text-muted-foreground">No subscribers yet.</p></div>
            ) : (
              data.subscribers.map((subscriber) => {
                const charges = subscriberCharges(subscriber.id);
                const subs = data.subscriptions.filter((s) => s.subscriber_id === subscriber.id && s.active);
                const unpaid = subscriberUnpaid(subscriber.id);
                const paid = charges.filter((c) => c.paid).reduce((s, c) => s + Number(c.total_cny), 0);
                return (
                  <div key={subscriber.id} className="rounded-lg border bg-card">
                    <div className="flex items-center justify-between px-4 py-3 border-b">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={subscriber.name} size="md" />
                        <div>
                          <span className="font-medium text-sm">{subscriber.name}</span>
                          {subs.length > 0 && (
                            <div className="flex gap-1 mt-0.5">
                              {subs.map((s) => {
                                const svc = data.services.find((sv) => sv.id === s.service_id);
                                return <span key={s.id} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{svc?.name}</span>;
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-3 text-xs tabular-nums">
                        {unpaid > 0 && <span className="text-amber-600 dark:text-amber-400">{"\u00a5"}{unpaid.toFixed(2)} unpaid</span>}
                        {paid > 0 && <span className="text-emerald-600 dark:text-emerald-400">{"\u00a5"}{paid.toFixed(2)} paid</span>}
                      </div>
                    </div>
                    {charges.length > 0 && (
                      <div className="divide-y">
                        {charges.map((charge) => {
                          const service = data.services.find((s) => s.id === charge.service_id);
                          return (
                            <div key={charge.id} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors">
                              <div className="flex items-center gap-2">
                                <span>{service?.name}</span>
                                <span className="text-xs text-muted-foreground">{charge.period_start}</span>
                                {charge.note && <span className="text-xs text-muted-foreground">{"\u00b7"} {charge.note}</span>}
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="font-medium tabular-nums">{"\u00a5"}{Number(charge.total_cny).toFixed(2)}</span>
                                {canEdit ? (
                                  <button onClick={() => handleTogglePaid(charge)} className={`text-xs font-medium px-2 py-0.5 rounded-md transition-colors ${charge.paid ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20" : "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"}`}>
                                    {charge.paid ? "Paid" : "Unpaid"}
                                  </button>
                                ) : (
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${charge.paid ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                                    {charge.paid ? "Paid" : "Unpaid"}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ═══ Payment Methods tab ═════════════════════════════════════ */}
        {activeTab === "payment-methods" && (
          <div className="space-y-4">
            {canEdit && (
              <div className="flex justify-end">
                <Button size="sm" className="h-8" onClick={() => { resetPmForm(); setEditingPm(null); setAddPmOpen(true); }}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add card
                </Button>
              </div>
            )}
            {(data.payment_methods ?? []).length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <CreditCard className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No payment methods yet.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(data.payment_methods ?? []).map((pm) => (
                  <motion.div key={pm.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border bg-card p-4 space-y-3 relative">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <CardIcon type={pm.card_type} className="h-5 w-5" />
                        <div>
                          <div className="text-sm font-medium tabular-nums">**** **** **** {pm.last4}</div>
                          <div className="text-xs text-muted-foreground">{CARD_TYPE_LABELS[pm.card_type] ?? "Card"}</div>
                        </div>
                      </div>
                      {pm.is_default && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          <Star className="h-2.5 w-2.5" /> Default
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Cardholder</span><span className="font-medium text-foreground">{pm.cardholder_name}</span></div>
                      {pm.label && <div className="flex justify-between"><span>Label</span><span className="font-medium text-foreground">{pm.label}</span></div>}
                      <div className="flex justify-between"><span>Expires</span><span className="font-medium text-foreground tabular-nums">{String(pm.expiry_month).padStart(2, "0")}/{pm.expiry_year}</span></div>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1 pt-1 border-t">
                        <button
                          onClick={() => {
                            setEditingPm(pm);
                            setPmForm({
                              label: pm.label,
                              cardholderName: pm.cardholder_name,
                              cardNumber: `**** **** **** ${pm.last4}`,
                              expiryMonth: pm.expiry_month,
                              expiryYear: pm.expiry_year,
                              isDefault: pm.is_default,
                            });
                            setAddPmOpen(true);
                          }}
                          className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                        >
                          <Edit2 className="h-3 w-3 text-muted-foreground" />
                        </button>
                        {!pm.is_default && (
                          <Tooltip>
                            <TooltipTrigger render={
                              <button
                                onClick={async () => { if (!requireEdit()) return; await apiUpdatePaymentMethod(pm.id, { is_default: true }); toast.success("Set as default"); await reload(); }}
                                className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                              />
                            }>
                              <Star className="h-3 w-3 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>Set as default</TooltipContent>
                          </Tooltip>
                        )}
                        <button
                          onClick={() => setConfirmDelete({ type: "payment_method", id: pm.id, name: `${CARD_TYPE_LABELS[pm.card_type]} ****${pm.last4}` })}
                          className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ Charts tab ══════════════════════════════════════════════ */}
        {activeTab === "charts" && (
          data.charges.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center"><p className="text-sm text-muted-foreground">Add charges to see charts.</p></div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs font-medium text-muted-foreground mb-3">Spending by service</p>
                <SpendingPieChart charges={data.charges} services={data.services} />
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs font-medium text-muted-foreground mb-3">Paid vs unpaid by person</p>
                <PersonBarChart charges={data.charges} subscribers={data.subscribers} />
              </div>
            </div>
          )
        )}

        {/* ═══ Settings tab ════════════════════════════════════════════ */}
        {activeTab === "settings" && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subscribers</p>
              <div className="flex flex-wrap gap-1.5">
                {data.subscribers.map((s) => (
                  <div key={s.id} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm">
                    <Avatar name={s.name} />
                    {editingSubscriberId === s.id ? (
                      <div className="flex items-center gap-1">
                        <Input className="h-6 w-24 text-xs" value={editingSubscriberName} onChange={(e) => setEditingSubscriberName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleRenameSubscriber(s.id); if (e.key === "Escape") setEditingSubscriberId(null); }} autoFocus />
                        <button onClick={() => handleRenameSubscriber(s.id)} className="rounded p-0.5 hover:bg-muted transition-colors"><Check className="h-3 w-3" /></button>
                        <button onClick={() => setEditingSubscriberId(null)} className="rounded p-0.5 hover:bg-muted transition-colors"><X className="h-3 w-3 text-muted-foreground" /></button>
                      </div>
                    ) : (
                      <>
                        {s.name}
                        {canEdit && <button onClick={() => { setEditingSubscriberId(s.id); setEditingSubscriberName(s.name); }} className="ml-0.5 rounded p-0.5 hover:bg-muted transition-colors"><Edit2 className="h-3 w-3 text-muted-foreground" /></button>}
                        {canEdit && <button onClick={() => setConfirmDelete({ type: "subscriber", id: s.id, name: s.name })} className="ml-0.5 rounded p-0.5 hover:bg-muted transition-colors"><X className="h-3 w-3 text-muted-foreground" /></button>}
                      </>
                    )}
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <Input placeholder="Name" value={newSubscriberName} onChange={(e) => setNewSubscriberName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddSubscriber()} className="h-8 max-w-xs text-sm" />
                  <Button size="sm" className="h-8" onClick={handleAddSubscriber}><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button>
                </div>
              )}
            </div>

            <div className="rounded-lg border bg-card p-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Services</p>
              <div className="divide-y -mx-4">
                {data.services.map((service) => (
                  <div key={service.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors">
                    <div>
                      <span className="text-sm font-medium">{service.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">{service.monthly_cost} {service.currency}/mo</span>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingService({ ...service }); setEditServiceOpen(true); }} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"><Edit2 className="h-3 w-3 text-muted-foreground" /></button>
                        <button onClick={() => setConfirmDelete({ type: "service", id: service.id, name: service.name })} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"><Trash2 className="h-3 w-3 text-muted-foreground" /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {data.services.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No services yet.</p>}
              {canEdit && (
                <Button variant="outline" size="sm" className="h-8" onClick={() => { setEditingService({ id: "", name: "", monthly_cost: 0, currency: "USD" }); setEditServiceOpen(true); }}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add service
                </Button>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {/* Edit service dialog */}
      <Dialog open={editServiceOpen} onOpenChange={(open) => { setEditServiceOpen(open); if (!open) setEditingService(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingService?.id ? "Edit Service" : "New Service"}</DialogTitle></DialogHeader>
          {editingService && (
            <div className="grid gap-4 pt-2">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input className="h-9" value={editingService.name} onChange={(e) => setEditingService({ ...editingService, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Monthly cost</Label>
                  <Input type="number" step="0.01" className="h-9" value={editingService.monthly_cost} onChange={(e) => setEditingService({ ...editingService, monthly_cost: Number(e.target.value) })} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Currency</Label>
                  <select
                    value={editingService.currency}
                    onChange={(e) => setEditingService({ ...editingService, currency: e.target.value as Currency })}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="USD">USD</option>
                    <option value="SGD">SGD</option>
                  </select>
                </div>
              </div>
              <Button size="sm" onClick={handleSaveService}>Save</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add/Edit payment method dialog */}
      <Dialog open={addPmOpen} onOpenChange={(open) => { setAddPmOpen(open); if (!open) { setEditingPm(null); resetPmForm(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingPm ? "Edit Payment Method" : "Add Payment Method"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Card number</Label>
              <div className="relative">
                <Input
                  className="h-9 pr-10 tabular-nums"
                  placeholder="4242 4242 4242 4242"
                  value={pmForm.cardNumber}
                  onChange={(e) => {
                    const formatted = formatCardInput(e.target.value);
                    setPmForm({ ...pmForm, cardNumber: formatted });
                  }}
                  maxLength={19}
                />
                <div className="absolute right-3 top-2.5">
                  <CardIcon type={detectCardType(pmForm.cardNumber)} className="h-4 w-4" />
                </div>
              </div>
              {pmForm.cardNumber.replace(/\D/g, "").length >= 2 && (
                <span className="text-[10px] text-muted-foreground">Detected: {CARD_TYPE_LABELS[detectCardType(pmForm.cardNumber)]}</span>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Cardholder name</Label>
              <Input className="h-9" placeholder="John Doe" value={pmForm.cardholderName} onChange={(e) => setPmForm({ ...pmForm, cardholderName: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Label / nickname (optional)</Label>
              <Input className="h-9" placeholder="e.g. Personal Visa" value={pmForm.label} onChange={(e) => setPmForm({ ...pmForm, label: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Expiry month</Label>
                <select
                  value={pmForm.expiryMonth}
                  onChange={(e) => setPmForm({ ...pmForm, expiryMonth: Number(e.target.value) })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Expiry year</Label>
                <select
                  value={pmForm.expiryYear}
                  onChange={(e) => setPmForm({ ...pmForm, expiryYear: Number(e.target.value) })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {Array.from({ length: 12 }, (_, i) => new Date().getFullYear() + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={pmForm.isDefault} onChange={(e) => setPmForm({ ...pmForm, isDefault: e.target.checked })} className="h-4 w-4 rounded border-input" />
              <span className="text-sm">Set as default payment method</span>
            </label>
            <Button size="sm" onClick={handleSavePaymentMethod}>{editingPm ? "Save changes" : "Add card"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}
        title="Delete"
        description={`Delete "${confirmDelete?.name}"? This cannot be undone.`}
        onConfirm={() => {
          if (!confirmDelete) return;
          if (confirmDelete.type === "charge") handleRemoveCharge(confirmDelete.id);
          if (confirmDelete.type === "subscriber") handleRemoveSubscriber(confirmDelete.id);
          if (confirmDelete.type === "service") handleRemoveService(confirmDelete.id);
          if (confirmDelete.type === "subscription") handleDeleteSubscription(confirmDelete.id);
          if (confirmDelete.type === "payment_method") handleDeletePaymentMethod(confirmDelete.id);
        }}
      />

      <KeyboardHelp open={keyboardHelpOpen} onOpenChange={setKeyboardHelpOpen} />
    </div>
  );
}
