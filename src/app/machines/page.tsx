"use client";

import { useEffect, useState, useCallback } from "react";
import { getMachines, saveMachines, genId, type Machine } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Plus, Server, Trash2, Edit2, Clock } from "lucide-react";

const STATUS_OPTIONS: Machine["status"][] = ["ordered", "shipped", "delivered", "deployed"];

const STATUS_COLORS: Record<Machine["status"], string> = {
  ordered: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  shipped: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  delivered: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  deployed: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

const STATUS_LABELS: Record<Machine["status"], string> = {
  ordered: "Ordered",
  shipped: "Shipped",
  delivered: "Delivered",
  deployed: "Deployed",
};

const EMPTY_MACHINE: Omit<Machine, "id" | "createdAt" | "updatedAt" | "timeline"> = {
  hostname: "",
  ip: "",
  os: "",
  specs: "",
  location: "",
  status: "ordered",
  notes: "",
};

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_MACHINE);

  useEffect(() => {
    setMachines(getMachines());
  }, []);

  const save = useCallback((updated: Machine[]) => {
    setMachines(updated);
    saveMachines(updated);
  }, []);

  function addMachine() {
    if (!form.hostname.trim()) return;
    const now = new Date().toISOString();
    const machine: Machine = {
      ...form,
      id: genId(),
      createdAt: now,
      updatedAt: now,
      timeline: [{ status: form.status, date: now }],
    };
    save([...machines, machine]);
    setForm(EMPTY_MACHINE);
    setAddOpen(false);
  }

  function updateMachine() {
    if (!editId || !form.hostname.trim()) return;
    const now = new Date().toISOString();
    save(
      machines.map((m) => {
        if (m.id !== editId) return m;
        const statusChanged = m.status !== form.status;
        return {
          ...m,
          ...form,
          updatedAt: now,
          timeline: statusChanged
            ? [...m.timeline, { status: form.status, date: now }]
            : m.timeline,
        };
      })
    );
    setEditId(null);
    setForm(EMPTY_MACHINE);
  }

  function removeMachine(id: string) {
    save(machines.filter((m) => m.id !== id));
  }

  function openEdit(machine: Machine) {
    setForm({
      hostname: machine.hostname,
      ip: machine.ip,
      os: machine.os,
      specs: machine.specs,
      location: machine.location,
      status: machine.status,
      notes: machine.notes,
    });
    setEditId(machine.id);
  }

  const MachineForm = ({ onSubmit, submitLabel }: { onSubmit: () => void; submitLabel: string }) => (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label>Hostname</Label>
        <Input value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} placeholder="e.g. srv-prod-01" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>IP Address</Label>
          <Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="e.g. 10.0.1.5" />
        </div>
        <div className="grid gap-2">
          <Label>OS</Label>
          <Input value={form.os} onChange={(e) => setForm({ ...form, os: e.target.value })} placeholder="e.g. Ubuntu 22.04" />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Specs</Label>
        <Input value={form.specs} onChange={(e) => setForm({ ...form, specs: e.target.value })} placeholder="e.g. 64GB RAM, 1TB SSD, 16 cores" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Location</Label>
          <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. SG DC-1" />
        </div>
        <div className="grid gap-2">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Machine["status"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Notes</Label>
        <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes" />
      </div>
      <Button onClick={onSubmit}>{submitLabel}</Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SRE Machine Delivery</h1>
          <p className="text-sm text-muted-foreground">Track machine deliveries from order to deployment</p>
        </div>
        <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setForm(EMPTY_MACHINE); }}>
          <DialogTrigger>
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" /> Add Machine
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Machine</DialogTitle>
            </DialogHeader>
            <MachineForm onSubmit={addMachine} submitLabel="Add Machine" />
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editId} onOpenChange={(open) => { if (!open) { setEditId(null); setForm(EMPTY_MACHINE); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Machine</DialogTitle>
          </DialogHeader>
          <MachineForm onSubmit={updateMachine} submitLabel="Update Machine" />
        </DialogContent>
      </Dialog>

      {machines.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Server className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">No machines tracked yet.</p>
            <p className="text-sm text-muted-foreground">Click &quot;Add Machine&quot; to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {machines.map((machine) => (
            <Card key={machine.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Server className="h-4 w-4" />
                      {machine.hostname}
                    </CardTitle>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {machine.ip && <span>IP: {machine.ip}</span>}
                      {machine.os && <span>· {machine.os}</span>}
                      {machine.location && <span>· {machine.location}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge className={STATUS_COLORS[machine.status]}>{STATUS_LABELS[machine.status]}</Badge>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(machine)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => removeMachine(machine.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {machine.specs && (
                  <p className="text-sm text-muted-foreground">Specs: {machine.specs}</p>
                )}
                {machine.notes && (
                  <p className="text-sm text-muted-foreground">Notes: {machine.notes}</p>
                )}

                {/* Timeline */}
                {machine.timeline.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
                        <Clock className="h-3 w-3" /> Timeline
                      </h4>
                      <div className="relative ml-2 border-l border-border pl-4">
                        {machine.timeline.map((event, i) => (
                          <div key={i} className="relative mb-2 last:mb-0">
                            <div className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                            <div className="flex items-center gap-2 text-sm">
                              <Badge variant="outline" className="text-xs">
                                {STATUS_LABELS[event.status as Machine["status"]] ?? event.status}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {new Date(event.date).toLocaleString()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
