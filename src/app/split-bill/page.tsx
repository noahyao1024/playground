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
  deleteSubscriber as apiDeleteSubscriber,
  addCharge as apiAddCharge,
  updateCharge as apiUpdateCharge,
  deleteCharge as apiDeleteCharge,
  calcMonths,
  calcTotalCNY,
  type SubscriptionData,
  type Service,
  type ChargeRecord,
  type Currency,
} from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plus, Trash2, Edit2, Check, X, Users, DollarSign, Settings, FileText,
  Search, Download, CheckCheck, TrendingUp, CreditCard, Clock,
  ArrowUpDown, ChevronLeft, ChevronRight, BarChart3, Keyboard,
} from "lucide-react";
import { SpendingPieChart } from "@/components/charts/spending-pie-chart";
import { PersonBarChart } from "@/components/charts/person-bar-chart";

// ─── Constants ────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

const AVATAR_COLORS = [
  "from-purple-500 to-pink-500",
  "from-blue-500 to-cyan-500",
  "from-green-500 to-emerald-500",
  "from-orange-500 to-amber-500",
  "from-rose-500 to-red-500",
  "from-indigo-500 to-violet-500",
  "from-teal-500 to-green-500",
  "from-fuchsia-500 to-purple-500",
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Animated container ───────────────────────────────────────────────
const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4 },
};

