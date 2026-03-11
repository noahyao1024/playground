"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
import { Plus, Trash2, Edit2, Check, X, Users, DollarSign, Settings, FileText } from "lucide-react";

export default function SubscriptionPage() {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("charges");
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [editServiceOpen, setEditServiceOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [newSubscriberName, setNewSubscriberName] = useState("");

  const [chargeForm, setChargeForm] = useState({
    subscriberId: "",
    serviceId: "",
    periodStart: "",
    periodEnd: "",
    exchangeRate: 7.25,
    note: "",
  });

  const reload = useCallback(async () => {
    const d = await fetchSubscriptionData();
    setData(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const summary = useMemo(() => {
    if (!data) return { totalOwed: 0, totalPaid: 0, totalUnpaid: 0 };
    const totalPaid = data.charges.filter((c) => c.paid).reduce((s, c) => s + Number(c.total_cny), 0);
    const totalUnpaid = data.charges.filter((c) => !c.paid).reduce((s, c) => s + Number(c.total_cny), 0);
    return { totalOwed: totalPaid + totalUnpaid, totalPaid, totalUnpaid };
  }, [data]);

  if (loading) return <div className="flex justify-center py-20 text-muted-foreground">Loading...</div>;
  if (!data) return <div className="flex justify-center py-20 text-muted-foreground">Failed to load data</div>;

  // ─── Subscriber actions ──────────────────────────────────────────

  async function handleAddSubscriber() {
    if (!newSubscriberName.trim()) return;
    await apiAddSubscriber(newSubscriberName.trim());
    setNewSubscriberName("");
    await reload();
  }

  async function handleRemoveSubscriber(id: string) {
    await apiDeleteSubscriber(id);
    await reload();
  }

  // ─── Service actions ─────────────────────────────────────────────

  async function handleSaveService() {
    if (!editingService) return;
    const exists = data!.services.find((s) => s.id === editingService.id);
    if (exists) {
      await apiUpdateService(editingService.id, {
        name: editingService.name,
        monthly_cost: editingService.monthly_cost,
        currency: editingService.currency,
      });
    } else {
      await apiAddService({
        name: editingService.name,
        monthly_cost: editingService.monthly_cost,
        currency: editingService.currency,
      });
    }
    setEditServiceOpen(false);
    setEditingService(null);
    await reload();
  }

  async function handleRemoveService(id: string) {
    await apiDeleteService(id);
    await reload();
  }

  // ─── Charge actions ──────────────────────────────────────────────

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
    await reload();
  }

  async function handleTogglePaid(charge: ChargeRecord) {
    await apiUpdateCharge(charge.id, {
      paid: !charge.paid,
      paid_date: !charge.paid ? new Date().toISOString().slice(0, 10) : undefined,
    });
    await reload();
  }

  async function handleRemoveCharge(id: string) {
    await apiDeleteCharge(id);
    await reload();
  }

  // ─── Per-subscriber helpers ──────────────────────────────────────

  function subscriberCharges(subscriberId: string) {
    return data!.charges.filter((c) => c.subscriber_id === subscriberId);
  }

  function subscriberUnpaid(subscriberId: string) {
    return subscriberCharges(subscriberId)
      .filter((c) => !c.paid)
      .reduce((s, c) => s + Number(c.total_cny), 0);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">订阅管理 / Subscriptions</h1>
          <p className="text-sm text-muted-foreground">管理代付订阅，跟踪收款状态</p>
        </div>
        <div className="flex gap-2">
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
                    <div className="rounded-lg bg-muted/50 p-3 text-sm">
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
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">总应收</div>
            <div className="text-2xl font-bold font-mono">¥{summary.totalOwed.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">已收</div>
            <div className="text-2xl font-bold font-mono text-emerald-500">¥{summary.totalPaid.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">未收</div>
            <div className="text-2xl font-bold font-mono text-red-500">¥{summary.totalUnpaid.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="charges">
            <FileText className="mr-1 h-4 w-4" /> 账单
          </TabsTrigger>
          <TabsTrigger value="people">
            <Users className="mr-1 h-4 w-4" /> 按人查看
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="mr-1 h-4 w-4" /> 设置
          </TabsTrigger>
        </TabsList>

        {/* ─── Charges tab ──────────────────────────────────────── */}
        <TabsContent value="charges">
          <Card>
            <CardContent className="pt-6">
              {data.charges.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">暂无账单，点击「新增账单」开始</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>订阅人</TableHead>
                        <TableHead>服务</TableHead>
                        <TableHead>周期</TableHead>
                        <TableHead>月数</TableHead>
                        <TableHead>单价</TableHead>
                        <TableHead>汇率</TableHead>
                        <TableHead>合计 (CNY)</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.charges.map((charge) => {
                        const subscriber = data.subscribers.find((s) => s.id === charge.subscriber_id);
                        const service = data.services.find((s) => s.id === charge.service_id);
                        return (
                          <TableRow key={charge.id}>
                            <TableCell className="font-medium">{subscriber?.name ?? "Unknown"}</TableCell>
                            <TableCell>{service?.name ?? "Unknown"}</TableCell>
                            <TableCell className="text-xs">{charge.period_start} ~ {charge.period_end}</TableCell>
                            <TableCell>{charge.months}</TableCell>
                            <TableCell className="font-mono text-xs">{charge.monthly_cost} {charge.currency}</TableCell>
                            <TableCell className="font-mono text-xs">{charge.exchange_rate}</TableCell>
                            <TableCell className="font-mono font-bold">¥{Number(charge.total_cny).toFixed(2)}</TableCell>
                            <TableCell>
                              <Badge
                                className={`cursor-pointer ${charge.paid ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30" : "bg-red-500/20 text-red-500 border-red-500/30"}`}
                                onClick={() => handleTogglePaid(charge)}
                              >
                                {charge.paid ? (
                                  <><Check className="mr-1 h-3 w-3" />已付</>
                                ) : (
                                  <><X className="mr-1 h-3 w-3" />未付</>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" onClick={() => handleRemoveCharge(charge.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── People tab ───────────────────────────────────────── */}
        <TabsContent value="people" className="space-y-4">
          {data.subscribers.map((subscriber) => {
            const charges = subscriberCharges(subscriber.id);
            const unpaid = subscriberUnpaid(subscriber.id);
            const paid = charges.filter((c) => c.paid).reduce((s, c) => s + Number(c.total_cny), 0);
            return (
              <Card key={subscriber.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{subscriber.name}</span>
                    <div className="flex gap-2">
                      {unpaid > 0 && (
                        <Badge className="bg-red-500/20 text-red-500 border-red-500/30 font-mono">
                          未付 ¥{unpaid.toFixed(2)}
                        </Badge>
                      )}
                      {paid > 0 && (
                        <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 font-mono">
                          已付 ¥{paid.toFixed(2)}
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
                          <div
                            key={charge.id}
                            className={`flex items-center justify-between rounded-lg border p-3 text-sm ${
                              charge.paid ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
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
                                className={`cursor-pointer ${charge.paid ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30" : "bg-red-500/20 text-red-500 border-red-500/30"}`}
                                onClick={() => handleTogglePaid(charge)}
                              >
                                {charge.paid ? "已付" : "未付"}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </TabsContent>

        {/* ─── Settings tab ─────────────────────────────────────── */}
        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" /> 订阅人
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {data.subscribers.map((s) => (
                  <Badge key={s.id} variant="secondary" className="gap-1 pr-1">
                    {s.name}
                    <button onClick={() => handleRemoveSubscriber(s.id)} className="ml-1 rounded-full p-0.5 hover:bg-destructive/20">
                      <Trash2 className="h-3 w-3" />
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="h-4 w-4" /> 订阅服务
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.services.map((service) => (
                <div key={service.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
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
                    <Button variant="ghost" size="sm" onClick={() => handleRemoveService(service.id)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
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
        </TabsContent>
      </Tabs>

      {/* Edit service dialog */}
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
    </div>
  );
}
