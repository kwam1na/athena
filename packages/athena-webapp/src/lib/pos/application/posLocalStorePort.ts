import type {
  PosDrawerAuthorityState,
  PosLocalActiveCashierPresenceRecord,
  PosLocalActivityReportReasonCode,
  PosLocalActivityReportStatus,
  PosLocalAppendEventInput,
  PosLocalCashierPresenceScope,
  PosLocalCloudMapping,
  PosLocalEntityKind,
  PosLocalEventRecord,
  PosLocalLedgerSummary,
  PosLocalOpaqueContinuation,
  PosLocalRegisterAvailabilitySnapshot,
  PosLocalRegisterCatalogSnapshot,
  PosLocalRegisterCatalogPin,
  PosLocalRegisterCatalogVersion,
  PosLocalRegisterCatalogVersionState,
  PosLocalRegisterCatalogVersionWriteOutcome,
  PosRegisterCatalogRevision,
  PosLocalRegisterServiceCatalogSnapshot,
  PosLocalReviewResolutionReason,
  PosLocalStaffAuthorityReadiness,
  PosLocalStaffAuthorityRecord,
  PosLocalStoreDayReadiness,
  PosLocalStoreResult,
  PosProvisionedTerminalSeed,
  PosRegisterLifecycleAuthorityApplyResult,
  PosRegisterLifecycleAuthorityObservation,
  PosRegisterOperationalStateResetResult,
  PosTerminalIntegrityState,
} from "./posLocalStoreTypes";
import type {
  PosRegisterCatalogAvailabilityRowDto,
  PosRegisterCatalogRowDto,
  PosServiceCatalogRowDto,
} from "./dto";

