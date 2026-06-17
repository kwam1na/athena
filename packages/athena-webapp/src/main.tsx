import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import "./index.css";
import { useEffect } from "react";
import {
  createVersionChecker,
  type VersionCheckerUpdateDetectedEvent,
} from "./utils/versionChecker";
import {
  registerPosAppShellServiceWorker,
  unregisterPosAppShellServiceWorkerForDev,
} from "./offline/registerPosAppShellServiceWorker";
import { removeConvexAuthCodeParamFromUrl } from "./auth/convexAuthUrl";
import { initializeAthenaTheme } from "./lib/theme";
import {
  stageUpdateStaticAssets,
  UpdateCoordinatorProvider,
  useUpdateCoordinator,
  type UpdateStagingStatus,
} from "./lib/app-update";
import { createUpdateDetectionSequencer } from "./lib/app-update/updateDetectionSequencer";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
    },
  },
});

// Set up a Router instance
const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
});

// Register things for typesafety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// App wrapper component to handle version checking
function App() {
  return (
    <UpdateCoordinatorProvider>
      <VersionCheckerBridge />
      <ConvexAuthProvider client={convex}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ConvexAuthProvider>
    </UpdateCoordinatorProvider>
  );
}

function VersionCheckerBridge() {
  const { reportUpdateDetected, reportDetectorFailed } = useUpdateCoordinator();

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
    });

    async function stageVersionCheckerUpdate(
      event: VersionCheckerUpdateDetectedEvent,
    ): Promise<UpdateStagingStatus> {
      const stagingResult =
        event.staging?.entryHtml && event.staging.entryUrl
          ? await stageUpdateStaticAssets({
              entryHtml: event.staging.entryHtml,
              entryUrl: event.staging.entryUrl,
            }).catch((error) => {
              console.warn("Failed to stage update assets:", error);
              return { status: "unstaged" as const };
            })
          : { status: "unstaged" as const };

      return stagingResult.status;
    }

    function reportVersionCheckerUpdate(
      event: VersionCheckerUpdateDetectedEvent,
      stagingStatus: UpdateStagingStatus,
    ) {
      reportUpdateDetected({
        currentBuildId: event.currentBuildId,
        pendingBuildId: event.pendingBuildId,
        stagingStatus,
      });
    }

    return () => {
      sequencer.stop();
      versionChecker.stop();
    };
  }, [reportDetectorFailed, reportUpdateDetected]);

  return null;
}

const rootElement = document.getElementById("app")!;

if (!rootElement.innerHTML) {
  initializeAthenaTheme();
  removeConvexAuthCodeParamFromUrl();
  if (import.meta.env.DEV) {
    unregisterPosAppShellServiceWorkerForDev();
  } else {
    registerPosAppShellServiceWorker();
  }
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}
