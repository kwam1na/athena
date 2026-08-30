/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { expect, it, vi } from "vitest";
import schema from "../schema";
import { dispatchReportPipeline } from "./pipelineDispatchRoot";
import { recordReadCosts } from "./readCostTestSupport";

const modules = import.meta.glob("../**/*.ts");

it("schedules the same fourteen independent lanes with no database reads or extra dispatcher hop", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const scheduled: string[] = [];
    const recorder = recordReadCosts({
      ...ctx,
      scheduler: {
        ...ctx.scheduler,
        runAfter: vi.fn(async (delay, reference, args) => {
          expect(delay).toBe(0);
          expect(args).toEqual({});
          scheduled.push(getFunctionName(reference));
          return "captured-schedule" as never;
        }),
      },
    });
    expect(await dispatchReportPipeline(recorder.ctx)).toEqual({
      lanesScheduled: 14,
    });
    expect(scheduled).toEqual([
      "reports/pipelineDispatch:dispatchDays",
      "reports/pipelineDispatch:dispatchLegacy",
      "reports/pipelineDispatch:dispatchCloseEvidence",
      "reports/pipelineDispatch:dispatchOverview",
      "reports/pipelineDispatch:maintenance",
      "reports/pipelineDispatch:dispatchResolveWeekDate",
      "reports/pipelineDispatch:dispatchCurrent",
      "reports/pipelineDispatch:dispatchAccept",
      "reports/pipelineDispatch:dispatchRefresh",
      "reports/pipelineDispatch:dispatchInventory",
      "reports/pipelineDispatch:dispatchRollup",
      "reports/pipelineDispatch:dispatchWeeklyRecovery",
      "reports/pipelineDispatch:dispatchSummaryRanges",
      "reports/pipelineDispatch:dispatchRetention",
    ]);
    expect(recorder.snapshot().total).toEqual({
      calls: 0,
      returnedDocuments: 0,
      serializedBytes: 0,
    });
  });
});
