import type { PosLocalStorePort } from "@/lib/pos/application/posLocalStorePort";
import type { PosLocalEventRecord } from "@/lib/pos/application/posLocalStoreTypes";
import type { PosUploadPageDiagnostics } from "../../../../../shared/posUploadPageDiagnostics";
import { resolvePosLocalTerminalScope } from "./terminalScope";

export async function collectUploadPageDiagnostics(input: {
  store: PosLocalStorePort;
  storeId: string;
  terminalId: string;
  isDrainCandidate: (event: PosLocalEventRecord) => boolean;
  isActivityCandidate: (event: PosLocalEventRecord) => boolean;
}): Promise<PosUploadPageDiagnostics> {
  const startedAt = Date.now();
  const seed = await input.store.readProvisionedTerminalSeed();
  if (!seed.ok) throw new Error("Diagnostic terminal scope read failed.");
  const scope = resolvePosLocalTerminalScope({
    ...input,
    terminalSeed: seed.value,
  });
  const pages: PosUploadPageDiagnostics["pages"] = [];
  for (const terminalId of scope.terminalIds) {
    let afterSequence: number | undefined;
    for (let pageIndex = 0; pageIndex < 2; pageIndex += 1) {
      const result = await input.store.listEventsForUpload({
        storeId: input.storeId,
        terminalId,
        limit: 250,
        includeReviewEvents: false,
        ...(afterSequence !== undefined ? { afterSequence } : {}),
      });
      if (!result.ok) throw new Error("Diagnostic upload page read failed.");
      const events = result.value;
      pages.push({
        terminalId,
        pageIndex,
        ...(afterSequence !== undefined ? { afterSequence } : {}),
        fullPage: events.length === 250,
        events: events.map((event) => ({
          localEventId: event.localEventId,
          type: event.type,
          sequence: event.sequence,
          ...(event.uploadSequence !== undefined
            ? { uploadSequence: event.uploadSequence }
            : {}),
          syncStatus: event.sync.status,
          ...(event.sync.uploaded !== undefined
            ? { uploaded: event.sync.uploaded }
            : {}),
          ...(event.activity ? { activityStatus: event.activity.status } : {}),
          ...(event.activity?.reasonCode
            ? { activityReasonCode: event.activity.reasonCode }
            : {}),
          drainCandidate: input.isDrainCandidate(event),
          activityCandidate: input.isActivityCandidate(event),
        })),
      });
      if (events.length < 250) break;
      afterSequence = events.at(-1)?.sequence;
    }
  }
  return {
    version: 1,
    startedAt,
    completedAt: Date.now(),
    pageSize: 250,
    includeReviewEvents: false,
    pages,
  };
}
