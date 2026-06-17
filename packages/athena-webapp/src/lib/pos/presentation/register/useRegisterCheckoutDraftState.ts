import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import type { Payment } from "@/components/pos/types";
import type { PosPaymentMethod } from "@/lib/pos/domain";

export type RegisterPaymentMutationDraft = {
  amount?: number;
  nextPayments: Payment[];
  paymentMethod?: PosPaymentMethod;
  previousAmount?: number;
  stage:
    | "paymentAdded"
    | "paymentUpdated"
    | "paymentRemoved"
    | "paymentsCleared";
};

type CheckoutDraftQueueName = "cart" | "payment" | "service";

export function useRegisterCheckoutDraftState() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const paymentsRef = useRef<Payment[]>([]);
  const checkoutMutationLockedRef = useRef(false);
  const cartMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const paymentMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const serviceMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const checkoutStateVersionRef = useRef(0);

  const setPaymentState = useCallback((nextPayments: Payment[]) => {
    paymentsRef.current = nextPayments;
    setPayments(nextPayments);
  }, []);

  const allocateCheckoutStateVersion = useCallback(() => {
    const nextVersion = Math.max(
      checkoutStateVersionRef.current + 1,
      Date.now(),
    );
    checkoutStateVersionRef.current = nextVersion;
    return nextVersion;
  }, []);

  const resetCheckoutStateVersion = useCallback(() => {
    checkoutStateVersionRef.current = 0;
  }, []);

  const waitForCheckoutMutationQueues = useCallback(async () => {
    await cartMutationQueueRef.current.catch(() => undefined);
    await paymentMutationQueueRef.current.catch(() => undefined);
    await serviceMutationQueueRef.current.catch(() => undefined);
  }, []);

  const enqueueMutation = useCallback(
    (
      queueName: CheckoutDraftQueueName,
      mutation: () => Promise<boolean | void>,
      lockedMessage: string,
    ) => {
      if (checkoutMutationLockedRef.current) {
        toast.error(lockedMessage);
        return Promise.resolve(false);
      }

      const queueRef =
        queueName === "cart"
          ? cartMutationQueueRef
          : queueName === "payment"
            ? paymentMutationQueueRef
            : serviceMutationQueueRef;
      const queued = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          const result = await mutation();
          return result !== false;
        });
      queueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [],
  );

  const enqueueCartMutation = useCallback(
    (mutation: () => Promise<boolean | void>) =>
      enqueueMutation(
        "cart",
        mutation,
        "Finish the current checkout update before changing the sale.",
      ),
    [enqueueMutation],
  );

  const enqueuePaymentQueueMutation = useCallback(
    (mutation: () => Promise<boolean | void>) =>
      enqueueMutation(
        "payment",
        mutation,
        "Finish the current checkout update before changing payments.",
      ),
    [enqueueMutation],
  );

  const enqueueServiceMutation = useCallback(
    (mutation: () => Promise<boolean | void>) =>
      enqueueMutation(
        "service",
        mutation,
        "Finish the current checkout update before changing the sale.",
      ),
    [enqueueMutation],
  );

  return {
    allocateCheckoutStateVersion,
    checkoutMutationLockedRef,
    enqueueCartMutation,
    enqueuePaymentQueueMutation,
    enqueueServiceMutation,
    payments,
    paymentsRef,
    resetCheckoutStateVersion,
    setPaymentState,
    waitForCheckoutMutationQueues,
  };
}
