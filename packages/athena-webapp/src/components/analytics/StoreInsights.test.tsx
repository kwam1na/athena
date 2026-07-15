import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StoreInsights from "./StoreInsights";

const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const useQueryMock = vi.fn();
const useSharedDemoContextMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/hooks/useSharedDemoContext", () => ({
  isSharedDemoUiEnabled: true,
  useSharedDemoContext: () => useSharedDemoContextMock(),
}));

describe("StoreInsights", () => {
  const generateInsights = vi.fn();
  const dismissArtifact = vi.fn();
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

    return render(<StoreInsights storeId={"store-1" as never} />);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    generateInsights.mockResolvedValue({ kind: "ok" });
    dismissArtifact.mockResolvedValue(undefined);
    useActionMock.mockReturnValue(generateInsights);
    useMutationMock.mockReturnValue(dismissArtifact);
    useQueryMock.mockReturnValue(null);
    useSharedDemoContextMock.mockReturnValue(null);
  });

  it("skips unsupported intelligence queries in the shared demo", () => {
    useSharedDemoContextMock.mockReturnValue({ storeId: "store-1" });

    renderWithQueries();

    expect(useQueryMock).toHaveBeenCalledTimes(2);
    expect(useQueryMock.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      "skip",
    ]);
    expect(screen.queryByRole("region", { name: "Store insights" })).toBeNull();
  });

  it("renders an empty store readout state with a generate action", async () => {
    renderWithQueries();

    expect(screen.getByText("No store readout yet")).toBeTruthy();
    expect(screen.getByText("Generate readout")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Generate readout" }));

    expect(generateInsights).toHaveBeenCalledWith({ storeId: "store-1" });
  });

  it("renders the latest artifact as a reviewable operator readout", () => {
    renderWithQueries({
      artifact: {
        _id: "artifact-1",
        status: "ready",
        createdAt: Date.UTC(2026, 5, 21, 12, 0, 0),
        dataWindowStartAt: Date.UTC(2026, 5, 20, 0, 0, 0),
        dataWindowEndAt: Date.UTC(2026, 5, 21, 0, 0, 0),
        confidence: 0.75,
        evidenceRefs: [{ table: "contextEvent", id: "event-1" }],
        limitedEvidence: true,
        payload: {
          activity_trend: "increasing",
          device_distribution: {
            desktop: "65%",
            mobile: "35%",
          },
          peak_activity_times: "Afternoon traffic is strongest.",
          popular_actions: ["view_product", "start_checkout"],
          recommendations: [
            "Move high-interest wigs closer to the storefront hero.",
            "Check checkout follow-up for active carts.",
          ],
          rationale: "Product views and checkout starts moved together.",
          summary: "Customer interest is active, but checkout movement needs review.",
        },
      },
    });

    expect(screen.getByText("Recommended next move")).toBeTruthy();
    expect(
      screen.getByText("Customer interest is active, but checkout movement needs review."),
    ).toBeTruthy();
    expect(
      screen.getByText("Move high-interest wigs closer to the storefront hero."),
    ).toBeTruthy();
    expect(screen.getByText("75% confidence")).toBeTruthy();
    expect(screen.getByText("1 refs · limited")).toBeTruthy();
    expect(screen.getByText("view product")).toBeTruthy();
  });

  it("dismisses the current artifact from the readout controls", async () => {
    renderWithQueries({
      artifact: {
        _id: "artifact-1",
        status: "ready",
        createdAt: Date.UTC(2026, 5, 21, 12, 0, 0),
        confidence: 0.5,
        evidenceRefs: [],
        payload: {
          activity_trend: "steady",
          device_distribution: {
            desktop: "50%",
            mobile: "50%",
          },
          peak_activity_times: "No clear peak yet.",
          popular_actions: [],
          recommendations: ["Review storefront activity again later."],
          summary: "Storefront activity is steady.",
        },
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss store readout" }),
    );

    await waitFor(() => {
      expect(dismissArtifact).toHaveBeenCalledWith({ artifactId: "artifact-1" });
    });
  });

  it("shows inline copy when generation rejects unexpectedly", async () => {
    generateInsights.mockRejectedValue(new Error("Convex action failed"));

    renderWithQueries();

    await userEvent.click(screen.getByRole("button", { name: "Generate readout" }));

    expect(
      await screen.findByText(
        "Store readout could not be generated. Try again in a moment.",
      ),
    ).toBeTruthy();
  });

  it("shows inline copy when generation returns an action error", async () => {
    generateInsights.mockResolvedValue({
      kind: "error",
      message: "A readout was just requested. Wait a moment, then try again.",
    });

    renderWithQueries();

    await userEvent.click(screen.getByRole("button", { name: "Generate readout" }));

    expect(
      await screen.findByText(
        "A readout was just requested. Wait a moment, then try again.",
      ),
    ).toBeTruthy();
  });

  it("shows the latest intelligence run details in the debug drawer", async () => {
    renderWithQueries({
      debug: {
        run: {
          _id: "run-1",
          attemptCount: 1,
          capability: "storeInsights",
          contextSnapshotId: "snapshot-1",
          createdAt: Date.UTC(2026, 5, 21, 12, 0, 0),
          idempotencyKey: "storeInsights:store-1:hash-1",
          providerKey: "tanstack-openai",
          providerModel: "gpt-4.1-mini",
          snapshotHash: "hash-1",
          status: "failed",
          trigger: "compatibility",
          updatedAt: Date.UTC(2026, 5, 21, 12, 1, 0),
          visibilityMode: "store_admin",
          error: {
            code: "provider_failure",
            message: "The intelligence provider could not complete the request.",
            retryable: true,
          },
        },
        snapshot: {
          _id: "snapshot-1",
          bundleKind: "store_insights_context",
          bundleVersion: 1,
          createdAt: Date.UTC(2026, 5, 21, 12, 0, 10),
          dataWindowStartAt: Date.UTC(2026, 5, 20, 12, 0, 0),
          dataWindowEndAt: Date.UTC(2026, 5, 21, 12, 0, 0),
          freshness: "partial",
          hiddenSourceCount: 2,
          limitedEvidence: true,
          omittedEvidenceCount: 1,
          payloadRedaction: "context events compacted; unsafe fields omitted",
          payloadSummary: {
            activityTrend: "steady",
            compactContextEvents: { type: "array", count: 12 },
          },
          qualityFlags: ["context_events_compiled", "limited_storefront_context"],
          redactionMode: "compact_no_contact_fields",
          snapshotHash: "hash-1",
          sourceRefCount: 1,
        },
        artifact: null,
        providerInvocations: [
          {
            _id: "invocation-1",
            error: {
              code: "provider_failure",
              message: "The intelligence provider could not complete the request.",
              retryable: true,
            },
            providerKey: "tanstack-openai",
            providerModel: "gpt-4.1-mini",
            rawPayloadStored: false,
            requestSummary: {
              failureCode: "provider_failure",
            },
            startedAt: Date.UTC(2026, 5, 21, 12, 1, 0),
            status: "failed",
          },
        ],
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: /Intelligence debug/ }),
    );

    expect(screen.getByText("Run error")).toBeTruthy();
    expect(screen.getAllByText("provider_failure").length).toBeGreaterThan(0);
    expect(screen.queryByText("Cannot find module @tanstack/ai")).toBeNull();
    expect(screen.getByText(/context events compacted/)).toBeTruthy();
    expect(screen.getByText("1 refs · limited")).toBeTruthy();
    expect(screen.getByText(/limited_storefront_context/)).toBeTruthy();
    expect(screen.getByText(/failureCode/)).toBeTruthy();
  });
});
