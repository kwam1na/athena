import { describe, expect, it, vi } from "vitest";

import {
  AUTH_RUNTIME_HANDOFF_JOURNAL_KEY,
  createAuthRuntimeHandoffCoordinator,
} from "./authRuntimeHandoff";

describe("auth runtime handoff coordinator", () => {
  it("prepares a unique non-secret pending namespace", () => {
    const storage = createMemoryStorage();
    const coordinator = createCoordinator(storage);

    const first = coordinator.prepareHandoff();
    coordinator.clearAfterConfirmedAbort(first);
    const second = coordinator.prepareHandoff();
    const journal = storage.getItem(AUTH_RUNTIME_HANDOFF_JOURNAL_KEY) ?? "";

    expect(first.pendingNamespace).not.toBe(second.pendingNamespace);
    expect(journal).toContain(second.pendingNamespace);
    expect(journal).not.toMatch(
      /recoveryCode|terminalProof|nonce|jwt|refreshToken/i,
    );
    expect(coordinator.getSnapshot()).toMatchObject({
      activeNamespace: null,
      handoffPhase: "prepared",
      status: "ready",
    });
  });

  it("enforces ordered transitions and remounts only on promotion", () => {
    const coordinator = createCoordinator(createMemoryStorage());
    const initialKey = coordinator.getSnapshot().providerRemountKey;
    const handle = coordinator.prepareHandoff();

    expect(() => coordinator.promoteActivated(handle)).toThrow(
      "invalid_handoff_transition",
    );
    coordinator.markAuthIssued(handle);
    coordinator.markActivated(handle);
    expect(coordinator.getSnapshot().providerRemountKey).toBe(initialKey);

    coordinator.promoteActivated(handle);

    expect(coordinator.getSnapshot()).toMatchObject({
      activeNamespace: handle.pendingNamespace,
      handoffPhase: "promoted",
      providerRemountKey: `auth:${handle.pendingNamespace}`,
    });
  });

  it("cleans predecessor storage only after verified promotion", () => {
    const storage = createMemoryStorage();
    const coordinator = createCoordinator(storage);
    const mainStorage = coordinator.getTokenStorage(null);
    mainStorage.setItem("jwt_default", "old-token");
    const handle = coordinator.prepareHandoff();

    expect(() => coordinator.completeVerifiedPromotion(handle)).toThrow(
      "invalid_handoff_transition",
    );
    expect(storage.getItem("jwt_default")).toBe("old-token");

    coordinator.markAuthIssued(handle);
    coordinator.markActivated(handle);
    coordinator.promoteActivated(handle);
    coordinator.completeVerifiedPromotion(handle);

    expect(storage.getItem("jwt_default")).toBeNull();
    expect(coordinator.getSnapshot()).toMatchObject({
      activeNamespace: handle.pendingNamespace,
      handoffPhase: "idle",
      status: "ready",
    });
  });

  it("fails closed for corrupt, foreign-owned, and stale journals", () => {
    const storage = createMemoryStorage();
    storage.setItem(AUTH_RUNTIME_HANDOFF_JOURNAL_KEY, "not-json");
    expect(createCoordinator(storage).getSnapshot()).toMatchObject({
      blockReason: "corrupt_journal",
      status: "blocked",
    });

    storage.clear();
    let now = 1_000;
    const owner = createCoordinator(storage, {
      now: () => now,
      owner: "owner-alpha",
    });
    owner.prepareHandoff({ leaseDurationMs: 100 });
    const observer = createCoordinator(storage, {
      now: () => now,
      owner: "owner-bravo",
    });
    expect(observer.getSnapshot().blockReason).toBe("foreign_owner");

    now = 1_101;
    observer.refresh();
    expect(observer.getSnapshot().blockReason).toBe("stale_handoff");
    const resumed = observer.takeOverStaleHandoff({ leaseDurationMs: 100 });
    expect(resumed.ownerToken).toBe("owner-bravo");
    expect(observer.getSnapshot().status).toBe("ready");
  });

  it("notifies subscribers when the active namespace changes", () => {
    const coordinator = createCoordinator(createMemoryStorage());
    const listener = vi.fn();
    const unsubscribe = coordinator.subscribe(listener);
    const handle = coordinator.prepareHandoff();
    coordinator.markAuthIssued(handle);
    coordinator.markActivated(handle);
    coordinator.promoteActivated(handle);

    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it("reconstructs an owned in-flight handle after a reload", () => {
    const storage = createMemoryStorage();
    const beforeReload = createCoordinator(storage);
    const handle = beforeReload.prepareHandoff();
    beforeReload.markAuthIssued(handle);

    const afterReload = createCoordinator(storage);

    expect(afterReload.getCurrentHandoffHandle()).toEqual(handle);
    expect(afterReload.getSnapshot().handoffPhase).toBe("auth_issued");
  });

  it("serializes the complete handoff through Web Locks", async () => {
    let active = 0;
    let maximumActive = 0;
    let tail = Promise.resolve();
    const lockRequests: Array<{
      name: string;
      options: { mode: "exclusive" };
    }> = [];
    const lockManager = {
      async request<T>(
        name: string,
        options: { mode: "exclusive" },
        callback: () => Promise<T>,
      ) {
        lockRequests.push({ name, options });
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        try {
          return await callback();
        } finally {
          active -= 1;
          release();
        }
      },
    };
    const coordinator = createAuthRuntimeHandoffCoordinator({
      lockManager,
      now: () => 1_000,
      ownerToken: "owner-current",
      randomId: () => "generated-lock-12345678",
      storage: createMemoryStorage(),
    });
    let releaseFirst!: () => void;
    const first = coordinator.runExclusive(
      () => new Promise<void>((resolve) => (releaseFirst = resolve)),
    );
    const second = coordinator.runExclusive(async () => undefined);
    await vi.waitFor(() => expect(lockRequests).toHaveLength(2));
    releaseFirst();
    await Promise.all([first, second]);

    expect(maximumActive).toBe(1);
    expect(lockRequests).toEqual([
      {
        name: "athena.authRuntimeHandoff.v1",
        options: { mode: "exclusive" },
      },
      {
        name: "athena.authRuntimeHandoff.v1",
        options: { mode: "exclusive" },
      },
    ]);
  });

  it("renews the owner lease while an async handoff step is running", async () => {
    vi.useFakeTimers();
    try {
      let now = 1_000;
      const coordinator = createAuthRuntimeHandoffCoordinator({
        lockManager: null,
        now: () => now,
        ownerToken: "owner-current",
        randomId: () => "generated-lease-12345678",
        storage: createMemoryStorage(),
      });
      const handle = coordinator.prepareHandoff({ leaseDurationMs: 3_000 });
      let finish!: () => void;
      const running = coordinator.keepLeaseAlive(
        handle,
        () => new Promise<void>((resolve) => (finish = resolve)),
        { leaseDurationMs: 3_000 },
      );

      now = 2_000;
      await vi.advanceTimersByTimeAsync(1_000);
      now = 4_500;
      await vi.advanceTimersByTimeAsync(1_000);
      finish();
      await running;

      expect(() => coordinator.markAuthIssued(handle)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

function createCoordinator(
  storage: Storage,
  options: { now?: () => number; owner?: string } = {},
) {
  let sequence = 0;
  return createAuthRuntimeHandoffCoordinator({
    now: options.now ?? (() => 1_000),
    ownerToken: options.owner ?? "owner-current",
    randomId: () => `generated-${++sequence}-12345678`,
    storage,
  });
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
