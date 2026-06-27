import { useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type { CommandResult } from "~/shared/commandResult";
import { presentCommandToast } from "~/src/lib/errors/presentCommandToast";
import { runCommand } from "~/src/lib/errors/runCommand";

export type StoreScheduleDayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type StoreScheduleWindowInput = {
  closeTime: string;
  openTime: string;
};

export type StoreScheduleWeeklyDayInput = {
  closed: boolean;
  day: StoreScheduleDayKey;
  windows: StoreScheduleWindowInput[];
};

export type StoreScheduleExceptionInput = {
  closed: boolean;
  date: string;
  label?: string;
  windows: StoreScheduleWindowInput[];
};

export type StoreScheduleUpsertPayload = {
  dateExceptions: Array<{
    closed: boolean;
    localDate: string;
    note?: string;
    windows: Array<{
      endMinute: number;
      startMinute: number;
    }>;
  }>;
  effectiveFrom: number;
  supersedesScheduleId?: Id<"storeSchedule">;
  timezone: string;
  weeklyClosedDays: number[];
  weeklyWindows: Array<{
    dayOfWeek: number;
    endMinute: number;
    startMinute: number;
  }>;
};

type UpdateScheduleOptions = {
  errorMessage?: string;
  onError?: (error: Error) => void;
  onSuccess?: () => void;
  schedule: StoreScheduleUpsertPayload;
  storeId: Id<"store">;
  successMessage?: string;
};

type UpsertStoreScheduleCommand = FunctionReference<
  "mutation",
  "public",
  { storeId: Id<"store"> } & StoreScheduleUpsertPayload,
  CommandResult<unknown>
>;

const storeScheduleApi = (
  api as unknown as {
    inventory: {
      storeSchedule: {
        upsertStoreScheduleCommand: UpsertStoreScheduleCommand;
      };
    };
  }
).inventory.storeSchedule;

export const useStoreScheduleUpdate = () => {
  const [isUpdating, setIsUpdating] = useState(false);
  const upsertStoreSchedule = useMutation(
    storeScheduleApi.upsertStoreScheduleCommand,
  );

  const updateSchedule = async ({
    errorMessage = "Store hours were not saved. Review the highlighted fields.",
    onError,
    onSuccess,
    schedule,
    storeId,
    successMessage = "Store hours saved.",
  }: UpdateScheduleOptions) => {
    setIsUpdating(true);

    try {
      const result = await runCommand(() =>
        upsertStoreSchedule({
          ...schedule,
          storeId,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        onError?.(new Error(result.error.message));
        return;
      }

      toast.success(successMessage, { position: "top-right" });
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast.error(errorMessage, {
        description: (error as Error).message,
        position: "top-right",
      });
      onError?.(error as Error);
    } finally {
      setIsUpdating(false);
    }
  };

  return { isUpdating, updateSchedule };
};
