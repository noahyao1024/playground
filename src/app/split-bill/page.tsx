"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getBillGroup,
  saveBillGroup,
  calculateTermSummary,
  calculateSettlements,
  genId,
  type BillGroup,
  type BillEntry,
  type BillTerm,
  type TermSummary,
  type Settlement,
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
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Edit2, ArrowRight, Users, DollarSign, Settings } from "lucide-react";

export default function SplitBillPage() {
  const [group, setGroup] = useState<BillGroup | null>(null);
  const [activeTab, setActiveTab] = useState<string | number>("overview");
  const [editTermOpen, setEditTermOpen] = useState(false);
  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [editingTerm, setEditingTerm] = useState<BillTerm | null>(null);
  const [newEntry, setNewEntry] = useState<Partial<BillEntry>>({ currency: "SGD" });

  useEffect(() => {
    setGroup(getBillGroup());
  }, []);

  const save = useCallback((updated: BillGroup) => {
    setGroup(updated);
    saveBillGroup(updated);
  }, []);

  if (!group) return <div className="flex justify-center py-20 text-muted-foreground">Loading...</div>;

  const summaries: TermSummary[] = group.terms.map((t) => calculateTermSummary(group, t.id));

  function addMember() {
    if (!newMemberName.trim() || !group) return;
    save({
      ...group,
      members: [...group.members, { id: genId(), name: newMemberName.trim() }],
    });
    setNewMemberName("");
  }

  function removeMember(id: string) {
    if (!group) return;
    save({
      ...group,
      members: group.members.filter((m) => m.id !== id),
      entries: group.entries.filter((e) => e.memberId !== id),
    });
  }

  function saveTermHandler() {
    if (!editingTerm || !group) return;
    const exists = group.terms.find((t) => t.id === editingTerm.id);
    const updated = exists
      ? { ...group, terms: group.terms.map((t) => (t.id === editingTerm.id ? editingTerm : t)) }
      : { ...group, terms: [...group.terms, editingTerm] };
    save(updated);
    setEditTermOpen(false);
    setEditingTerm(null);
  }

  function removeTerm(id: string) {
    if (!group) return;
    save({
      ...group,
      terms: group.terms.filter((t) => t.id !== id),
      entries: group.entries.filter((e) => e.termId !== id),
    });
  }

  function addEntry() {
    if (!newEntry.termId || !newEntry.memberId || !newEntry.amount || !newEntry.date || !group) return;
    const entry: BillEntry = {
      id: genId(),
      termId: newEntry.termId,
      memberId: newEntry.memberId,
      date: newEntry.date,
      amount: Number(newEntry.amount),
      currency: newEntry.currency as "SGD" | "USD",
      note: newEntry.note,
    };
    save({ ...group, entries: [...group.entries, entry] });
    setNewEntry({ currency: "SGD" });
    setAddEntryOpen(false);
  }

  function removeEntry(id: string) {
    if (!group) return;
    save({ ...group, entries: group.entries.filter((e) => e.id !== id) });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Split Bill / 分账</h1>
          <p className="text-sm text-muted-foreground">Subscription cost-sharing tracker / 订阅费用分摊</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={addEntryOpen} onOpenChange={setAddEntryOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus className="mr-1 h-4 w-4" /> Add Entry / 添加
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Payment Entry / 添加付款</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>Term / 账期</Label>
                  <Select value={newEntry.termId ?? null} onValueChange={(v) => setNewEntry({ ...newEntry, termId: v as string })}>
                    <SelectTrigger><SelectValue placeholder="Select term" /></SelectTrigger>
                    <SelectContent>
                      {group.terms.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Person / 人</Label>
                  <Select value={newEntry.memberId ?? null} onValueChange={(v) => setNewEntry({ ...newEntry, memberId: v as string })}>
                    <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                    <SelectContent>
                      {group.members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Amount / 金额</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newEntry.amount || ""}
                      onChange={(e) => setNewEntry({ ...newEntry, amount: Number(e.target.value) })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Currency / 货币</Label>
                    <Select value={newEntry.currency || "SGD"} onValueChange={(v) => setNewEntry({ ...newEntry, currency: v as "SGD" | "USD" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SGD">SGD</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Payment Day / 付款日</Label>
                  <Input
                    placeholder="e.g. 12 (day of month)"
                    value={newEntry.date || ""}
                    onChange={(e) => setNewEntry({ ...newEntry, date: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Note / 备注</Label>
                  <Input
                    placeholder="Optional note"
                    value={newEntry.note || ""}
                    onChange={(e) => setNewEntry({ ...newEntry, note: e.target.value })}
                  />
                </div>
                <Button onClick={addEntry}>Add Entry / 添加</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
        <TabsList>
          <TabsTrigger value="overview">
            <DollarSign className="mr-1 h-4 w-4" /> Overview / 总览
          </TabsTrigger>
          <TabsTrigger value="entries">
            <Edit2 className="mr-1 h-4 w-4" /> Entries / 明细
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="mr-1 h-4 w-4" /> Settings / 设置
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {summaries.map((summary) => {
            const settlements = calculateSettlements(summary);
            return <TermOverview key={summary.termId} summary={summary} settlements={settlements} />;
          })}
        </TabsContent>

        <TabsContent value="entries" className="space-y-4">
          {group.terms.map((term) => {
            const termEntries = group.entries.filter((e) => e.termId === term.id);
            return (
              <Card key={term.id}>
                <CardHeader>
                  <CardTitle className="text-base">{term.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {termEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No entries yet / 暂无记录</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Person / 人</TableHead>
                            <TableHead>Day / 日</TableHead>
                            <TableHead>Amount / 金额</TableHead>
                            <TableHead>CNY / 人民币</TableHead>
                            <TableHead>Note / 备注</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {termEntries.map((entry) => {
                            const member = group.members.find((m) => m.id === entry.memberId);
                            const cny =
                              entry.currency === "SGD"
                                ? entry.amount * term.rates.SGD_CNY
                                : entry.amount * term.rates.USD_CNY;
                            return (
                              <TableRow key={entry.id}>
                                <TableCell className="font-medium">{member?.name ?? "Unknown"}</TableCell>
                                <TableCell>{entry.date}</TableCell>
                                <TableCell>
                                  {entry.amount.toFixed(2)} {entry.currency}
                                </TableCell>
                                <TableCell className="font-mono">¥{cny.toFixed(2)}</TableCell>
                                <TableCell className="text-muted-foreground text-xs">{entry.note}</TableCell>
                                <TableCell>
                                  <Button variant="ghost" size="icon" onClick={() => removeEntry(entry.id)}>
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
            );
          })}
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" /> Members / 成员
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {group.members.map((m) => (
                  <Badge key={m.id} variant="secondary" className="gap-1 pr-1">
                    {m.name}
                    <button
                      onClick={() => removeMember(m.id)}
                      className="ml-1 rounded-full p-0.5 hover:bg-destructive/20"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="New member name / 新成员名"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addMember()}
                  className="max-w-xs"
                />
                <Button size="sm" onClick={addMember}>
                  <Plus className="mr-1 h-4 w-4" /> Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="h-4 w-4" /> Terms & Exchange Rates / 账期与汇率
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {group.terms.map((term) => (
                <div
                  key={term.id}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-medium">{term.name}</div>
                    <div className="text-xs text-muted-foreground">
                      SGD→CNY: {term.rates.SGD_CNY} | USD→CNY: {term.rates.USD_CNY}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingTerm({ ...term });
                        setEditTermOpen(true);
                      }}
                    >
                      <Edit2 className="mr-1 h-3 w-3" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeTerm(term.id)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingTerm({
                    id: genId(),
                    name: `Term ${group.terms.length + 1}`,
                    rates: { SGD_CNY: 5.45, USD_CNY: 6.99 },
                  });
                  setEditTermOpen(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> Add Term / 添加账期
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit term dialog - controlled externally */}
      <Dialog
        open={editTermOpen}
        onOpenChange={(open) => {
          setEditTermOpen(open);
          if (!open) setEditingTerm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Term / 编辑账期</DialogTitle>
          </DialogHeader>
          {editingTerm && (
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Name / 名称</Label>
                <Input
                  value={editingTerm.name}
                  onChange={(e) => setEditingTerm({ ...editingTerm, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>SGD → CNY</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editingTerm.rates.SGD_CNY}
                    onChange={(e) =>
                      setEditingTerm({
                        ...editingTerm,
                        rates: { ...editingTerm.rates, SGD_CNY: Number(e.target.value) },
                      })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>USD → CNY</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editingTerm.rates.USD_CNY}
                    onChange={(e) =>
                      setEditingTerm({
                        ...editingTerm,
                        rates: { ...editingTerm.rates, USD_CNY: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              </div>
              <Button onClick={saveTermHandler}>Save / 保存</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TermOverview({
  summary,
  settlements,
}: {
  summary: TermSummary;
  settlements: Settlement[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{summary.termName}</span>
          <Badge variant="outline" className="font-mono">
            Total: ¥{summary.totalCNY.toFixed(2)}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {summary.memberCount} members · Equal share: ¥{summary.equalShare.toFixed(2)} per person
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          {summary.memberSummaries.map((ms) => {
            const isOverpaid = ms.owes < -0.01;
            const isUnderpaid = ms.owes > 0.01;
            const isBalanced = !isOverpaid && !isUnderpaid;
            return (
              <div
                key={ms.memberId}
                className={`flex items-center justify-between rounded-lg border p-3 ${
                  isOverpaid
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : isUnderpaid
                      ? "border-red-500/30 bg-red-500/5"
                      : "border-border"
                }`}
              >
                <div>
                  <span className="font-medium">{ms.memberName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">Paid ¥{ms.paidCNY.toFixed(2)}</span>
                </div>
                <div className="text-right">
                  {isBalanced && <Badge variant="outline">Balanced / 已平</Badge>}
                  {isOverpaid && (
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                      Overpaid ¥{Math.abs(ms.owes).toFixed(2)}
                    </Badge>
                  )}
                  {isUnderpaid && (
                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                      Owes ¥{ms.owes.toFixed(2)}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {settlements.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="mb-2 text-sm font-semibold">Settlement / 结算</h4>
              <div className="grid gap-2">
                {settlements.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span className="font-medium text-red-400">{s.from}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-emerald-400">{s.to}</span>
                    <span className="ml-auto font-mono">¥{s.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
