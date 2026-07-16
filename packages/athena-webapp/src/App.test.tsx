import { render, waitFor } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createVersionChecker: vi.fn(),
  getSnapshot: vi.fn(() => ({ pendingBuildId: null, status: "current" })),
  reportDetectorFailed: vi.fn(),
  reportUpdateDetected: vi.fn(),
  stageUpdateStaticAssets: vi.fn(),
  storageRuntime: {},
  storageRuntimeProvider: vi.fn(),
  appMessagesProvider: vi.fn(),
  convexAuthProvider: vi.fn(),
  queryClientProvider: vi.fn(),
  updateCoordinatorProvider: vi.fn(),
}));

vi.mock("./appRouter", () => ({
  convex: {},
  queryClient: {},
  router: {},
}));

vi.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({ children }: { children?: React.ReactNode }) => {
    mocks.convexAuthProvider();
    return <>{children}</>;
  },
}));

vi.mock("@tanstack/react-query", () => ({
  QueryClientProvider: ({ children }: { children?: React.ReactNode }) => {
    mocks.queryClientProvider();
    return <>{children}</>;
  },
}));

vi.mock("./lib/app-messages", () => ({
  AppMessagesProvider: ({ children }: { children?: React.ReactNode }) => {
    mocks.appMessagesProvider();
    return <>{children}</>;
  },
}));

vi.mock("@tanstack/react-router", () => ({
  RouterProvider: () => <div>router rendered</div>,
}));

vi.mock("./lib/pos/infrastructure/local/posLocalStorageRuntime", () => ({
  getDefaultPosLocalStorageRuntime: () => mocks.storageRuntime,
}));

vi.mock("./lib/pos/infrastructure/local/posLocalStorageRuntimeContext", () => ({
  PosLocalStorageRuntimeProvider: ({
    children,
    runtime,
  }: {
    children?: React.ReactNode;
    runtime: unknown;
  }) => {
    mocks.storageRuntimeProvider(runtime);
    return <>{children}</>;
  },
}));

vi.mock("./utils/versionChecker", () => ({
  createVersionChecker: mocks.createVersionChecker,
}));

vi.mock("./lib/app-update/updateDetectionSequencer", () => ({
  createUpdateDetectionSequencer: ({
    report,
    stage,
  }: {
    report: (event: unknown, diagnostics: unknown) => void;
    stage: (event: unknown) => Promise<unknown>;
  }) => ({
    async handle(event: unknown) {
      report(event, await stage(event));
    },
    stop: vi.fn(),
  }),
}));

vi.mock("./lib/app-update", () => ({
  stageUpdateStaticAssets: mocks.stageUpdateStaticAssets,
  UpdateCoordinatorProvider: ({ children }: { children?: React.ReactNode }) => {
    mocks.updateCoordinatorProvider();
    return <>{children}</>;
  },
  useUpdateCoordinator: () => ({
    getSnapshot: mocks.getSnapshot,
    reportDetectorFailed: mocks.reportDetectorFailed,
    reportUpdateDetected: mocks.reportUpdateDetected,
  }),
}));

import { App, VersionCheckerBridge } from "./App";
import type { VersionCheckerUpdateDetectedEvent } from "./utils/versionChecker";

describe("VersionCheckerBridge", () => {
  it("reports staged update asset diagnostics through the coordinator", async () => {
    mocks.stageUpdateStaticAssets.mockResolvedValue({
      assetUrls: ["/assets/app.js", "/assets/app.css"],
      failedAssetUrls: ["/assets/missing.js"],
      rejectedAssetUrls: ["/assets/remote.js"],
      status: "staged",
    });
    mocks.createVersionChecker.mockReturnValue({ stop: vi.fn() });

    render(<VersionCheckerBridge />);

    const update = getUpdateDetectedCallback();
    update({
      currentBuildId: "build-current",
      detectionSource: "html",
      pendingBuildId: "build-next",
      staging: {
        entryHtml: '<script src="/assets/app.js"></script>',
        entryUrl: "/index.html",
      },
    });

    await waitFor(() =>
      expect(mocks.reportUpdateDetected).toHaveBeenCalledWith({
        assetCount: 2,
        currentBuildId: "build-current",
        failedAssetCount: 1,
        pendingBuildId: "build-next",
        rejectedAssetCount: 1,
        stagingReason: undefined,
        stagingStatus: "staged",
      }),
    );
  });

  it("reports missing entry HTML as an unstaged update", async () => {
    mocks.createVersionChecker.mockReturnValue({ stop: vi.fn() });

    render(<VersionCheckerBridge />);

    const update = getUpdateDetectedCallback();
    update({
      currentBuildId: "build-current",
      detectionSource: "html",
      pendingBuildId: "build-next",
    });

    await waitFor(() =>
      expect(mocks.reportUpdateDetected).toHaveBeenCalledWith(
        expect.objectContaining({
          assetCount: 0,
          failedAssetCount: 0,
          rejectedAssetCount: 0,
          stagingReason: "no-entry-html",
          stagingStatus: "unstaged",
        }),
      ),
    );
  });

  it("reports service worker staging failures as unstaged updates", async () => {
    mocks.stageUpdateStaticAssets.mockRejectedValue(
      new Error("sw unavailable"),
    );
    mocks.createVersionChecker.mockReturnValue({ stop: vi.fn() });

    render(<VersionCheckerBridge />);

    const update = getUpdateDetectedCallback();
    update({
      currentBuildId: "build-current",
      detectionSource: "html",
      pendingBuildId: "build-next",
      staging: {
        entryHtml: '<script src="/assets/app.js"></script>',
        entryUrl: "/index.html",
      },
    });

    await waitFor(() =>
      expect(mocks.reportUpdateDetected).toHaveBeenCalledWith(
        expect.objectContaining({
          assetCount: 0,
          failedAssetCount: 0,
          rejectedAssetCount: 0,
          stagingReason: "service-worker-error",
          stagingStatus: "unstaged",
        }),
      ),
    );
  });
});

describe("App", () => {
  it("provides one process-level POS storage runtime without blocking routes", () => {
    mocks.createVersionChecker.mockReturnValue({ stop: vi.fn() });

    const view = render(<App />);

    expect(mocks.storageRuntimeProvider).toHaveBeenCalledWith(
      mocks.storageRuntime,
    );
    expect(mocks.storageRuntimeProvider).toHaveBeenCalledTimes(1);
    expect(mocks.appMessagesProvider).toHaveBeenCalledTimes(1);
    expect(mocks.updateCoordinatorProvider).toHaveBeenCalledTimes(1);
    expect(mocks.convexAuthProvider).toHaveBeenCalledTimes(1);
    expect(mocks.queryClientProvider).toHaveBeenCalledTimes(1);
    expect(view.getByText("router rendered")).toBeTruthy();
  });
});

function getUpdateDetectedCallback() {
  const options = mocks.createVersionChecker.mock.calls.at(-1)?.[0];
  if (!options?.onUpdateDetected) {
    throw new Error("Version checker was not created.");
  }

  return options.onUpdateDetected as (
    event: VersionCheckerUpdateDetectedEvent,
  ) => void;
}
