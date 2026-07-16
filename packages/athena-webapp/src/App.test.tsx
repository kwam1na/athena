import { act, render, waitFor } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createVersionChecker: vi.fn(),
  getSnapshot: vi.fn(() => ({ pendingBuildId: null, status: "current" })),
  reportDetectorFailed: vi.fn(),
  reportUpdateDetected: vi.fn(),
  stageUpdateStaticAssets: vi.fn(),
  recoverPromotedPosRecoverySession: vi.fn(),
  storageRuntime: {},
  storageRuntimeProvider: vi.fn(),
  appMessagesProvider: vi.fn(),
  convexAuthProvider: vi.fn(),
  queryClientProvider: vi.fn(),
  updateCoordinatorProvider: vi.fn(),
}));

vi.mock("./lib/auth/recoverPromotedPosRecoverySession", () => ({
  recoverPromotedPosRecoverySession: mocks.recoverPromotedPosRecoverySession,
}));

vi.mock("./appRouter", () => ({
  convex: {},
  queryClient: {},
  router: {},
}));

vi.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({
    children,
    storage,
    storageNamespace,
  }: {
    children?: React.ReactNode;
    storage?: unknown;
    storageNamespace?: string;
  }) => {
    mocks.convexAuthProvider({ storage, storageNamespace });
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
import {
  AUTH_RUNTIME_HANDOFF_JOURNAL_KEY,
  createAuthRuntimeHandoffCoordinator,
} from "./lib/auth/authRuntimeHandoff";
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
  it("takes over a stale owner lease instead of remaining permanently blocked", async () => {
    mocks.createVersionChecker.mockReturnValue({ stop: vi.fn() });
    const storage = createMemoryStorage();
    let now = 1_000;
    const owner = createAuthRuntimeHandoffCoordinator({
      now: () => now,
      ownerToken: "previous-tab-owner",
      randomId: () => "previous-tab-generated-12345678",
      storage,
    });
    owner.prepareHandoff({ leaseDurationMs: 100 });
    now = 1_101;
    const recovering = createAuthRuntimeHandoffCoordinator({
      now: () => now,
      ownerToken: "replacement-tab-owner",
      randomId: () => "replacement-tab-generated-12345678",
      storage,
    });

    render(<App authRuntime={recovering} />);

    await waitFor(() =>
      expect(recovering.getSnapshot()).toMatchObject({
        blockReason: null,
        handoffPhase: "prepared",
        status: "ready",
      }),
    );
  });

  it("provides one process-level POS storage runtime without blocking routes", () => {
    mocks.createVersionChecker.mockReturnValue({ stop: vi.fn() });
    const authRuntime = createTestAuthRuntime();

    const view = render(<App authRuntime={authRuntime} />);

    expect(mocks.storageRuntimeProvider).toHaveBeenCalledWith(
      mocks.storageRuntime,
    );
    expect(mocks.storageRuntimeProvider).toHaveBeenCalledTimes(1);
    expect(mocks.appMessagesProvider).toHaveBeenCalledTimes(1);
    expect(mocks.updateCoordinatorProvider).toHaveBeenCalledTimes(1);
    expect(mocks.convexAuthProvider).toHaveBeenCalledTimes(1);
    expect(mocks.convexAuthProvider).toHaveBeenCalledWith({
      storage: expect.any(Object),
      storageNamespace: undefined,
    });
    expect(mocks.queryClientProvider).toHaveBeenCalledTimes(1);
    expect(view.getByText("router rendered")).toBeTruthy();
  });

  it("remounts auth against the promoted namespace", async () => {
    mocks.createVersionChecker.mockReturnValue({ stop: vi.fn() });
    mocks.recoverPromotedPosRecoverySession.mockRejectedValue(
      new Error("verification pending"),
    );
    const authRuntime = createTestAuthRuntime();
    render(<App authRuntime={authRuntime} />);
    let handle!: ReturnType<typeof authRuntime.prepareHandoff>;

    await act(async () => {
      handle = authRuntime.prepareHandoff();
      authRuntime.markAuthIssued(handle);
      authRuntime.markActivated(handle);
      authRuntime.promoteActivated(handle);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.convexAuthProvider).toHaveBeenLastCalledWith({
      storage: expect.any(Object),
      storageNamespace: handle.pendingNamespace,
    });
  });

  it("verifies and completes a promoted journal after reload", async () => {
    mocks.createVersionChecker.mockReturnValue({ stop: vi.fn() });
    mocks.recoverPromotedPosRecoverySession.mockClear();
    mocks.recoverPromotedPosRecoverySession.mockResolvedValue({});
    const storage = createMemoryStorage();
    const beforeReload = createTestAuthRuntime(storage);
    const handle = beforeReload.prepareHandoff();
    beforeReload.markAuthIssued(handle);
    beforeReload.markActivated(handle);
    beforeReload.promoteActivated(handle);
    const afterReload = createTestAuthRuntime(storage);

    render(<App authRuntime={afterReload} />);

    await waitFor(() =>
      expect(afterReload.getSnapshot()).toMatchObject({
        activeNamespace: handle.pendingNamespace,
        handoffPhase: "idle",
        status: "ready",
      }),
    );
    expect(mocks.recoverPromotedPosRecoverySession).toHaveBeenCalledTimes(1);
  });

  it("fails closed before mounting auth for a corrupt journal", () => {
    const storage = createMemoryStorage();
    storage.setItem(AUTH_RUNTIME_HANDOFF_JOURNAL_KEY, "corrupt");
    const authRuntime = createTestAuthRuntime(storage);

    const view = render(<App authRuntime={authRuntime} />);

    expect(view.getByRole("alert")).toHaveTextContent(
      "Authentication is temporarily unavailable",
    );
    expect(mocks.convexAuthProvider).not.toHaveBeenCalled();
    expect(view.queryByText("router rendered")).toBeNull();
  });
});

function createTestAuthRuntime(storage = createMemoryStorage()) {
  let sequence = 0;
  return createAuthRuntimeHandoffCoordinator({
    now: () => 1_000,
    ownerToken: "app-test-owner",
    randomId: () => `app-generated-${++sequence}-12345678`,
    storage,
  });
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function getUpdateDetectedCallback() {
  const options = mocks.createVersionChecker.mock.calls.at(-1)?.[0];
  if (!options?.onUpdateDetected) {
    throw new Error("Version checker was not created.");
  }

  return options.onUpdateDetected as (
    event: VersionCheckerUpdateDetectedEvent,
  ) => void;
}
