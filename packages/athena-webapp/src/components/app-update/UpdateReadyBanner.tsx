import { useEffect } from "react";
import { Download, Info } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  usePreferredUpdateCommunicationVariant,
  useUpdateCoordinator,
} from "@/lib/app-update";
import { cn } from "@/lib/utils";

const updateReadyToastId = "athena-update-ready-toast";
const updateButtonClassName =
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
  const bannerContent = getUpdateReadyBannerContent(snapshot);
  const showUpdateAction = !hasBlocker && (canApply || isApplying);
  const shouldShowToast =
    hasUpdate && communicationVariant === "toast";

  useEffect(() => {
    if (!shouldShowToast) {
      toast.dismiss(updateReadyToastId);
      return;
    }

    toast.message(bannerContent.message, {
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
      action: showUpdateAction ? (
        <Button
          className={cn(updateButtonClassName, "ml-auto")}
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
          <Download aria-hidden="true" />
          Update
        </Button>
      ) : undefined,
    });
  }, [
    applyUpdate,
    bannerContent.message,
    canApply,
    hasBlocker,
    isApplying,
    shouldShowToast,
    showUpdateAction,
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
          <div className="flex min-w-0 items-center justify-center gap-layout-xs truncate text-sm font-medium text-foreground sm:justify-start">
            <span className="truncate">{bannerContent.message}</span>
            {bannerContent.tooltip ? (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label="Update cache details"
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      type="button"
                    >
                      <Info aria-hidden="true" className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="w-72 max-w-[calc(100vw-2rem)] whitespace-normal text-left text-xs leading-5">
                    {bannerContent.tooltip}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
        </div>
        {showUpdateAction ? (
          <Button
            className={updateButtonClassName}
            disabled={!canApply || isApplying}
            onClick={() => applyUpdate()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Download aria-hidden="true" />
            Update
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function getUpdateReadyBannerContent(
  snapshot: ReturnType<typeof useUpdateCoordinator>["snapshot"],
) {
  if (snapshot.selectedBlocker) {
    return { message: snapshot.selectedBlocker.guidance };
  }
  if (snapshot.status === "applying") {
    return { message: "Updating Athena now." };
  }
  if (snapshot.status === "ready-unstaged") {
    switch (snapshot.staging?.reason) {
      case "asset-staging-failed":
      case "service-worker-error":
        return {
          message: "Update ready",
          tooltip: "Some files were not cached for offline use.",
        };
      case "service-worker-timeout":
        return {
          message: "Update ready. Offline file caching is still catching up.",
        };
      case "service-worker-unavailable":
        return { message: "Update ready. App shell cache is not connected." };
      case "cache-storage-unavailable":
      case "no-entry-html":
      case "no-static-assets":
        return {
          message: "Update ready. Offline cache preparation is unavailable.",
        };
      default:
        return {
          message: "Update ready. Offline cache preparation is incomplete.",
        };
    }
  }
  if (snapshot.canApply) {
    return { message: "Update ready" };
  }

  return { message: "Update detected. Preparing refresh." };
}