export interface PosLocalSeedReaderPort {
  readProvisionedTerminalSeed(): Promise<
    PosLocalStoreResult<PosProvisionedTerminalSeed | null>
  >;
}
export interface PosLocalSeedPort extends PosLocalSeedReaderPort {
  writeProvisionedTerminalSeed(
    seed: PosProvisionedTerminalSeed,
  ): Promise<PosLocalStoreResult<PosProvisionedTerminalSeed>>;
  writeProvisionedTerminalSeedAndClearTerminalIntegrity(input: {
    seed: PosProvisionedTerminalSeed;
    terminalIntegrity: { storeId: string; terminalId: string };
  }): Promise<PosLocalStoreResult<PosProvisionedTerminalSeed>>;
}
export interface PosLocalMappingPort {
  listLocalCloudMappings(): Promise<
    PosLocalStoreResult<PosLocalCloudMapping[]>
  >;
  readMappingPage(input: {
    continuation?: PosLocalOpaqueContinuation;
    limit: number;
    storeId: string;
    terminalId: string;
  }): Promise<
    PosLocalStoreResult<{
      continuation?: PosLocalOpaqueContinuation;
      items: PosLocalCloudMapping[];
    }>
  >;
  readLocalCloudMapping(input: {
    entity: PosLocalEntityKind;
    localId: string;
  }): Promise<PosLocalStoreResult<PosLocalCloudMapping | null>>;
  writeLocalCloudMapping(
    mapping: PosLocalCloudMapping,
  ): Promise<PosLocalStoreResult<PosLocalCloudMapping>>;
}
export interface PosLocalRegisterAuthorityPort extends PosLocalSeedReaderPort {
  applyRegisterLifecycleAuthority(input: {
    expectedMapping?: {
      cloudRegisterSessionId?: string;
      mappedAt?: number;
      mappingAuthorityRevision?: number;
      registerCandidateState?: "current" | "historical";
      registerNumber?: string;
      storeId?: string;
      terminalId?: string;
    };
    observation: PosRegisterLifecycleAuthorityObservation;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosRegisterLifecycleAuthorityApplyResult>>;
  clearDrawerAuthorityState(input: {
    cloudRegisterSessionId?: string;
    localRegisterSessionId: string;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<null>>;
  clearLocalDrawerReviewAuthorityState(input: {
    localRegisterSessionId: string;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<null>>;
  readDrawerAuthorityState(input: {
    cloudRegisterSessionId?: string;
    localRegisterSessionId: string;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosDrawerAuthorityState | null>>;
  writeDrawerAuthorityState(
    state: PosDrawerAuthorityState,
  ): Promise<PosLocalStoreResult<PosDrawerAuthorityState>>;
}
export interface PosLocalIntegrityPort {
  clearTerminalIntegrityState(input: {
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<null>>;
  readTerminalIntegrityState(input: {
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosTerminalIntegrityState | null>>;
  writeTerminalIntegrityState(
    state: PosTerminalIntegrityState,
  ): Promise<PosLocalStoreResult<PosTerminalIntegrityState>>;
}
export interface PosLocalReadinessPort {
  readStoreDayReadiness(input: {
    storeId: string;
    operatingDate: string;
  }): Promise<PosLocalStoreResult<PosLocalStoreDayReadiness | null>>;
  writeStoreDayReadiness(
    readiness: PosLocalStoreDayReadiness,
  ): Promise<PosLocalStoreResult<PosLocalStoreDayReadiness>>;
}
export interface PosLocalCashierAuthorityPort {
  clearCashierPresence(
    input: PosLocalCashierPresenceScope,
  ): Promise<PosLocalStoreResult<null>>;
  getStaffAuthorityReadiness(input: {
    now?: number;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosLocalStaffAuthorityReadiness>>;
  invalidateCashierPresenceForTerminal(input: {
    organizationId?: string;
    storeId?: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<number>>;
  readActiveCashierPresence(input: {
    now?: number;
    operatingDate: string;
    organizationId?: string;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosLocalActiveCashierPresenceRecord | null>>;
  readCashierPresence(
    input: PosLocalCashierPresenceScope & { now?: number },
  ): Promise<PosLocalStoreResult<PosLocalActiveCashierPresenceRecord | null>>;
  readStaffAuthorityForUsername(input: {
    now?: number;
    storeId: string;
    terminalId: string;
    username: string;
  }): Promise<PosLocalStoreResult<PosLocalStaffAuthorityRecord | null>>;
  replaceStaffAuthoritySnapshot(input: {
    records: PosLocalStaffAuthorityRecord[];
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosLocalStaffAuthorityRecord[]>>;
  upsertStaffAuthorityRecord(input: {
    record: PosLocalStaffAuthorityRecord;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosLocalStaffAuthorityRecord>>;
  writeCashierPresence(
    presence: PosLocalActiveCashierPresenceRecord,
  ): Promise<PosLocalStoreResult<PosLocalActiveCashierPresenceRecord>>;
}
export interface PosLocalCatalogPort {
  pinRegisterCatalogVersion(input: {
    ownerId?: string;
    revision: PosRegisterCatalogRevision;
    rows: PosRegisterCatalogRowDto[];
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogPin>>;
  promoteRegisterCatalogVersion(input: {
    revision: number;
    storeId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogVersionWriteOutcome>>;
  readRegisterCatalogSelection(input: {
    ownerId?: string;
    storeId: string;
    terminalId?: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogVersion | null>>;
  readRegisterCatalogPin(input: {
    ownerId?: string;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogPin | null>>;
  readRegisterCatalogVersionState(input: {
    storeId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogVersionState>>;
  releaseRegisterCatalogPin(input: {
    ownerId?: string;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<null>>;
  renewRegisterCatalogPinLease?(input: {
    ownerId?: string;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogPin | null>>;
  stageRegisterCatalogVersion(input: {
    revision: number;
    rows: PosRegisterCatalogRowDto[];
    storeId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogVersionWriteOutcome>>;
  readRegisterAvailabilitySnapshot(input: {
    storeId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterAvailabilitySnapshot | null>>;
  readRegisterCatalogSnapshot(input: {
    storeId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogSnapshot | null>>;
  readRegisterServiceCatalogSnapshot(input: {
    storeId: string;
  }): Promise<
    PosLocalStoreResult<PosLocalRegisterServiceCatalogSnapshot | null>
  >;
  writeRegisterAvailabilitySnapshot(input: {
    rows: PosRegisterCatalogAvailabilityRowDto[];
    storeId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterAvailabilitySnapshot>>;
  writeRegisterCatalogSnapshot(input: {
    rows: PosRegisterCatalogRowDto[];
    storeId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogSnapshot>>;
  writeRegisterServiceCatalogSnapshot(input: {
    rows: PosServiceCatalogRowDto[];
    storeId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterServiceCatalogSnapshot>>;
}
export interface PosLocalEventPort {
  appendEvent(
    input: PosLocalAppendEventInput,
  ): Promise<PosLocalStoreResult<PosLocalEventRecord>>;
  attachStaffProofTokenToPendingEvents(input: {
    staffProfileId: string;
    staffProofToken: string;
  }): Promise<PosLocalStoreResult<number>>;
  clearLocalReviewEvents(
    eventIds: string[],
    clearOptions?: { reason?: PosLocalReviewResolutionReason },
  ): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
  listEvents(): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
  readLedgerSummary(input: {
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosLocalLedgerSummary>>;
  readEventHistoryPage(input: {
    continuation?: PosLocalOpaqueContinuation;
    limit: number;
    storeId: string;
    terminalId: string;
  }): Promise<
    PosLocalStoreResult<{
      continuation?: PosLocalOpaqueContinuation;
      items: PosLocalEventRecord[];
    }>
  >;
  listEventsForUpload(input?: {
    includeReviewEvents?: boolean;
    limit?: number;
    storeId?: string;
    terminalId?: string;
  }): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
  readUploadCandidatePage(input: {
    continuation?: PosLocalOpaqueContinuation;
    limit: number;
    storeId: string;
    terminalId: string;
  }): Promise<
    PosLocalStoreResult<{
      continuation?: PosLocalOpaqueContinuation;
      items: PosLocalEventRecord[];
    }>
  >;
  markEventsActivityFailed(
    eventIds: string[],
    failOptions: {
      attemptedAt?: number;
      reasonCode: PosLocalActivityReportReasonCode;
    },
  ): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
  markEventsActivityReported(
    eventIds: string[],
    reportOptions?: {
      reasonCode?: PosLocalActivityReportReasonCode;
      reportedAt?: number;
      status?: Extract<
        PosLocalActivityReportStatus,
        "reported" | "mapping_pending"
      >;
    },
  ): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
  markEventsNeedsReview(
    eventIds: string[],
    error?: string,
    markOptions?: { uploaded?: boolean },
  ): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
  markEventsSynced(
    eventIds: string[],
    markOptions?: { uploaded?: boolean },
  ): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
}
export interface PosLocalCompatibilityPort {
  initializeStorage(): Promise<
    PosLocalStoreResult<{ logicalRecordVersion: number }>
  >;
  resetRegisterOperationalStateForAuthorityCutover(): Promise<
    PosLocalStoreResult<PosRegisterOperationalStateResetResult>
  >;
  /** Dev/QA shared-demo restore only: discard this browser's POS state after
   * the server has restored the shared store baseline. */
  resetSharedDemoLocalState?(): Promise<PosLocalStoreResult<null>>;
}

/** High-level outcomes only. Engines retain their native layout, indexes, queries, and transaction mechanics. */
export interface PosLocalStorePort
  extends
    PosLocalSeedPort,
    PosLocalMappingPort,
    PosLocalRegisterAuthorityPort,
    PosLocalIntegrityPort,
    PosLocalReadinessPort,
    PosLocalCashierAuthorityPort,
    PosLocalCatalogPort,
    PosLocalEventPort,
    PosLocalCompatibilityPort {}
