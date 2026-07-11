export { POS_LOCAL_LOGICAL_RECORD_VERSION } from "@/lib/pos/application/posLocalStoreTypes";
import { POS_LOCAL_LOGICAL_RECORD_VERSION } from "@/lib/pos/application/posLocalStoreTypes";
export const POS_LOCAL_PORTABLE_ENVELOPE_VERSION = 1;

export type PosLocalStoreVersions = {
  logicalRecord: number;
  portableEnvelope: number;
};

export const CURRENT_POS_LOCAL_STORE_VERSIONS: Readonly<PosLocalStoreVersions> =
  Object.freeze({
    logicalRecord: POS_LOCAL_LOGICAL_RECORD_VERSION,
    portableEnvelope: POS_LOCAL_PORTABLE_ENVELOPE_VERSION,
  });

export function comparePosLocalStoreVersion(
  observed: number,
  supported: number,
): "current" | "older" | "future" {
  if (observed === supported) return "current";
  return observed < supported ? "older" : "future";
}
