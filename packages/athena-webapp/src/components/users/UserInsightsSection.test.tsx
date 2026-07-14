import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserInsightsSection } from "./UserInsightsSection";

const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const useQueryMock = vi.fn();
const useParamsMock = vi.fn();
const getActiveStoreMock = vi.fn();
const sharedDemoContextMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: (...args: unknown[]) => useParamsMock(...args),
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => getActiveStoreMock(),
}));

vi.mock("~/src/hooks/useSharedDemoContext", () => ({
  isSharedDemoUiEnabled: true,
  useSharedDemoContext: () => sharedDemoContextMock(),
}));

describe("UserInsightsSection", () => {
  const dismissArtifact = vi.fn();
  const generateUserInsights = vi.fn();
  const renderWithQueries = ({
    artifact = null,
    debug = null,
  }: {
    artifact?: unknown;
    debug?: unknown;
  } = {}) => {
    useQueryMock.mockImplementation((_query: unknown, args: { kind?: string }) =>
      args?.kind ? artifact : debug,
    );

    return render(<UserInsightsSection />);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dismissArtifact.mockResolvedValue(undefined);
    generateUserInsights.mockResolvedValue({ kind: "ok" });
    useActionMock.mockReturnValue(generateUserInsights);
    useMutationMock.mockReturnValue(dismissArtifact);
    useParamsMock.mockReturnValue({ userId: "user-1" });
    getActiveStoreMock.mockReturnValue({
      activeStore: { _id: "store-1" },
    });
    sharedDemoContextMock.mockReturnValue(null);
  });

  it("shared-demo-intelligence skips full-admin intelligence queries", () => {
    sharedDemoContextMock.mockReturnValue({ storeId: "store-1" });

    renderWithQueries();

    expect(useQueryMock).toHaveBeenCalledTimes(2);
    expect(useQueryMock.mock.calls.every(([, args]) => args === "skip")).toBe(
      true,
    );
    expect(screen.queryByRole("region", { name: "Customer insights" })).toBeNull();
  });

  it("generates a customer readout for the selected user", async () => {
    renderWithQueries();

    await userEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(generateUserInsights).toHaveBeenCalledWith({
      storeId: "store-1",
      storeFrontUserId: "user-1",
    });
  });

  it("shows inline copy when generation returns an action error", async () => {
    generateUserInsights.mockResolvedValue({
      kind: "error",
      message: "A readout was just requested. Wait a moment, then try again.",
    });

    renderWithQueries();

    await userEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(
      await screen.findByText(
        "A readout was just requested. Wait a moment, then try again.",
      ),
    ).toBeTruthy();
  });

  it("renders the latest customer readout and dismisses it", async () => {
    renderWithQueries({
      artifact: {
        _id: "artifact-1",
        confidence: 0.75,
        createdAt: Date.UTC(2026, 5, 21, 12, 0, 0),
        evidenceRefs: [{ table: "contextEvent", id: "event-1" }],
        status: "ready",
        payload: {
          activity_status: "active",
          device_preference: "desktop",
          engagement_level: "high",
          likely_intent: "Pickup order follow-up",
          recommendations: ["Confirm the pickup status before outreach."],
          summary: "This customer is active around a pickup order.",
        },
      },
    });

    expect(screen.getByText("This customer is active around a pickup order.")).toBeTruthy();
    expect(screen.getByText("Pickup order follow-up")).toBeTruthy();
    expect(screen.getByText("Confirm the pickup status before outreach.")).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss customer readout" }),
    );

    await waitFor(() => {
      expect(dismissArtifact).toHaveBeenCalledWith({ artifactId: "artifact-1" });
    });
  });

  it("shows scoped customer run debug details", async () => {
    renderWithQueries({
      debug: {
        artifact: null,
        providerInvocations: [
          {
            _id: "provider-1",
            error: {
              code: "provider_failure",
              message: "The intelligence provider could not complete the request.",
              retryable: true,
            },
            providerKey: "tanstack-openai",
            providerModel: "gpt-4.1-mini",
            rawPayloadStored: false,
            requestSummary: { failureCode: "provider_failure" },
            startedAt: Date.UTC(2026, 5, 21, 12, 0, 0),
            status: "failed",
          },
        ],
        run: {
          _id: "run-1",
          attemptCount: 1,
          capability: "userInsights",
          createdAt: Date.UTC(2026, 5, 21, 12, 0, 0),
          error: {
            code: "provider_failure",
            message: "The intelligence provider could not complete the request.",
            retryable: true,
          },
          idempotencyKey: "userInsights:store-1:user-1:hash",
          providerKey: "tanstack-openai",
          providerModel: "gpt-4.1-mini",
          snapshotHash: "hash",
          status: "failed",
          trigger: "compatibility",
          updatedAt: Date.UTC(2026, 5, 21, 12, 1, 0),
          visibilityMode: "store_admin",
        },
        snapshot: {
          _id: "snapshot-1",
          createdAt: Date.UTC(2026, 5, 21, 12, 0, 0),
          dataWindowStartAt: Date.UTC(2026, 5, 20, 12, 0, 0),
          dataWindowEndAt: Date.UTC(2026, 5, 21, 12, 0, 0),
          freshness: "current",
          hiddenSourceCount: 0,
          limitedEvidence: false,
          omittedEvidenceCount: 0,
          payloadRedaction: "context events compacted; unsafe fields omitted",
          payloadSummary: { contextEventCount: 4 },
          qualityFlags: ["context_events_compiled"],
          redactionMode: "compact_no_contact_fields",
          snapshotHash: "hash",
          sourceRefCount: 1,
        },
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: /Intelligence debug/ }),
    );

    expect(screen.getByText("Run error")).toBeTruthy();
    expect(screen.queryByText("Relative import path @tanstack/ai")).toBeNull();
    expect(screen.getByText(/context events compacted/)).toBeTruthy();
    expect(screen.getByText(/context_events_compiled/)).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        capability: "userInsights",
        sourceRefId: "user-1",
        sourceRefTable: "storeFrontActor",
        storeId: "store-1",
      }),
    );
  });
});
