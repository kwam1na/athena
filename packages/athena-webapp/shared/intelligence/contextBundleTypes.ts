import type {
  ContextFreshnessState,
  ContextSourceRef,
} from "./contextTypes";

export type ContextBundleMetadata = {
  bundleKind: string;
  bundleVersion: number;
  freshness: ContextFreshnessState;
  hiddenSourceCount?: number;
  omittedEvidenceCount?: number;
  redactionMode?: string;
  qualityFlags?: string[];
  limitedEvidence?: boolean;
};

export type IntelligenceContextBundle<Payload extends Record<string, unknown>> =
  ContextBundleMetadata & {
    snapshotHash: string;
    payloadSummary: Payload;
    sourceRefs: ContextSourceRef[];
    dataWindowStartAt?: number;
    dataWindowEndAt?: number;
  };
