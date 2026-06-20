import { useMemo } from "react";

import { AppMessageHost } from "@/components/app-messages/AppMessageHost";
import { useAppMessage } from "@/lib/app-messages";
import { useUpdateCoordinator } from "@/lib/app-update";

export function UpdateReadyBanner() {
  return (
    <>
      <UpdateReadyMessageAdapter />
      <AppMessageHost />
    </>
  );
}

function UpdateReadyMessageAdapter() {
  const { snapshot, applyUpdate } = useUpdateCoordinator();
  const hasUpdate =
    snapshot.status === "ready" ||
    snapshot.status === "ready-unstaged" ||
    snapshot.status === "blocked" ||
    snapshot.status === "applying";

  const blocker = snapshot.selectedBlocker;
  const canApply = snapshot.canApply;
  const isApplying = snapshot.status === "applying";
  const content = getUpdateReadyBannerContent(snapshot);
  const showUpdateAction = canApply || isApplying || Boolean(blocker);
  const action = useMemo(
    () =>
      showUpdateAction
        ? {
            actionId: "app-update.apply",
            disabled: !canApply || isApplying,
            iconName: "download" as const,
            label: "Update",
            onInvoke: () => {
              if (canApply && !isApplying) {
                applyUpdate();
              }
            },
          }
        : undefined,
    [applyUpdate, canApply, isApplying, showUpdateAction],
  );

  useAppMessage({
    id: "app-update.ready",
    active: hasUpdate,
    label: "Update ready",
    message: content.message,
    compactLabel: "New Athena version available",
    details: content.tooltip,
    detailsLabel: "Update cache details",
    priority: 100,
    toastId: "athena-update-ready-toast",
    action,
  });

  return null;
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
