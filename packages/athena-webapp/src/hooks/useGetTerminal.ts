import { useEffect, useState } from "react";

import { useConvexTerminalByFingerprint } from "@/lib/pos/infrastructure/convex/registerGateway";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
} from "@/lib/pos/infrastructure/local/posLocalStore";
import { readStoredTerminalFingerprintHash } from "@/lib/pos/infrastructure/terminal/fingerprint";
import type { Id } from "~/convex/_generated/dataModel";
import useGetActiveStore from "./useGetActiveStore";

export const useGetTerminal = () => {
  const { activeStore } = useGetActiveStore();
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

    if (typeof indexedDB === "undefined") {
      setLocalTerminal(null);
      return;
    }

    void (async () => {
      const result = await createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      }).readProvisionedTerminalSeed();

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
