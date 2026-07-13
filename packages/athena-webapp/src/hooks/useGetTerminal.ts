import { useEffect, useState } from "react";
import { useQuery } from "convex/react";

import { useConvexTerminalByFingerprint } from "@/lib/pos/infrastructure/convex/registerGateway";
import { getDefaultPosLocalStore } from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import { readStoredTerminalFingerprintHash } from "@/lib/pos/infrastructure/terminal/fingerprint";
import type { Id } from "~/convex/_generated/dataModel";
import type { PosTerminalLoginMode } from "~/shared/posTerminalLoginMode";
import type { PosTerminalTransactionCapability } from "~/shared/posTerminalCapability";
import useGetActiveStore from "./useGetActiveStore";
import { api } from "~/convex/_generated/api";

export const useGetTerminal = () => {
  const { activeStore } = useGetActiveStore();
  const sharedDemoRegister = useQuery(
    api.sharedDemo.public.getRegisterBootstrap,
    {},
  );
  const fingerprintHash = readStoredTerminalFingerprintHash();
  const [localTerminal, setLocalTerminal] = useState<{
    fingerprintHash: string;
    storeId: string;
    terminal: {
      _id: Id<"posTerminal">;
      cloudTerminalId?: string;
      displayName: string;
      localTerminalId?: string;
      registerNumber?: string;
      loginMode?: PosTerminalLoginMode;
      transactionCapability?: PosTerminalTransactionCapability;
      status: string;
    };
  } | null>(null);
  const terminal = useConvexTerminalByFingerprint({
    storeId: activeStore?._id,
    fingerprintHash,
  });

  useEffect(() => {
    let cancelled = false;

    if (!fingerprintHash || terminal) {
      setLocalTerminal(null);
      return;
    }

    void (async () => {
      const result =
        await getDefaultPosLocalStore().readProvisionedTerminalSeed();

      if (cancelled) return;

      if (
        result.ok &&
        result.value &&
        (!activeStore?._id || result.value.storeId === activeStore._id) &&
        result.value.terminalId === fingerprintHash
      ) {
        setLocalTerminal({
          fingerprintHash,
          storeId: result.value.storeId,
          terminal: {
            _id: result.value.cloudTerminalId as Id<"posTerminal">,
            cloudTerminalId: result.value.cloudTerminalId,
            displayName: result.value.displayName,
            localTerminalId: result.value.terminalId,
            registerNumber: result.value.registerNumber,
            loginMode: result.value.loginMode,
            transactionCapability: result.value.transactionCapability,
            status: "local",
          },
        });
        return;
      }

      setLocalTerminal(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeStore?._id, fingerprintHash, terminal]);

  if (
    terminal &&
    sharedDemoRegister?.kind === "shared_demo" &&
    (!activeStore?._id || sharedDemoRegister.storeId === activeStore._id)
  ) {
    return {
      ...terminal,
      sharedDemoStaff: sharedDemoRegister.staff,
    };
  }

  if (
    !terminal &&
    sharedDemoRegister?.kind === "shared_demo" &&
    (!activeStore?._id || sharedDemoRegister.storeId === activeStore._id)
  ) {
    return {
      ...sharedDemoRegister.terminal,
      sharedDemoStaff: sharedDemoRegister.staff,
    };
  }

  if (fingerprintHash == null) {
    return null;
  }

  if (
    localTerminal &&
    (!activeStore?._id || localTerminal.storeId === activeStore._id) &&
    localTerminal.fingerprintHash === fingerprintHash
  ) {
    return terminal ?? localTerminal.terminal;
  }

  return terminal ?? null;
};
