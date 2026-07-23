import type { OnlineOrder, OnlineOrderItem } from "~/types";

export type SessionOnlineOrderItem = OnlineOrderItem & {
  _creationTime?: number;
  _id: string;
};

export type OnlineOrderWithItems = Omit<OnlineOrder, "items"> & {
  items?: SessionOnlineOrderItem[];
};

export type SharedDemoSessionOrderPatch = Partial<OnlineOrderWithItems>;

export const SHARED_DEMO_SESSION_ORDER_CHANGED_EVENT =
  "athena:shared-demo:online-order-session-changed";

export function getSessionStorage() {
  if (typeof window !== "undefined" && window.sessionStorage) {
    return window.sessionStorage;
  }
  if (typeof globalThis.sessionStorage !== "undefined") {
    return globalThis.sessionStorage;
  }
  return null;
}

export function getSharedDemoSessionOrderStorageKey(args: {
  orderId: string;
  restoreEpoch: number;
  storeId: string;
}) {
  return `athena:shared-demo:online-order-session:v1:${args.storeId}:${args.restoreEpoch}:${args.orderId}`;
}

function getSharedDemoSessionOrderStoragePrefix(args: {
  restoreEpoch: number;
  storeId: string;
}) {
  return `athena:shared-demo:online-order-session:v1:${args.storeId}:${args.restoreEpoch}:`;
}

export function readSharedDemoSessionOrderPatch(
  storageKey: string | null,
): SharedDemoSessionOrderPatch {
  const storage = getSessionStorage();
  if (!storageKey || !storage) return {};

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as SharedDemoSessionOrderPatch)
      : {};
  } catch {
    return {};
  }
}

export function writeSharedDemoSessionOrderPatch(
  storageKey: string | null,
  patch: SharedDemoSessionOrderPatch,
) {
  const storage = getSessionStorage();
  if (!storageKey || !storage) return;

  try {
    storage.setItem(storageKey, JSON.stringify(patch));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SHARED_DEMO_SESSION_ORDER_CHANGED_EVENT));
    }
  } catch {
    // Keep the in-memory overlay active even when storage is unavailable.
  }
}

export function readSharedDemoSessionOrderPatches(args: {
  restoreEpoch: number;
  storeId: string;
}) {
  const storage = getSessionStorage();
  if (!storage) return new Map<string, SharedDemoSessionOrderPatch>();

  const prefix = getSharedDemoSessionOrderStoragePrefix(args);
  const patches = new Map<string, SharedDemoSessionOrderPatch>();
  const keys = new Set<string>();

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.add(key);
  }
  for (const key of Object.keys(storage)) {
    keys.add(key);
  }

  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;

    const orderId = key.slice(prefix.length);
    if (!orderId) continue;

    patches.set(orderId, readSharedDemoSessionOrderPatch(key));
  }

  return patches;
}

export function applySharedDemoSessionOrderPatches<
  TOrder extends { _id: unknown },
>(orders: TOrder[], patches: Map<string, SharedDemoSessionOrderPatch>) {
  if (patches.size === 0) return orders;

  return orders.map((order) => {
    const patch = patches.get(String(order._id));
    return patch ? ({ ...order, ...patch } as TOrder) : order;
  });
}
