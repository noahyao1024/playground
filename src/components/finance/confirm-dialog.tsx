"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type Confirmation = { title: string; description: string; action: string; run: () => Promise<void> | void };

/** Asks before something that cannot be taken back. */
export function ConfirmDialog({ confirmation, onClose }: { confirmation: Confirmation | null; onClose: () => void }) {
  return (
    <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmation?.title}</DialogTitle>
          <DialogDescription>{confirmation?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={async () => {
              const run = confirmation?.run;
              onClose();
              await run?.();
            }}
          >
            {confirmation?.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
