import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useSharedDemoContext } from "@/hooks/useSharedDemoContext";

import type { OnlineOrderItem } from "~/types";
import useGetActiveOnlineOrder from "../components/orders/hooks/useGetActiveOnlineOrder";
import {
  getSharedDemoSessionOrderStorageKey,
  readSharedDemoSessionOrderPatch,
  writeSharedDemoSessionOrderPatch,
  type OnlineOrderWithItems,
  type SessionOnlineOrderItem,
  type SharedDemoSessionOrderPatch,
} from "./onlineOrderSessionOverlay";

interface OnlineOrderContextType {
  order?: OnlineOrderWithItems | null;
  isSharedDemoSessionOrder: boolean;
  updateSessionOrder: (update: Partial<OnlineOrderWithItems>) => void;
  updateSessionOrderItem: (
    itemId: string,
    update: Partial<SessionOnlineOrderItem>,
  ) => void;
}

const OnlineOrderContext = createContext<OnlineOrderContextType | undefined>(
  undefined,
);

export function OnlineOrderProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const order: OnlineOrderWithItems | null | undefined =
    useGetActiveOnlineOrder();
  const sharedDemo = useSharedDemoContext();
  const isSharedDemoSessionOrder = sharedDemo?.kind === "shared_demo";
  const storageKey =
    isSharedDemoSessionOrder && order?._id
      ? getSharedDemoSessionOrderStorageKey({
          orderId: String(order._id),
          restoreEpoch: sharedDemo.restore.epoch,
          storeId: String(sharedDemo.storeId),
        })
      : null;
  const [sessionOrderPatch, setSessionOrderPatch] =
    useState<SharedDemoSessionOrderPatch>(() =>
      readSharedDemoSessionOrderPatch(storageKey),
    );

  useEffect(() => {
    setSessionOrderPatch(readSharedDemoSessionOrderPatch(storageKey));
  }, [storageKey]);

  const updateSessionOrder = useCallback(
    (update: Partial<OnlineOrderWithItems>) => {
      if (!isSharedDemoSessionOrder) return;

      setSessionOrderPatch((current) => {
        const next = { ...current, ...update };
        writeSharedDemoSessionOrderPatch(storageKey, next);
        return next;
      });
    },
    [isSharedDemoSessionOrder, storageKey],
  );

  const updateSessionOrderItem = useCallback(
    (itemId: string, update: Partial<OnlineOrderItem>) => {
      if (!isSharedDemoSessionOrder || !order?.items) return;

      setSessionOrderPatch((current) => {
        const sourceItems = current.items ?? order.items ?? [];
        const next = {
          ...current,
          items: sourceItems.map((item) =>
            String(item._id) === itemId ? { ...item, ...update } : item,
          ),
        };
        writeSharedDemoSessionOrderPatch(storageKey, next);
        return next;
      });
    },
    [isSharedDemoSessionOrder, order?.items, storageKey],
  );

  const effectiveOrder = useMemo(() => {
    if (!order || !isSharedDemoSessionOrder) return order;
    return { ...order, ...sessionOrderPatch };
  }, [isSharedDemoSessionOrder, order, sessionOrderPatch]);

  return (
    <OnlineOrderContext.Provider
      value={{
        isSharedDemoSessionOrder,
        order: effectiveOrder,
        updateSessionOrder,
        updateSessionOrderItem,
      }}
    >
      {children}
    </OnlineOrderContext.Provider>
  );
}

export function useOnlineOrder() {
  const context = useContext(OnlineOrderContext);
  if (!context) {
    throw new Error("useOnlineOrder must be used within a OnlineOrderProvider");
  }

  return context;
}
