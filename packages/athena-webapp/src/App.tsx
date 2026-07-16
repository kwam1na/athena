import { useEffect, useSyncExternalStore } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { ConvexAuthProvider } from "@convex-dev/auth/react";

import { convex, queryClient, router } from "./appRouter";
import { AppMessagesProvider } from "./lib/app-messages";
import {
  getDefaultAuthRuntimeHandoffCoordinator,
  type AuthRuntimeHandoffCoordinator,
} from "./lib/auth/authRuntimeHandoff";
import { recoverPromotedPosRecoverySession } from "./lib/auth/recoverPromotedPosRecoverySession";
import {
  completeVerifiedPosRecoveryPromotion,
  getPosServiceAuthPresentation,
} from "./components/auth/Login/posRecoveryFlow";
import {
  stageUpdateStaticAssets,
  UpdateCoordinatorProvider,
  useUpdateCoordinator,
  type UpdateStagingDiagnostics,
} from "./lib/app-update";
import { createUpdateDetectionSequencer } from "./lib/app-update/updateDetectionSequencer";
import { getDefaultPosLocalStorageRuntime } from "./lib/pos/infrastructure/local/posLocalStorageRuntime";
import { PosLocalStorageRuntimeProvider } from "./lib/pos/infrastructure/local/posLocalStorageRuntimeContext";
import {
  createVersionChecker,
  type VersionCheckerUpdateDetectedEvent,
} from "./utils/versionChecker";

export function App({
  authRuntime = getDefaultAuthRuntimeHandoffCoordinator(),
}: {
  authRuntime?: AuthRuntimeHandoffCoordinator;
} = {}) {
  const authSnapshot = useSyncExternalStore(
    authRuntime.subscribe,
    authRuntime.getSnapshot,
    authRuntime.getSnapshot,
  );

  useEffect(() => {
    if (authSnapshot.blockReason !== "stale_handoff") return;
    void authRuntime
      .runExclusive(async () => {
        if (authRuntime.getSnapshot().blockReason === "stale_handoff") {
          authRuntime.takeOverStaleHandoff();
        }
      })
      .catch(() => authRuntime.refresh());
  }, [authRuntime, authSnapshot.blockReason]);

  if (authSnapshot.status === "blocked") {
    return (
      <main role="alert">
        Authentication is temporarily unavailable. Reload this page to try
        again.
      </main>
    );
  }

  const tokenStorage = authRuntime.getTokenStorage(
    authSnapshot.activeNamespace,
  );

  return (
    <PosLocalStorageRuntimeProvider
      runtime={getDefaultPosLocalStorageRuntime()}
    >
      <AppMessagesProvider>
        <UpdateCoordinatorProvider>
          <VersionCheckerBridge />
          <ConvexAuthProvider
            key={authSnapshot.providerRemountKey}
            client={convex}
            storage={tokenStorage}
            {...(authSnapshot.activeNamespace === null
              ? {}
              : { storageNamespace: authSnapshot.activeNamespace })}
          >
            <AuthRuntimePromotionRecovery
              authRuntime={authRuntime}
              handoffPhase={authSnapshot.handoffPhase}
            />
            <QueryClientProvider client={queryClient}>
              <RouterProvider router={router} />
            </QueryClientProvider>
          </ConvexAuthProvider>
        </UpdateCoordinatorProvider>
      </AppMessagesProvider>
    </PosLocalStorageRuntimeProvider>
  );
}

function AuthRuntimePromotionRecovery({
  authRuntime,
  handoffPhase,
}: {
  authRuntime: AuthRuntimeHandoffCoordinator;
  handoffPhase: string;
}) {
  useEffect(() => {
    if (handoffPhase !== "promoted") return;
    let cancelled = false;
    void authRuntime
      .runExclusive(async () => {
        if (authRuntime.getSnapshot().handoffPhase !== "promoted") return;
        const handle = authRuntime.getCurrentHandoffHandle();
        await authRuntime.keepLeaseAlive(handle, async () => {
          await recoverPromotedPosRecoverySession();
          if (cancelled) return;
          const presentation = getPosServiceAuthPresentation();
          completeVerifiedPosRecoveryPromotion({
            coordinator: authRuntime,
            handle,
            redirectTo: presentation?.redirectTo ?? "/",
          });
        });
      })
      .catch(() => {
        // Preserve the promoted namespace and retry after the next mount.
      });
    return () => {
      cancelled = true;
    };
  }, [authRuntime, handoffPhase]);
  return null;
}

export function VersionCheckerBridge() {
  const { getSnapshot, reportUpdateDetected, reportDetectorFailed } =
    useUpdateCoordinator();

  useEffect(() => {
    const sequencer = createUpdateDetectionSequencer({
      report: reportVersionCheckerUpdate,
      stage: stageVersionCheckerUpdate,
    });

    const versionChecker = createVersionChecker({
      onDetectorFailed: () => {
        reportDetectorFailed();
      },
      onUpdateDetected: (event) => {
        void sequencer.handle(event);
      },
      shouldReportDuplicateUpdate: (event) => {
        const snapshot = getSnapshot();
        return (
          snapshot.pendingBuildId === event.pendingBuildId &&
          snapshot.status === "ready-unstaged"
        );
      },
    });

    async function stageVersionCheckerUpdate(
      event: VersionCheckerUpdateDetectedEvent,
    ): Promise<UpdateStagingDiagnostics> {
      const stagingResult =
        event.staging?.entryHtml && event.staging.entryUrl
          ? await stageUpdateStaticAssets({
              entryHtml: event.staging.entryHtml,
              entryUrl: event.staging.entryUrl,
            }).catch((error) => {
              console.warn("Failed to stage update assets:", error);
              return {
                assetUrls: [],
                failedAssetUrls: [],
                reason: "service-worker-error" as const,
                rejectedAssetUrls: [],
                status: "unstaged" as const,
              };
            })
          : {
              assetUrls: [],
              failedAssetUrls: [],
              reason: "no-entry-html" as const,
              rejectedAssetUrls: [],
              status: "unstaged" as const,
            };

      return {
        assetCount: stagingResult.assetUrls?.length ?? 0,
        failedAssetCount: stagingResult.failedAssetUrls?.length ?? 0,
        reason:
          stagingResult.status === "unstaged"
            ? stagingResult.reason
            : undefined,
        rejectedAssetCount: stagingResult.rejectedAssetUrls?.length ?? 0,
        status: stagingResult.status,
      };
    }

    function reportVersionCheckerUpdate(
      event: VersionCheckerUpdateDetectedEvent,
      stagingResult: UpdateStagingDiagnostics,
    ) {
      reportUpdateDetected({
        assetCount: stagingResult.assetCount,
        currentBuildId: event.currentBuildId,
        failedAssetCount: stagingResult.failedAssetCount,
        pendingBuildId: event.pendingBuildId,
        rejectedAssetCount: stagingResult.rejectedAssetCount,
        stagingReason: stagingResult.reason,
        stagingStatus: stagingResult.status,
      });
    }

    return () => {
      sequencer.stop();
      versionChecker.stop();
    };
  }, [getSnapshot, reportDetectorFailed, reportUpdateDetected]);

  return null;
}
