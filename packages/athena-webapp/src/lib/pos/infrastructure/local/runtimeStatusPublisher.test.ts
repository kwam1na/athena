import { describe, expect, it, vi } from "vitest";

import {
  RUNTIME_STATUS_LEADER_LEASE_MS,
  startRuntimeStatusLeaderLease,
} from "./runtimeStatusPublisher";

describe("runtime status leader lease", () => {
  it("keeps best-effort ownership when browser storage drops writes", async () => {
    const storage = createDroppingStorage();
    const lease = startRuntimeStatusLeaderLease(
      {
        onLeadershipChange: vi.fn(),
        onMaterial: vi.fn(),
        ownerId: "owner-browser",
        storeId: "store-browser",
        terminalId: "terminal-browser",
      },
      { lockManager: null, storage },
    );

    expect(await lease.renew()).toBe(true);
    expect(lease.isLeader(0)).toBe(true);
    expect(lease.isLeader()).toBe(true);

    lease.stop();
  });

  it("serializes ownership and rejects a stale owner after expiry takeover", async () => {
    let now = 1_000;
    const storage = createMemoryStorage();
    const lockManager = {
      request: vi.fn(async (_name, _options, callback) => callback()),
    };
    const environment = {
      clearIntervalFn: vi.fn(),
      createChannel: () => null,
      lockManager,
      now: () => now,
      setIntervalFn: vi.fn(() => 1 as never),
      storage,
    };
    const first = startRuntimeStatusLeaderLease(
      {
        onLeadershipChange: vi.fn(),
        onMaterial: vi.fn(),
        ownerId: "owner-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      environment,
    );
    const second = startRuntimeStatusLeaderLease(
      {
        onLeadershipChange: vi.fn(),
        onMaterial: vi.fn(),
        ownerId: "owner-2",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      environment,
    );

    expect(await first.renew()).toBe(true);
    expect(await second.renew()).toBe(false);
    expect(first.isLeader()).toBe(true);
    expect(second.isLeader()).toBe(false);

    now += RUNTIME_STATUS_LEADER_LEASE_MS + 1;
    expect(await second.renew()).toBe(true);
    expect(second.isLeader()).toBe(true);
    expect(first.isLeader()).toBe(false);
    expect(lockManager.request).toHaveBeenCalled();

    first.stop();
    second.stop();
  });

  it("forwards follower material to the current owner over BroadcastChannel", async () => {
    const storage = createMemoryStorage();
    const channels = createChannelHub();
    const ownerMaterial = vi.fn();
    const environment = {
      clearIntervalFn: vi.fn(),
      createChannel: channels.create,
      lockManager: null,
      now: () => 1_000,
      setIntervalFn: vi.fn(() => 1 as never),
      storage,
    };
    const owner = startRuntimeStatusLeaderLease(
      {
        onLeadershipChange: vi.fn(),
        onMaterial: ownerMaterial,
        ownerId: "owner-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      environment,
    );
    const follower = startRuntimeStatusLeaderLease(
      {
        onLeadershipChange: vi.fn(),
        onMaterial: vi.fn(),
        ownerId: "owner-2",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      environment,
    );

    await owner.renew();
    await follower.renew();
    follower.announceMaterial("material-next");

    expect(ownerMaterial).toHaveBeenCalledWith("material-next", undefined);

    owner.stop();
    follower.stop();
  });

  it("ignores delayed material delivered after a newer cross-context update", async () => {
    const storage = createMemoryStorage();
    const ownerMaterial = vi.fn();
    const transport: {
      channel?: {
        close: () => void;
        onmessage: ((event: MessageEvent) => void) | null;
        postMessage: () => void;
      };
      storageListener?: (event: StorageEvent) => void;
    } = {};
    const owner = startRuntimeStatusLeaderLease(
      {
        onLeadershipChange: vi.fn(),
        onMaterial: ownerMaterial,
        ownerId: "owner-1",
        storeId: "store-ordered",
        terminalId: "terminal-ordered",
      },
      {
        addStorageListener: (listener) => {
          transport.storageListener = listener;
          return () => undefined;
        },
        clearIntervalFn: vi.fn(),
        createChannel: () => {
          transport.channel = {
            close: vi.fn(),
            onmessage: null,
            postMessage: vi.fn(),
          };
          return transport.channel;
        },
        lockManager: null,
        now: () => 2_000,
        setIntervalFn: vi.fn(() => 1 as never),
        storage,
      },
    );
    await owner.renew();

    const materialKey =
      "athena-pos-runtime-status-material:store-ordered:terminal-ordered";
    transport.channel?.onmessage?.({
      data: {
        materialSignature: "newer",
        ownerId: "owner-2",
        sentAt: 2_000,
      },
    } as MessageEvent);
    transport.storageListener?.({
      key: materialKey,
      newValue: JSON.stringify({
        materialSignature: "older",
        ownerId: "owner-3",
        sentAt: 1_000,
      }),
    } as StorageEvent);

    expect(ownerMaterial).toHaveBeenCalledTimes(1);
    expect(ownerMaterial).toHaveBeenCalledWith("newer", undefined);

    owner.stop();
  });
});

function createDroppingStorage(): Storage {
  return {
    clear: () => undefined,
    getItem: () => null,
    key: () => null,
    length: 0,
    removeItem: () => undefined,
    setItem: () => undefined,
  } as Storage;
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  } as Storage;
}

function createChannelHub() {
  const channels = new Set<{
    closed: boolean;
    onmessage: ((event: MessageEvent) => void) | null;
  }>();
  return {
    create: vi.fn(() => {
      const channel = {
        closed: false,
        onmessage: null as ((event: MessageEvent) => void) | null,
        close() {
          channel.closed = true;
          channels.delete(channel);
        },
        postMessage(message: unknown) {
          for (const peer of channels) {
            if (peer !== channel && !peer.closed) {
              peer.onmessage?.({ data: message } as MessageEvent);
            }
          }
        },
      };
      channels.add(channel);
      return channel;
    }),
  };
}
