export const POS_CENSUS_BACKFILL_PHASES = [
  "pos",
  "pos_void",
  "pos_refund",
  "pos_adjustment",
  "pos_payment_correction",
  "done",
] as const;

export type PosCensusBackfillPhase =
  (typeof POS_CENSUS_BACKFILL_PHASES)[number];

export const ORPHAN_PAYMENT_CORRECTION_EXCLUSION_REASON =
  "orphan_payment_correction" as const;

export function advancePosCensusCursor(input: {
  continueCursor: string;
  isDone: boolean;
  phase: PosCensusBackfillPhase;
}) {
  if (!input.isDone) {
    return { pageCursor: input.continueCursor, phase: input.phase };
  }
  const index = POS_CENSUS_BACKFILL_PHASES.indexOf(input.phase);
  return {
    pageCursor: null,
    phase:
      POS_CENSUS_BACKFILL_PHASES[
        Math.min(index + 1, POS_CENSUS_BACKFILL_PHASES.length - 1)
      ]!,
  };
}

export function assertSealedJournalTerminal(input: {
  apply: { id?: string; recordedAt?: number };
  preview: { id?: string; recordedAt?: number };
}) {
  if (
    input.apply.id !== input.preview.id ||
    input.apply.recordedAt !== input.preview.recordedAt
  ) {
    throw new Error("Authorized POS census journal terminal changed after preview");
  }
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function sourceDerivedPosCensusHash(input: {
  authoritativeSourceCount?: number;
  authoritativeSourceDigest?: string;
  factContractVersion: number;
  financialDateContractVersion: number;
  frozenWatermark: number;
  journalTerminalId?: string;
  journalTerminalRecordedAt?: number;
  manifestDigest: string;
  orphanPaymentCorrectionCount?: number;
  skuAttributionTerminalSequence?: number;
}) {
  return `reporting-pos-source-census-v1:${fnv1a(
    JSON.stringify([
      input.manifestDigest,
      input.orphanPaymentCorrectionCount ?? 0,
      input.orphanPaymentCorrectionCount
        ? ORPHAN_PAYMENT_CORRECTION_EXCLUSION_REASON
        : null,
      input.authoritativeSourceDigest ?? null,
      input.authoritativeSourceCount ?? null,
      input.journalTerminalId ?? null,
      input.journalTerminalRecordedAt ?? null,
      input.skuAttributionTerminalSequence ?? null,
      input.frozenWatermark,
      input.factContractVersion,
      input.financialDateContractVersion,
      "pos",
    ]),
  )}`;
}
