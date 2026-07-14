type BootstrapJob = {
  epoch: number;
  promise: Promise<void>;
};

const jobs = new Map<string, BootstrapJob>();

export function coordinateSharedDemoRuntime(
  storeId: string,
  epoch: number,
  run: () => Promise<void>,
) {
  const current = jobs.get(storeId);
  if (current && epoch < current.epoch) {
    return Promise.resolve();
  }
  if (current && epoch === current.epoch) {
    return current.promise;
  }

  const predecessor = current?.promise.catch(() => undefined) ?? Promise.resolve();
  const promise = predecessor.then(run);
  jobs.set(storeId, { epoch, promise });
  void promise.catch(() => {
    if (jobs.get(storeId)?.promise === promise) jobs.delete(storeId);
  });
  return promise;
}

export function resetSharedDemoRuntimeCoordinatorForTests() {
  jobs.clear();
}
