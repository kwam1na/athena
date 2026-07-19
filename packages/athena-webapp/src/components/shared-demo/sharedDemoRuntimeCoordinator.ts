type BootstrapJob = {
  epoch: number;
  promise: Promise<void>;
  state: "active" | "observed";
};

const jobs = new Map<string, BootstrapJob>();

export function observeSharedDemoRuntimeEpoch(storeId: string, epoch: number) {
  const current = jobs.get(storeId);
  if (current && epoch <= current.epoch) return;
  jobs.set(storeId, {
    epoch,
    promise: current?.promise.catch(() => undefined) ?? Promise.resolve(),
    state: "observed",
  });
}

export function coordinateSharedDemoRuntime(
  storeId: string,
  epoch: number,
  run: (assertCurrent: () => void) => Promise<void>,
) {
  const current = jobs.get(storeId);
  if (current && epoch < current.epoch) {
    return Promise.resolve();
  }
  if (current && epoch === current.epoch && current.state === "active") {
    return current.promise;
  }

  const predecessor =
    current?.promise.catch(() => undefined) ?? Promise.resolve();
  const assertCurrent = () => {
    if (jobs.get(storeId)?.epoch !== epoch) {
      throw new Error("The demo restore epoch changed during local bootstrap.");
    }
  };
  const promise = predecessor.then(() => {
    assertCurrent();
    return run(assertCurrent);
  });
  jobs.set(storeId, { epoch, promise, state: "active" });
  void promise.catch(() => {
    if (jobs.get(storeId)?.promise === promise) jobs.delete(storeId);
  });
  return promise;
}

export function resetSharedDemoRuntimeCoordinatorForTests() {
  jobs.clear();
}
