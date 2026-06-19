import type { UpdateStagingDiagnostics } from "./updateCoordinator";

export type UpdateDetectionSequencerEvent = {
  pendingBuildId: string;
};

export function createUpdateDetectionSequencer<
  TEvent extends UpdateDetectionSequencerEvent,
  TStagingResult extends UpdateStagingDiagnostics = UpdateStagingDiagnostics,
>({
  report,
  stage,
}: {
  report: (event: TEvent, stagingResult: TStagingResult) => void;
  stage: (event: TEvent) => Promise<TStagingResult>;
}) {
  let generation = 0;
  let stopped = false;

  async function handle(event: TEvent) {
    generation += 1;
    const detectionGeneration = generation;
    const stagingResult = await stage(event);

    if (!stopped && detectionGeneration === generation) {
      report(event, stagingResult);
    }
  }

  return {
    handle,
    stop() {
      stopped = true;
    },
  };
}
