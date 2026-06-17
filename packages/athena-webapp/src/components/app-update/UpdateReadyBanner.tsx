import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  usePreferredUpdateCommunicationVariant,
  useUpdateCoordinator,
} from "@/lib/app-update";
import { cn } from "@/lib/utils";

const updateReadyToastId = "athena-update-ready-toast";
const refreshButtonClassName =
  "min-h-10 shrink-0 px-layout-md text-action-commit hover:bg-action-commit-soft hover:text-action-commit";

export function UpdateReadyBanner() {
  const { snapshot, applyUpdate } = useUpdateCoordinator();
  const communicationVariant = usePreferredUpdateCommunicationVariant();
  const hasUpdate =
    snapshot.status === "ready" ||
    snapshot.status === "ready-unstaged" ||
    snapshot.status === "blocked" ||
    snapshot.status === "applying";

  const blocker = snapshot.selectedBlocker;
  const hasBlocker = Boolean(blocker);
  const canApply = snapshot.canApply;
  const isApplying = snapshot.status === "applying";
  const primaryCopy = blocker
    ? blocker.guidance
    : isApplying
      ? "Refreshing Athena now."
      : "Update ready";
  const shouldShowToast =
    hasUpdate && communicationVariant === "toast";

  useEffect(() => {
    if (!shouldShowToast) {
      toast.dismiss(updateReadyToastId);
      return;
    }

    toast.message(primaryCopy, {
      id: updateReadyToastId,
      closeButton: false,
      dismissible: false,
      duration: Number.POSITIVE_INFINITY,
      position: "top-right",
      className: "min-w-80",
      classNames: {
        toast: "justify-between",
        content: "min-w-0 flex-1",
      },
      action: !hasBlocker ? (
        <Button
          className={cn(refreshButtonClassName, "ml-auto")}
          disabled={!canApply || isApplying}
          onClick={() => {
            if (canApply && !isApplying) {
              applyUpdate();
            }
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw
            aria-hidden="true"
            className={cn(isApplying && "animate-spin")}
          />
          Refresh
        </Button>
      ) : undefined,
    });
  }, [
    applyUpdate,
    canApply,
    hasBlocker,
    isApplying,
    primaryCopy,
    shouldShowToast,
  ]);

  if (!hasUpdate || communicationVariant !== "banner") {
    return null;
  }

  return (
    <section
      aria-label="Update ready"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 border-b border-border/80 bg-surface/95 px-layout-md py-layout-sm shadow-surface backdrop-blur supports-[backdrop-filter]:bg-surface/85"
    >
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-layout-lg text-center sm:flex-row sm:text-left">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {primaryCopy}
          </p>
        </div>
        {!blocker ? (
          <Button
            className={refreshButtonClassName}
            disabled={!canApply || isApplying}
            onClick={applyUpdate}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RefreshCw
              aria-hidden="true"
              className={cn(isApplying && "animate-spin")}
            />
            Refresh
          </Button>
        ) : null}
      </div>
    </section>
  );
}
