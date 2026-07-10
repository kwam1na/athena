import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";

import { useRegisterLifecycleAuthoritySnapshot } from "./registerLifecycleAuthorityGateway";

const mocks = vi.hoisted(() => ({
  acknowledgement: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}));

describe("useRegisterLifecycleAuthoritySnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useMutation.mockReturnValue(mocks.acknowledgement);
    mocks.useQuery.mockReturnValue(undefined);
  });

  it("subscribes to the versioned terminal query with exact bounded candidates", () => {
    renderHook(() =>
      useRegisterLifecycleAuthoritySnapshot({
        candidates: [
          {
            cloudRegisterSessionId: "cloud-register-1",
            localRegisterSessionId: "local-register-1",
          },
        ],
        storeId: "store-1" as Id<"store">,
        syncSecretHash: "sync-secret-1",
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    );

    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.anything(),
      {
        candidates: [
          {
            cloudRegisterSessionId: "cloud-register-1",
            localRegisterSessionId: "local-register-1",
          },
        ],
        storeId: "store-1",
        syncSecretHash: "sync-secret-1",
        terminalId: "terminal-1",
      },
    );
  });

  it("skips without a complete terminal proof", () => {
    renderHook(() => useRegisterLifecycleAuthoritySnapshot("skip"));

    expect(mocks.useQuery).toHaveBeenCalledWith(expect.anything(), "skip");
  });

  it("exposes the focused terminal acknowledgement mutation", async () => {
    const { useRegisterLifecycleAuthorityAcknowledgement } = await import(
      "./registerLifecycleAuthorityGateway"
    );
    const { result } = renderHook(() =>
      useRegisterLifecycleAuthorityAcknowledgement(),
    );

    expect(result.current).toBe(mocks.acknowledgement);
    expect(mocks.useMutation).toHaveBeenCalledWith(expect.anything());
  });
});
