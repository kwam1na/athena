import { POS_LOCAL_PORTABLE_ENVELOPE_VERSION } from "./posLocalStoreVersions";

export type PosLocalSnapshotSectionManifest = Readonly<{
  count: number;
  identities: readonly string[];
  name: string;
}>;

export type PosLocalStoreSnapshot = Readonly<{
  envelopeVersion: number;
  manifest: Readonly<{
    integrity: string;
    sections: readonly PosLocalSnapshotSectionManifest[];
  }>;
  sections: Readonly<Record<string, readonly unknown[]>>;
}>;

export const REQUIRED_POS_LOCAL_SNAPSHOT_SECTIONS = Object.freeze([
  "terminalSeed",
  "checkpoints",
  "events",
  "mappings",
  "authority",
  "terminalIntegrity",
  "readiness",
  "cashierPresence",
  "staffAuthority",
  "registerCatalog",
  "registerServiceCatalog",
  "registerAvailability",
] as const);

export function validatePosLocalStoreSnapshotShape(
  snapshot: PosLocalStoreSnapshot,
):
  | { valid: true }
  | {
      valid: false;
      reason:
        | "unsupported_envelope"
        | "missing_section"
        | "count_mismatch"
        | "duplicate_identity"
        | "duplicate_section"
        | "unlisted_section";
    } {
  if (snapshot.envelopeVersion !== POS_LOCAL_PORTABLE_ENVELOPE_VERSION) {
    return { valid: false, reason: "unsupported_envelope" };
  }
  const manifests = new Map(
    snapshot.manifest.sections.map((section) => [section.name, section]),
  );
  if (manifests.size !== snapshot.manifest.sections.length) {
    return { valid: false, reason: "duplicate_section" };
  }
  for (const sectionName of Object.keys(snapshot.sections)) {
    if (!manifests.has(sectionName))
      return { valid: false, reason: "unlisted_section" };
  }
  for (const sectionName of manifests.keys()) {
    if (!Object.hasOwn(snapshot.sections, sectionName)) {
      return { valid: false, reason: "missing_section" };
    }
  }
  for (const sectionName of REQUIRED_POS_LOCAL_SNAPSHOT_SECTIONS) {
    if (!manifests.has(sectionName)) {
      return { valid: false, reason: "missing_section" };
    }
  }
  for (const [sectionName, manifest] of manifests) {
    const records = snapshot.sections[sectionName];
    if (!records) return { valid: false, reason: "missing_section" };
    if (
      manifest.count !== records.length ||
      manifest.identities.length !== records.length
    ) {
      return { valid: false, reason: "count_mismatch" };
    }
    if (new Set(manifest.identities).size !== manifest.identities.length) {
      return { valid: false, reason: "duplicate_identity" };
    }
  }
  return { valid: true };
}
