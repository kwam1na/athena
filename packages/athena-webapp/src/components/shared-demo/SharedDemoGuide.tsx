import { Home, PanelRightOpen } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const guidance: Record<string, string> = {
  "Cash Controls": "Verify the register's expected cash and activity. No bank or payment movement occurs in the shared demo.",
  Inventory: "Follow stock movement in Athena's real inventory tools. Use only the synthetic products already in this store.",
  Operations: "Start today's store day and leave operational context. External report delivery is not sent.",
  Orders: "Advance a synthetic order through fulfillment. No customer is charged or contacted.",
  POS: "Complete a synthetic sale in the real register. Receipt messages and external payment effects are suppressed.",
  Reports: "Inspect the reporting relationships Athena already supports. Exports are unavailable in the shared demo.",
  Staff: "Coordinate around synthetic store work. Identity, credentials, roles, and permissions cannot be changed.",
};

export function SharedDemoGuide({ area, homeHref }: { area: string; homeHref: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const setDialogOpen = (next: boolean) => {
    setOpen(next);
    if (!next) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <>
      <Button ref={triggerRef} type="button" variant="utility" size="lg" aria-label="Open demo guide" onClick={() => setOpen(true)}>
        <PanelRightOpen aria-hidden="true" /> <span className="hidden sm:inline">Demo guide</span>
      </Button>
      <Dialog open={open} onOpenChange={setDialogOpen}>
        <DialogContent className="left-auto right-0 top-0 h-svh w-[min(92vw,25rem)] max-w-none translate-x-0 translate-y-0 content-start overflow-auto rounded-none border-y-0 border-r-0 p-layout-lg motion-reduce:transition-none">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">Shared demo guide</p>
          <DialogTitle className="mt-layout-sm font-display text-3xl font-light">{area}</DialogTitle>
          <DialogDescription className="mt-layout-sm text-base leading-7">
            {guidance[area] ?? "Use Athena's real application surface to understand and act on this synthetic store day."}
          </DialogDescription>
          <p className="mt-layout-lg text-sm leading-6 text-muted-foreground">Do not enter real personal, financial, credential, or other sensitive information. Other visitors can see changes made in this shared store.</p>
          <Button asChild variant="utility" size="lg" className="mt-layout-lg">
            <a href={homeHref}><Home aria-hidden="true" /> Owner home</a>
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