// ─── Skeleton ─────────────────────────────────────────────────────────
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted/50 ${className}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-96" />
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────
function SubscriberAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const sizeClasses = size === "md" ? "h-10 w-10 text-sm" : "h-7 w-7 text-xs";
  return (
    <div
      className={`flex ${sizeClasses} items-center justify-center rounded-full bg-gradient-to-br ${getAvatarColor(name)} font-bold text-white shadow-lg`}
    >
      {name[0]?.toUpperCase()}
    </div>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant="destructive"
            onClick={() => { onConfirm(); onOpenChange(false); }}
          >
            确认删除
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Keyboard shortcuts help ──────────────────────────────────────────
function KeyboardHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          {[
            ["?", "Show this help"],
            ["n", "New charge"],
            ["/", "Focus search"],
            ["1-4", "Switch tabs"],
          ].map(([key, desc]) => (
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

// ─── CSV Export ────────────────────────────────────────────────────────
function exportToCSV(charges: ChargeRecord[], services: Service[], subscribers: { id: string; name: string }[]) {
  const headers = ["Subscriber", "Service", "Period Start", "Period End", "Months", "Monthly Cost", "Currency", "Exchange Rate", "Total CNY", "Paid", "Paid Date", "Note"];
  const rows = charges.map((c) => {
    const sub = subscribers.find((s) => s.id === c.subscriber_id);
    const svc = services.find((s) => s.id === c.service_id);
    return [
      sub?.name ?? "", svc?.name ?? "", c.period_start, c.period_end,
      c.months, c.monthly_cost, c.currency, c.exchange_rate,
      Number(c.total_cny).toFixed(2), c.paid ? "Yes" : "No",
      c.paid_date ?? "", c.note ?? "",
    ];
  });
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("CSV exported successfully");
}

// ═══════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════

export default function SubscriptionPage() {
  const { status } = useSession();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("charges");
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [editServiceOpen, setEditServiceOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [newSubscriberName, setNewSubscriberName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [showCharts, setShowCharts] = useState(false);
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ type: string; id: string; name: string } | null>(null);
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null);
  const [editingChargeNote, setEditingChargeNote] = useState("");

  const [chargeForm, setChargeForm] = useState({
    subscriberId: "",
    serviceId: "",
    periodStart: "",
    periodEnd: "",
    exchangeRate: 7.25,
    note: "",
  });

  // ─── Auth gate ──────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [status, router]);

  // ─── Data fetch ─────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    const d = await fetchSubscriptionData();
    setData(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (status === "authenticated") reload();
  }, [reload, status]);

  // ─── Keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "?") { e.preventDefault(); setKeyboardHelpOpen(true); }
      if (e.key === "n") { e.preventDefault(); setAddChargeOpen(true); }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "1") setActiveTab("charges");
      if (e.key === "2") setActiveTab("people");
      if (e.key === "3") setActiveTab("charts");
      if (e.key === "4") setActiveTab("settings");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ─── Summary ────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!data) return { totalOwed: 0, totalPaid: 0, totalUnpaid: 0, activeSubscribers: 0, avgRate: 0 };
    const totalPaid = data.charges.filter((c) => c.paid).reduce((s, c) => s + Number(c.total_cny), 0);
    const totalUnpaid = data.charges.filter((c) => !c.paid).reduce((s, c) => s + Number(c.total_cny), 0);
    const activeSubscribers = data.subscribers.length;
    const rates = data.charges.map((c) => Number(c.exchange_rate));
    const avgRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    return { totalOwed: totalPaid + totalUnpaid, totalPaid, totalUnpaid, activeSubscribers, avgRate };
  }, [data]);

  // ─── Filtered and sorted charges ────────────────────────────────────
  const filteredCharges = useMemo(() => {
    if (!data) return [];
    let charges = [...data.charges];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      charges = charges.filter((c) => {
        const sub = data.subscribers.find((s) => s.id === c.subscriber_id);
        const svc = data.services.find((s) => s.id === c.service_id);
        return (
          (sub?.name ?? "").toLowerCase().includes(q) ||
          (svc?.name ?? "").toLowerCase().includes(q) ||
          c.period_start.includes(q) ||
          c.period_end.includes(q) ||
          (c.note ?? "").toLowerCase().includes(q)
        );
      });
    }

    if (sortColumn) {
      charges.sort((a, b) => {
        let va: string | number = 0, vb: string | number = 0;
        switch (sortColumn) {
          case "subscriber": {
            const sa = data.subscribers.find((s) => s.id === a.subscriber_id);
            const sb = data.subscribers.find((s) => s.id === b.subscriber_id);
            va = sa?.name ?? ""; vb = sb?.name ?? "";
            break;
          }
          case "service": {
            const sa = data.services.find((s) => s.id === a.service_id);
            const sb = data.services.find((s) => s.id === b.service_id);
            va = sa?.name ?? ""; vb = sb?.name ?? "";
            break;
          }
          case "months": va = a.months; vb = b.months; break;
          case "total": va = Number(a.total_cny); vb = Number(b.total_cny); break;
          case "period": va = a.period_start; vb = b.period_start; break;
          case "paid": va = a.paid ? 1 : 0; vb = b.paid ? 1 : 0; break;
        }
        if (typeof va === "string") {
          const cmp = va.localeCompare(vb as string);
          return sortDir === "asc" ? cmp : -cmp;
        }
        return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
      });
    }

    return charges;
  }, [data, searchQuery, sortColumn, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredCharges.length / PAGE_SIZE));
  const paginatedCharges = filteredCharges.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // reset page when filter changes
  useEffect(() => { setCurrentPage(1); }, [searchQuery, sortColumn, sortDir]);

  // ─── Sort handler ───────────────────────────────────────────────────
  function handleSort(col: string) {
    if (sortColumn === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(col);
      setSortDir("asc");
    }
  }

  // ─── Loading / auth states ──────────────────────────────────────────
  if (status === "loading" || (status === "authenticated" && loading)) return <LoadingSkeleton />;
  if (status === "unauthenticated") return null;
  if (!data) return <div className="flex justify-center py-20 text-muted-foreground">Failed to load data</div>;

  // ─── Subscriber actions ─────────────────────────────────────────────
  async function handleAddSubscriber() {
    if (!newSubscriberName.trim()) return;
    await apiAddSubscriber(newSubscriberName.trim());
    setNewSubscriberName("");
    toast.success(`Added subscriber: ${newSubscriberName.trim()}`);
    await reload();
  }

  async function handleRemoveSubscriber(id: string) {
    await apiDeleteSubscriber(id);
    toast.success("Subscriber removed");
    await reload();
  }

  // ─── Service actions ────────────────────────────────────────────────
  async function handleSaveService() {
    if (!editingService) return;
    const exists = data!.services.find((s) => s.id === editingService.id);
    if (exists) {
      await apiUpdateService(editingService.id, {
        name: editingService.name,
        monthly_cost: editingService.monthly_cost,
        currency: editingService.currency,
      });
      toast.success("Service updated");
    } else {
      await apiAddService({
        name: editingService.name,
        monthly_cost: editingService.monthly_cost,
        currency: editingService.currency,
      });
      toast.success(`Added service: ${editingService.name}`);
    }
    setEditServiceOpen(false);
    setEditingService(null);
    await reload();
  }

  async function handleRemoveService(id: string) {
    await apiDeleteService(id);
    toast.success("Service removed");
    await reload();
  }

  // ─── Charge actions ─────────────────────────────────────────────────
  async function handleAddCharge() {
    const { subscriberId, serviceId, periodStart, periodEnd, exchangeRate, note } = chargeForm;
    if (!subscriberId || !serviceId || !periodStart || !periodEnd) return;
    const service = data!.services.find((s) => s.id === serviceId)!;
    const months = calcMonths(periodStart, periodEnd);
    if (months <= 0) return;
    const totalCNY = calcTotalCNY(months, Number(service.monthly_cost), exchangeRate);
    await apiAddCharge({
      subscriber_id: subscriberId,
      service_id: serviceId,
      period_start: periodStart,
      period_end: periodEnd,
      months,
      monthly_cost: Number(service.monthly_cost),
      currency: service.currency,
      exchange_rate: exchangeRate,
      total_cny: totalCNY,
      paid: false,
      note: note || undefined,
    });
    setChargeForm({ subscriberId: "", serviceId: "", periodStart: "", periodEnd: "", exchangeRate: 7.25, note: "" });
    setAddChargeOpen(false);
    toast.success("Charge added");
    await reload();
  }

  async function handleTogglePaid(charge: ChargeRecord) {
    await apiUpdateCharge(charge.id, {
      paid: !charge.paid,
      paid_date: !charge.paid ? new Date().toISOString().slice(0, 10) : undefined,
    });
    toast.success(charge.paid ? "Marked as unpaid" : "Marked as paid");
    await reload();
  }

  async function handleRemoveCharge(id: string) {
    await apiDeleteCharge(id);
    toast.success("Charge removed");
    await reload();
  }

  async function handleBulkMarkPaid() {
    const unpaid = filteredCharges.filter((c) => !c.paid);
    if (unpaid.length === 0) { toast.info("No unpaid charges"); return; }
    await Promise.all(
      unpaid.map((c) =>
        apiUpdateCharge(c.id, { paid: true, paid_date: new Date().toISOString().slice(0, 10) })
      )
    );
    toast.success(`Marked ${unpaid.length} charges as paid`);
    await reload();
  }

  async function handleSaveChargeNote(chargeId: string) {
    await apiUpdateCharge(chargeId, { note: editingChargeNote || undefined });
    setEditingChargeId(null);
    toast.success("Note updated");
    await reload();
  }

  // ─── Per-subscriber helpers ─────────────────────────────────────────
  function subscriberCharges(subscriberId: string) {
    return data!.charges.filter((c) => c.subscriber_id === subscriberId);
  }

  function subscriberUnpaid(subscriberId: string) {
    return subscriberCharges(subscriberId)
      .filter((c) => !c.paid)
      .reduce((s, c) => s + Number(c.total_cny), 0);
  }

  // ─── Sortable header ───────────────────────────────────────────────
  function SortableHead({ column, children }: { column: string; children: React.ReactNode }) {
    return (
      <TableHead
        className="cursor-pointer select-none hover:text-foreground transition-colors"
        onClick={() => handleSort(column)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <ArrowUpDown className={`h-3 w-3 ${sortColumn === column ? "text-foreground" : "text-muted-foreground/50"}`} />
        </span>
      </TableHead>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────────────────────── */}
      <motion.div {...fadeUp} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">订阅管理 / Subscriptions</h1>
          <p className="text-sm text-muted-foreground">管理代付订阅，跟踪收款状态</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="sm" onClick={() => setKeyboardHelpOpen(true)} />}>
              <Keyboard className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
          </Tooltip>
          <Dialog open={addChargeOpen} onOpenChange={setAddChargeOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus className="mr-1 h-4 w-4" /> 新增账单
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新增账单 / New Charge</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>订阅人</Label>
                  <Select value={chargeForm.subscriberId || ""} onValueChange={(v) => setChargeForm({ ...chargeForm, subscriberId: v as string })}>
                    <SelectTrigger><SelectValue placeholder="选择订阅人" /></SelectTrigger>
                    <SelectContent>
                      {data.subscribers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>服务</Label>
                  <Select value={chargeForm.serviceId || ""} onValueChange={(v) => setChargeForm({ ...chargeForm, serviceId: v as string })}>
                    <SelectTrigger><SelectValue placeholder="选择服务" /></SelectTrigger>
                    <SelectContent>
                      {data.services.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name} ({s.monthly_cost} {s.currency}/月)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>起始月份</Label>
                    <Input type="month" value={chargeForm.periodStart} onChange={(e) => setChargeForm({ ...chargeForm, periodStart: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>结束月份</Label>
                    <Input type="month" value={chargeForm.periodEnd} onChange={(e) => setChargeForm({ ...chargeForm, periodEnd: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>汇率 (→ CNY)</Label>
                  <Input type="number" step="0.01" value={chargeForm.exchangeRate} onChange={(e) => setChargeForm({ ...chargeForm, exchangeRate: Number(e.target.value) })} />
                </div>
                {chargeForm.serviceId && chargeForm.periodStart && chargeForm.periodEnd && (() => {
                  const service = data.services.find((s) => s.id === chargeForm.serviceId);
                  const months = calcMonths(chargeForm.periodStart, chargeForm.periodEnd);
                  if (!service || months <= 0) return null;
                  const total = calcTotalCNY(months, Number(service.monthly_cost), chargeForm.exchangeRate);
                  return (
                    <div className="rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 p-3 text-sm">
                      <div>{months} 个月 × {service.monthly_cost} {service.currency} × {chargeForm.exchangeRate}</div>
                      <div className="mt-1 text-lg font-bold">= ¥{total.toFixed(2)}</div>
                    </div>
                  );
                })()}
                <div className="grid gap-2">
                  <Label>备注</Label>
                  <Input placeholder="可选备注" value={chargeForm.note} onChange={(e) => setChargeForm({ ...chargeForm, note: e.target.value })} />
                </div>
                <Button onClick={handleAddCharge}>添加</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </motion.div>

      {/* ─── Stats dashboard ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <motion.div {...fadeUp} transition={{ delay: 0.05 }}>
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-emerald-500/20 to-green-500/10 shadow-lg shadow-emerald-500/5">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
            <CardContent className="relative pt-6">
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <Check className="h-4 w-4" />
                已收 / Paid
              </div>
              <div className="mt-1 text-2xl font-bold font-mono text-emerald-400">
                ¥{summary.totalPaid.toFixed(2)}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div {...fadeUp} transition={{ delay: 0.1 }}>
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-amber-500/20 to-orange-500/10 shadow-lg shadow-amber-500/5">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
            <CardContent className="relative pt-6">
              <div className="flex items-center gap-2 text-sm text-amber-400">
                <Clock className="h-4 w-4" />
                未收 / Unpaid
              </div>
              <div className="mt-1 text-2xl font-bold font-mono text-amber-400">
                ¥{summary.totalUnpaid.toFixed(2)}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div {...fadeUp} transition={{ delay: 0.15 }}>
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-blue-500/20 to-cyan-500/10 shadow-lg shadow-blue-500/5">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
            <CardContent className="relative pt-6">
              <div className="flex items-center gap-2 text-sm text-blue-400">
                <Users className="h-4 w-4" />
                订阅人 / Subscribers
              </div>
              <div className="mt-1 text-2xl font-bold font-mono text-blue-400">
                {summary.activeSubscribers}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div {...fadeUp} transition={{ delay: 0.2 }}>
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-purple-500/20 to-pink-500/10 shadow-lg shadow-purple-500/5">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent" />
            <CardContent className="relative pt-6">
              <div className="flex items-center gap-2 text-sm text-purple-400">
                <TrendingUp className="h-4 w-4" />
                平均汇率 / Avg Rate
              </div>
              <div className="mt-1 text-2xl font-bold font-mono text-purple-400">
                {summary.avgRate > 0 ? summary.avgRate.toFixed(4) : "—"}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ─── Tabs ────────────────────────────────────────────────────── */}
      <motion.div {...fadeUp} transition={{ delay: 0.25 }}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList>
              <TabsTrigger value="charges">
                <FileText className="mr-1 h-4 w-4" /> 账单
              </TabsTrigger>
              <TabsTrigger value="people">
                <Users className="mr-1 h-4 w-4" /> 按人查看
              </TabsTrigger>
              <TabsTrigger value="charts">
                <BarChart3 className="mr-1 h-4 w-4" /> 图表
              </TabsTrigger>
              <TabsTrigger value="settings">
                <Settings className="mr-1 h-4 w-4" /> 设置
              </TabsTrigger>
            </TabsList>
            {activeTab === "charges" && (
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={searchRef}
                    placeholder="Search charges..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 w-48 pl-9 text-sm"
                  />
                </div>
                <Tooltip>
                  <TooltipTrigger render={<Button variant="outline" size="sm" onClick={handleBulkMarkPaid} />}>
                    <CheckCheck className="mr-1 h-4 w-4" /> Bulk Pay
                  </TooltipTrigger>
                  <TooltipContent>Mark all filtered unpaid as paid</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger render={<Button variant="outline" size="sm" onClick={() => exportToCSV(data.charges, data.services, data.subscribers)} />}>
                    <Download className="mr-1 h-4 w-4" /> CSV
                  </TooltipTrigger>
                  <TooltipContent>Export all charges to CSV</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>

          {/* ─── Charges tab ──────────────────────────────────────── */}
          <TabsContent value="charges">
            <Card className="glass-card">
              <CardContent className="pt-6">
                {filteredCharges.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="rounded-full bg-muted/50 p-4 mb-4">
                      <CreditCard className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="font-medium text-lg">
                      {searchQuery ? "No matching charges" : "暂无账单"}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                      {searchQuery
                        ? "Try adjusting your search query"
                        : "Click the 「新增账单」button above to add your first charge"}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <SortableHead column="subscriber">订阅人</SortableHead>
                            <SortableHead column="service">服务</SortableHead>
                            <SortableHead column="period">周期</SortableHead>
                            <SortableHead column="months">月数</SortableHead>
                            <TableHead>单价</TableHead>
                            <TableHead>汇率</TableHead>
                            <SortableHead column="total">合计 (CNY)</SortableHead>
                            <SortableHead column="paid">状态</SortableHead>
                            <TableHead className="w-20"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <AnimatePresence>
                            {paginatedCharges.map((charge) => {
                              const subscriber = data.subscribers.find((s) => s.id === charge.subscriber_id);
                              const service = data.services.find((s) => s.id === charge.service_id);
                              return (
                                <motion.tr
                                  key={charge.id}
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  className={`border-b transition-colors hover:bg-muted/50 ${
                                    charge.paid
                                      ? "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.07]"
                                      : ""
                                  }`}
                                >
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <SubscriberAvatar name={subscriber?.name ?? "?"} />
                                      <span className="font-medium">{subscriber?.name ?? "Unknown"}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>{service?.name ?? "Unknown"}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{charge.period_start} ~ {charge.period_end}</TableCell>
                                  <TableCell>{charge.months}</TableCell>
                                  <TableCell className="font-mono text-xs">{charge.monthly_cost} {charge.currency}</TableCell>
                                  <TableCell className="font-mono text-xs">{charge.exchange_rate}</TableCell>
                                  <TableCell className="font-mono font-bold">¥{Number(charge.total_cny).toFixed(2)}</TableCell>
                                  <TableCell>
                                    <Badge
                                      className={`cursor-pointer transition-all hover:scale-105 ${
                                        charge.paid
                                          ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30"
                                          : "bg-amber-500/20 text-amber-500 border-amber-500/30"
                                      }`}
                                      onClick={() => handleTogglePaid(charge)}
                                    >
                                      {charge.paid ? (
                                        <>✅ 已付</>
                                      ) : (
                                        <>⏳ 未付</>
                                      )}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-1">
                                      {editingChargeId === charge.id ? (
                                        <div className="flex gap-1">
                                          <Input
                                            className="h-7 w-24 text-xs"
                                            value={editingChargeNote}
                                            onChange={(e) => setEditingChargeNote(e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") handleSaveChargeNote(charge.id);
                                              if (e.key === "Escape") setEditingChargeId(null);
                                            }}
                                            autoFocus
                                          />
                                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveChargeNote(charge.id)}>
                                            <Check className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      ) : (
                                        <>
                                          <Tooltip>
                                            <TooltipTrigger
                                              render={
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-7 w-7"
                                                  onClick={() => {
                                                    setEditingChargeId(charge.id);
                                                    setEditingChargeNote(charge.note ?? "");
                                                  }}
                                                />
                                              }
                                            >
                                              <Edit2 className="h-3 w-3" />
                                            </TooltipTrigger>
                                            <TooltipContent>Edit note</TooltipContent>
                                          </Tooltip>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => setConfirmDelete({ type: "charge", id: charge.id, name: `${subscriber?.name} - ${service?.name}` })}
                                          >
                                            <Trash2 className="h-3 w-3 text-destructive" />
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                  </TableCell>
                                </motion.tr>
                              );
                            })}
                          </AnimatePresence>
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-4 text-sm">
                        <span className="text-muted-foreground">
                          Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredCharges.length)} of {filteredCharges.length}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage((p) => p - 1)}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                            <Button
                              key={page}
                              variant={currentPage === page ? "default" : "outline"}
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setCurrentPage(page)}
                            >
                              {page}
                            </Button>
                          ))}
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage((p) => p + 1)}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── People tab ───────────────────────────────────────── */}
          <TabsContent value="people" className="space-y-4">
            {data.subscribers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="rounded-full bg-muted/50 p-4 mb-4">
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="font-medium text-lg">No subscribers yet</h3>
                <p className="text-sm text-muted-foreground mt-1">Go to Settings to add subscribers</p>
              </div>
            ) : (
              data.subscribers.map((subscriber) => {
                const charges = subscriberCharges(subscriber.id);
                const unpaid = subscriberUnpaid(subscriber.id);
                const paid = charges.filter((c) => c.paid).reduce((s, c) => s + Number(c.total_cny), 0);
                return (
                  <motion.div key={subscriber.id} {...fadeUp}>
                    <Card className="glass-card">
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between text-base">
                          <div className="flex items-center gap-3">
                            <SubscriberAvatar name={subscriber.name} size="md" />
                            <span>{subscriber.name}</span>
                          </div>
                          <div className="flex gap-2">
                            {unpaid > 0 && (
                              <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 font-mono">
                                ⏳ 未付 ¥{unpaid.toFixed(2)}
                              </Badge>
                            )}
                            {paid > 0 && (
                              <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 font-mono">
                                ✅ 已付 ¥{paid.toFixed(2)}
                              </Badge>
                            )}
                          </div>
                        </CardTitle>
                      </CardHeader>
                      {charges.length > 0 && (
                        <CardContent>
                          <div className="space-y-2">
                            {charges.map((charge) => {
                              const service = data.services.find((s) => s.id === charge.service_id);
                              return (
                                <motion.div
                                  key={charge.id}
                                  whileHover={{ scale: 1.005 }}
                                  className={`flex items-center justify-between rounded-lg border p-3 text-sm transition-colors ${
                                    charge.paid
                                      ? "border-emerald-500/20 bg-emerald-500/5"
                                      : "border-amber-500/20 bg-amber-500/5"
                                  }`}
                                >
                                  <div>
                                    <span className="font-medium">{service?.name}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {charge.period_start} ~ {charge.period_end} ({charge.months}个月)
                                    </span>
                                    {charge.note && <span className="ml-2 text-xs text-muted-foreground">· {charge.note}</span>}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold">¥{Number(charge.total_cny).toFixed(2)}</span>
                                    <Badge
                                      className={`cursor-pointer transition-all hover:scale-105 ${
                                        charge.paid
                                          ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30"
                                          : "bg-amber-500/20 text-amber-500 border-amber-500/30"
                                      }`}
                                      onClick={() => handleTogglePaid(charge)}
                                    >
                                      {charge.paid ? "✅ 已付" : "⏳ 未付"}
                                    </Badge>
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  </motion.div>
                );
              })
            )}
          </TabsContent>

          {/* ─── Charts tab ───────────────────────────────────────── */}
          <TabsContent value="charts" className="space-y-4">
            {data.charges.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="rounded-full bg-muted/50 p-4 mb-4">
                  <BarChart3 className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="font-medium text-lg">No data to visualize</h3>
                <p className="text-sm text-muted-foreground mt-1">Add some charges first to see charts</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <motion.div {...fadeUp}>
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Spending by Service / 按服务支出
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <SpendingPieChart charges={data.charges} services={data.services} />
                    </CardContent>
                  </Card>
                </motion.div>
                <motion.div {...fadeUp} transition={{ delay: 0.1 }}>
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Paid vs Owed / 已付 vs 未付
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <PersonBarChart charges={data.charges} subscribers={data.subscribers} />
                    </CardContent>
                  </Card>
                </motion.div>
              </div>
            )}
          </TabsContent>

          {/* ─── Settings tab ─────────────────────────────────────── */}
          <TabsContent value="settings" className="space-y-6">
            <motion.div {...fadeUp}>
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4" /> 订阅人
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {data.subscribers.map((s) => (
                      <Badge key={s.id} variant="secondary" className="gap-2 pr-1 pl-1">
                        <SubscriberAvatar name={s.name} />
                        {s.name}
                        <button
                          onClick={() => setConfirmDelete({ type: "subscriber", id: s.id, name: s.name })}
                          className="ml-1 rounded-full p-0.5 hover:bg-destructive/20 transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="新订阅人"
                      value={newSubscriberName}
                      onChange={(e) => setNewSubscriberName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddSubscriber()}
                      className="max-w-xs"
                    />
                    <Button size="sm" onClick={handleAddSubscriber}>
                      <Plus className="mr-1 h-4 w-4" /> 添加
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div {...fadeUp} transition={{ delay: 0.1 }}>
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <DollarSign className="h-4 w-4" /> 订阅服务
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.services.map((service) => (
                    <motion.div
                      key={service.id}
                      whileHover={{ scale: 1.005 }}
                      className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-muted/30"
                    >
                      <div>
                        <div className="font-medium">{service.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {service.monthly_cost} {service.currency} / 月
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => { setEditingService({ ...service }); setEditServiceOpen(true); }}>
                          <Edit2 className="mr-1 h-3 w-3" /> 编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDelete({ type: "service", id: service.id, name: service.name })}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                  {data.services.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <DollarSign className="h-8 w-8 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">No services yet. Add your first subscription service.</p>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingService({ id: "", name: "", monthly_cost: 0, currency: "USD" });
                      setEditServiceOpen(true);
                    }}
                  >
                    <Plus className="mr-1 h-4 w-4" /> 添加服务
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* ─── Edit service dialog ─────────────────────────────────────── */}
      <Dialog open={editServiceOpen} onOpenChange={(open) => { setEditServiceOpen(open); if (!open) setEditingService(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑服务</DialogTitle>
          </DialogHeader>
          {editingService && (
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>服务名称</Label>
                <Input value={editingService.name} onChange={(e) => setEditingService({ ...editingService, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>月费</Label>
                  <Input type="number" step="0.01" value={editingService.monthly_cost} onChange={(e) => setEditingService({ ...editingService, monthly_cost: Number(e.target.value) })} />
                </div>
                <div className="grid gap-2">
                  <Label>货币</Label>
                  <Select value={editingService.currency} onValueChange={(v) => setEditingService({ ...editingService, currency: v as Currency })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="SGD">SGD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleSaveService}>保存</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Confirm delete dialog ───────────────────────────────────── */}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}
        title="确认删除"
        description={`Are you sure you want to delete "${confirmDelete?.name}"? This action cannot be undone.`}
        onConfirm={() => {
          if (!confirmDelete) return;
          if (confirmDelete.type === "charge") handleRemoveCharge(confirmDelete.id);
          if (confirmDelete.type === "subscriber") handleRemoveSubscriber(confirmDelete.id);
          if (confirmDelete.type === "service") handleRemoveService(confirmDelete.id);
        }}
      />

      {/* ─── Keyboard shortcuts help ─────────────────────────────────── */}
      <KeyboardHelp open={keyboardHelpOpen} onOpenChange={setKeyboardHelpOpen} />
    </div>
  );
}
