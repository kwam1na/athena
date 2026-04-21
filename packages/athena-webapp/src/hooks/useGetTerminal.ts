import { useConvexTerminalByFingerprint } from "@/lib/pos/infrastructure/convex/registerGateway";
import { readStoredTerminalFingerprintHash } from "@/lib/pos/infrastructure/terminal/fingerprint";
import useGetActiveStore from "./useGetActiveStore";

export const useGetTerminal = () => {
  const { activeStore } = useGetActiveStore();
  const fingerprintHash = readStoredTerminalFingerprintHash();
  const terminal = useConvexTerminalByFingerprint({
    storeId: activeStore?._id,
    fingerprintHash,
  });

  if (fingerprintHash == null) {
    return null;
  }

  return terminal;
};
