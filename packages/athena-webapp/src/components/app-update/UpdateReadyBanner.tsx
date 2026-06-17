import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUpdateCoordinator } from "@/lib/app-update";

export function UpdateReadyBanner() {
  const { snapshot, applyUpdate } = useUpdateCoordinator();
  const hasUpdate =
    snapshot.status === "ready" ||
    snapshot.status === "ready-unstaged" ||
    snapshot.status === "blocked" ||
    snapshot.status === "applying";

  if (!hasUpdate) {
    return null;
  }

  const blocker = snapshot.selectedBlocker;

  return (
    <section
      aria-label="Update ready"
      aria-live="polite"
      className="sticky top-0 z-50 border-b border-border bg-surface/95 px-4 py-3 shadow-surface backdrop-blur supports-[backdrop-filter]:bg-surface/85"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Badge
            variant={blocker ? "outline" : "secondary"}
            className="mt-0.5 shrink-0"
          >
            Update ready
          </Badge>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {blocker ? blocker.guidance : "Update ready. Refresh when ready."}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {blocker
                ? `${blocker.label} is still in progress.`
                : "Athena will reload once to finish the update."}
            </p>
          </div>
        </div>
        {!blocker ? (
          <Button
            className="min-h-11 shrink-0"
            disabled={snapshot.status === "applying"}
            onClick={applyUpdate}
            size="sm"
            type="button"
            variant="utility-strong"
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        ) : null}
      </div>
    </section>
  );
}
