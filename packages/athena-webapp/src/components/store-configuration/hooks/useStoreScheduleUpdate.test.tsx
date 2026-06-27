import { act, renderHook, waitFor } from "@testing-library/react";
import { useMutation } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { userError } from "~/shared/commandResult";
import { useStoreScheduleUpdate } from "./useStoreScheduleUpdate";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    inventory: {
      storeSchedule: {
        upsertStoreScheduleCommand: "upsertStoreScheduleCommand",
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const mockedUseMutation = vi.mocked(useMutation);
const upsertStoreSchedule = vi.fn();

describe("useStoreScheduleUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertStoreSchedule.mockReset();
    mockedUseMutation.mockReturnValue(upsertStoreSchedule as never);
  });

  it("saves through the store schedule command instead of store config", async () => {
    upsertStoreSchedule.mockResolvedValue({
      kind: "ok",
      data: { scheduleId: "schedule-1" },
    });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useStoreScheduleUpdate());

    await act(async () => {
      await result.current.updateSchedule({
        storeId: "store-1" as never,
        schedule: {
          dateExceptions: [],
          effectiveFrom: 1_782_528_000_000,
          timezone: "America/New_York",
          weeklyClosedDays: [0],
          weeklyWindows: [
            {
              dayOfWeek: 1,
              endMinute: 17 * 60,
              startMinute: 9 * 60,
            },
          ],
        },
        onSuccess,
      });
    });

    expect(mockedUseMutation).toHaveBeenCalledWith("upsertStoreScheduleCommand");
    expect(upsertStoreSchedule).toHaveBeenCalledWith({
      dateExceptions: [],
      effectiveFrom: 1_782_528_000_000,
      storeId: "store-1",
      timezone: "America/New_York",
      weeklyClosedDays: [0],
      weeklyWindows: [
        {
          dayOfWeek: 1,
          endMinute: 17 * 60,
          startMinute: 9 * 60,
        },
      ],
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("surfaces command validation errors without reporting a successful save", async () => {
    upsertStoreSchedule.mockResolvedValue(
      userError({
        code: "validation_failed",
        fields: {
          timezone: ["Choose a valid store timezone."],
        },
        message: "Store hours were not saved. Review the highlighted fields.",
      }),
    );
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useStoreScheduleUpdate());

    await act(async () => {
      await result.current.updateSchedule({
        storeId: "store-1" as never,
        schedule: {
          dateExceptions: [],
          effectiveFrom: 1_782_528_000_000,
          timezone: "",
          weeklyClosedDays: [],
          weeklyWindows: [],
        },
        onError,
        onSuccess,
      });
    });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
