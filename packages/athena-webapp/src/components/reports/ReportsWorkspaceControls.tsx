import { useAction, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback, useEffect, useState } from "react";

import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { CustomRangeStatus, type CustomRangeState } from "./CustomRangeStatus";
import {
  ReportPeriodControl,
  type ReportPeriodPreset,
} from "./ReportPeriodControl";

const customRangeApi = (
  api as unknown as {
    reporting: {
      customRangeRequests: {
        getCustomRangeStatus: FunctionReference<"action">;
        requestCustomRange: FunctionReference<"mutation">;
      };
    };
  }
).reporting.customRangeRequests;

type Search = {
  end?: string;
  preset?: ReportPeriodPreset;
  runId?: string;
  start?: string;
};

export function ReportsWorkspaceControls({
  onSearchChange,
  search,
}: {
  onSearchChange: (next: Search) => void;
  search: Search;
}) {
  const { activeStore } = useGetActiveStore();
  const requestCustomRange = useMutation(customRangeApi.requestCustomRange);
  const getCustomRangeStatus = useAction(customRangeApi.getCustomRangeStatus);
  const [requestError, setRequestError] = useState(false);
  const [status, setStatus] = useState<{
    failedCount: number;
    processedCount: number;
    status: string;
  }>();
  const preset = search.preset ?? "wtd";

  const refreshStatus = useCallback(async () => {
    if (!activeStore?._id || !search.runId) return;
    try {
      const result = await getCustomRangeStatus({
        runId: search.runId as Id<"reportingRun">,
        storeId: activeStore._id,
      });
      setStatus(
        result as {
          failedCount: number;
          processedCount: number;
          status: string;
        },
      );
      setRequestError(false);
    } catch {
      setRequestError(true);
    }
  }, [activeStore?._id, getCustomRangeStatus, search.runId]);

  useEffect(() => {
    if (!search.runId) {
      setStatus(undefined);
      return;
    }
    void refreshStatus();
    if (status?.status === "completed" || status?.status === "failed") return;
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, search.runId, status?.status]);

  const submit = useCallback(async () => {
    if (
      !activeStore?._id ||
      !search.start ||
      !search.end ||
      search.start > search.end
    )
      return;
    setRequestError(false);
    try {
      const result = await requestCustomRange({
        endOperatingDate: search.end,
        startOperatingDate: search.start,
        storeId: activeStore._id,
      });
      onSearchChange({
        ...search,
        preset: "custom",
        runId: String((result as { runId: string }).runId),
      });
    } catch {
      setRequestError(true);
    }
  }, [activeStore?._id, onSearchChange, requestCustomRange, search]);

  const customState: CustomRangeState | null = requestError
    ? "failed"
    : !search.runId
      ? null
      : status?.status === "completed"
        ? "completed"
        : status?.status === "failed"
          ? "failed"
          : status?.status === "running"
            ? "running"
            : "pending";

  return (
    <div className="grid gap-layout-md border-b border-border py-layout-md lg:grid-cols-[minmax(0,28rem)_1fr]">
      <ReportPeriodControl
        end={search.end}
        onCustomRangeSubmit={() => {
          void submit();
        }}
        onEndChange={(end) =>
          onSearchChange({ ...search, end, runId: undefined })
        }
        onPresetChange={(nextPreset) =>
          onSearchChange({
            ...search,
            end: nextPreset === "custom" ? search.end : undefined,
            preset: nextPreset,
            runId: undefined,
            start: nextPreset === "custom" ? search.start : undefined,
          })
        }
        onStartChange={(start) =>
          onSearchChange({ ...search, runId: undefined, start })
        }
        preset={preset}
        start={search.start}
      />
      {customState ? (
        <CustomRangeStatus
          onRetry={
            customState === "failed"
              ? () => {
                  void submit();
                }
              : undefined
          }
          state={customState}
        />
      ) : null}
    </div>
  );
}
