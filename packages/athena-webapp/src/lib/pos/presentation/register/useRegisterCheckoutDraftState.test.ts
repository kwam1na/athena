import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRegisterCheckoutDraftState } from "./useRegisterCheckoutDraftState";

const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

describe("useRegisterCheckoutDraftState", () => {
  beforeEach(() => {
    toastError.mockReset();
  });

  it("keeps payment state and the mutable payment ref in sync", () => {
    const { result } = renderHook(() => useRegisterCheckoutDraftState());

    act(() => {
      result.current.setPaymentState([
        {
          id: "payment-1",
          method: "cash",
          amount: 25,
          timestamp: 1,
        },
      ]);
    });

    expect(result.current.payments).toEqual([
      {
        id: "payment-1",
        method: "cash",
        amount: 25,
        timestamp: 1,
      },
    ]);
    expect(result.current.paymentsRef.current).toEqual(result.current.payments);
  });

  it("allocates monotonic checkout versions and can reset the version clock", () => {
    const { result } = renderHook(() => useRegisterCheckoutDraftState());

    const first = result.current.allocateCheckoutStateVersion();
    const second = result.current.allocateCheckoutStateVersion();
    result.current.resetCheckoutStateVersion();
    const afterReset = result.current.allocateCheckoutStateVersion();

    expect(second).toBeGreaterThan(first);
    expect(afterReset).toBeGreaterThan(0);
  });

  it("serializes cart mutations through the queue", async () => {
    const { result } = renderHook(() => useRegisterCheckoutDraftState());
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = result.current.enqueueCartMutation(async () => {
      calls.push("first:start");
      await firstReady;
      calls.push("first:end");
      return true;
    });
    const second = result.current.enqueueCartMutation(async () => {
      calls.push("second");
      return true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["first:start"]);

    releaseFirst();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(calls).toEqual(["first:start", "first:end", "second"]);
  });

  it("blocks queued checkout mutations while a terminal checkout operation holds the lock", async () => {
    const { result } = renderHook(() => useRegisterCheckoutDraftState());

    result.current.checkoutMutationLockedRef.current = true;
    await expect(
      result.current.enqueuePaymentQueueMutation(async () => true),
    ).resolves.toBe(false);

    expect(toastError).toHaveBeenCalledWith(
      "Finish the current checkout update before changing payments.",
    );
  });
});
