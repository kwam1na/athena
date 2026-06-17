import type { UpdateStagingStatus } from "./updateCoordinator";

export type UpdateDetectionSequencerEvent = {
  pendingBuildId: string;
};

export function createUpdateDetectionSequencer<TEvent extends UpdateDetectionSequencerEvent>({
  report,
  stage,
}: {
  report: (event: TEvent, stagingStatus: UpdateStagingStatus) => void;
  stage: (event: TEvent) => Promise<UpdateStagingStatus>;
}) {
  let generation = 0;
  let stopped = false;

  async function handle(event: TEvent) {
    generation += 1;
    const detectionGeneration = generation;
    const stagingStatus = await stage(event);

    if (!stopped && detectionGeneration === generation) {
      report(event, stagingStatus);
    }
  }

  return {
    handle,
    stop() {
      stopped = true;
    },
  };
}
