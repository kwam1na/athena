export type ContextTrackingSurface = "storefront" | "athena_webapp";

export type CompiledContextBundle = {
  bundleKind: string;
  bundleVersion: number;
  freshness: "current" | "stale" | "partial" | "failed";
  snapshotHash: string;
  payloadSummary: Record<string, unknown>;
  payloadRedaction: string;
  sourceRefs: Array<{ table: string; id: string; label?: string }>;
  dataWindowStartAt?: number;
  dataWindowEndAt?: number;
  hiddenSourceCount?: number;
  omittedEvidenceCount?: number;
  redactionMode?: string;
  qualityFlags?: string[];
  limitedEvidence?: boolean;
};
