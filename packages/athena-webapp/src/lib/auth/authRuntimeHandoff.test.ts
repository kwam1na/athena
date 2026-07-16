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
