import { useQuery } from "convex/react";
import useGetActiveStore from "./useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { FINGERPRINT_STORAGE_KEY } from "../lib/constants";

export const useGetTerminal = () => {
  const { activeStore } = useGetActiveStore();

  const fingerprintObject = localStorage.getItem(FINGERPRINT_STORAGE_KEY);

  const fingerprintHash = fingerprintObject
    ? JSON.parse(fingerprintObject).fingerprintHash
    : null;

  const terminal = useQuery(
    api.inventory.posTerminal.getTerminalByFingerprint,
    activeStore?._id && fingerprintHash
      ? {
          storeId: activeStore?._id,
          fingerprintHash: fingerprintHash,
        }
      : "skip"
  );

  return terminal;
};
