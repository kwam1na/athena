import { Home, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { SharedDemoGuide } from "./SharedDemoGuide";

export type SharedDemoRestoreStatus = "failed" | "ready" | "restoring";

export function SharedDemoStatusBar({ area = "Owner home", homeHref, onRestore, restoreStatus }: { area?: string; homeHref: string; onRestore: () => Promise<void>; restoreStatus: SharedDemoRestoreStatus }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string>();
  const restoring = submitting || restoreStatus === "restoring";

  const restore = async () => {
    setConfirmOpen(false);
    setSubmitting(true);
    setMessage("Restoring the shared demo store…");
    try {
      await onRestore();
      setMessage("Restore complete. The shared demo is back to its baseline.");
    } catch {
      setMessage("The demo store could not be restored. The previous store state is still available. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const statusMessage = restoreStatus === "restoring"
    ? "The shared demo is being restored. Try your action again shortly."
    : restoreStatus === "failed"
      ? "The last restore did not finish. The previous store state remains available."
      : message;

  return (
    <>
      <aside aria-label="Shared demo controls" className="shrink-0 border-b border-border bg-background px-layout-sm py-layout-sm sm:px-layout-md">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-layout-sm">
          <div className="min-w-[15rem] flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">Shared demo store</p>
            <p className="mt-layout-2xs text-xs leading-5 text-muted-foreground">Other visitors may change this store. Athena restores the baseline every hour.</p>
            <p className="text-xs leading-5 text-muted-foreground">Do not enter real personal, payment, or credential information.</p>
          </div>
          <Button asChild variant="utility" size="lg"><a href={homeHref}><Home aria-hidden="true" /> <span className="hidden sm:inline">Owner home</span></a></Button>
          <SharedDemoGuide area={area} homeHref={homeHref} />
          <Button type="button" variant="utility" size="lg" disabled={restoring} onClick={() => setConfirmOpen(true)}><RotateCcw aria-hidden="true" /> Restore demo</Button>
        </div>
        {statusMessage ? <p aria-live="polite" className="mx-auto mt-layout-xs max-w-[100rem] text-sm text-muted-foreground">{statusMessage}</p> : null}
      </aside>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore the shared demo store?</DialogTitle>
            <DialogDescription>This removes demo changes for everyone currently using it. Athena will restore the synthetic baseline.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="utility" size="lg" onClick={() => setConfirmOpen(false)}>Keep current changes</Button>
            <Button type="button" size="lg" onClick={() => void restore()}>Restore shared demo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
