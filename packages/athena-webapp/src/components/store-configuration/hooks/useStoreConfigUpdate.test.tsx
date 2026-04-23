import { act, renderHook, waitFor } from "@testing-library/react";
import { useMutation } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useStoreConfigUpdate } from "./useStoreConfigUpdate";
import { userError } from "~/shared/commandResult";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const mockedUseMutation = vi.mocked(useMutation);
const patchConfigMutation = vi.fn();

describe("useStoreConfigUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patchConfigMutation.mockReset();
    mockedUseMutation.mockReturnValue(patchConfigMutation as never);
  });

  it("surfaces command user errors instead of treating them as successful saves", async () => {
    patchConfigMutation.mockResolvedValue(
      userError({
        code: "validation_failed",
        message: "Store config patch is invalid.",
      })
    );

    const onSuccess = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useStoreConfigUpdate());

    await act(async () => {
      await result.current.updateConfig({
        storeId: "store-1" as never,
        patch: {
          operations: {
            availability: {
              inMaintenanceMode: true,
            },
          },
        },
        onError,
        onSuccess,
      });
    });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
