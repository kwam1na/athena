import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useRegisterLifecycleAuthorityAcknowledgement,
  useRegisterLifecycleAuthoritySnapshot,
  type RegisterLifecycleAuthorityAcknowledgementArgs,
  type RegisterLifecycleAuthoritySnapshot,
} from "@/lib/pos/infrastructure/convex/registerLifecycleAuthorityGateway";
import { getInitialRuntimeBuildMetadata } from "@/lib/runtimeBuildMetadata";
import type { Id } from "~/convex/_generated/dataModel";
import type { PosLocalStorePort } from "@/lib/pos/application/posLocalStorePort";

import {
  deriveRegisterLifecycleAuthorityCandidates,
  type RegisterLifecycleAuthorityCandidateState,
} from "./registerLifecycleAuthorityCandidates";
import type { PosLocalRegisterReadModel } from "./registerReadModel";
import type { PosProvisionedTerminalSeed } from "@/lib/pos/application/posLocalStoreTypes";
import {
  getRegisterLifecycleAuthorityRolloutPolicy,
  resolveRegisterLifecycleAuthorityRolloutCohort,
  shouldApplyRegisterLifecycleAuthority,
  shouldSubscribeToRegisterLifecycleAuthority,
  type RegisterLifecycleAuthorityRolloutPolicy,
} from "./registerLifecycleAuthorityRollout";
import { seedRegisterSessionAuthorityBootstrap } from "./registerSessionAuthorityBootstrap";

type RegisterLifecycleAuthorityStore = PosLocalStorePort;

export type RegisterLifecycleAuthorityAuthorizationState =
  | { status: "not_ready" | "loading" | "offline" }
  | { status: "authorized" }
  | { status: "unauthorized" };

export type RegisterLifecycleAuthorityPersistenceState =
  | { status: "idle" | "applying" | "ready" }
  | {
      reason:
        | "candidate_invalid"
        | "mapping_invalidated"
        | "snapshot_invalid"
        | "write_failed";
      status: "failed";
    };

export type RegisterLifecycleAuthorityRuntimeState = {
  authorization: RegisterLifecycleAuthorityAuthorizationState;
  candidates: RegisterLifecycleAuthorityCandidateState;
  persistence: RegisterLifecycleAuthorityPersistenceState;
  retry: () => void;
};

export function useRegisterLifecycleAuthorityRuntime(input: {
  isOnline?: boolean;
  localRegisterReadModel: PosLocalRegisterReadModel | null;
  onAdvisoryOutcome?: (outcome: {
    appliedCount: number;
    candidateCount: number;
    outcome:
      | "applied"
      | "already_current"
      | "stale_ignored"
      | "persistence_failed"
      | "repair_required"
      | "shadow_observed";
  }) => void;
  refreshLocalRegisterReadModel: () => Promise<void>;
  store: RegisterLifecycleAuthorityStore;
  storeId?: Id<"store">;
  terminal?: {
    _id: Id<"posTerminal">;
    registerNumber?: string;
  } | null;
  rolloutPolicy?: RegisterLifecycleAuthorityRolloutPolicy;
}): RegisterLifecycleAuthorityRuntimeState {
  const isOnline = input.isOnline ?? globalThis.navigator?.onLine ?? false;
  const [terminalSeed, setTerminalSeed] =
    useState<PosProvisionedTerminalSeed | null>(null);
  const [seedReady, setSeedReady] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [persistence, setPersistence] =
    useState<RegisterLifecycleAuthorityPersistenceState>({ status: "idle" });
  const [runtimeBuildMetadata] = useState(getInitialRuntimeBuildMetadata);
  const applyGeneration = useRef(0);
  const onAdvisoryOutcomeRef = useRef(input.onAdvisoryOutcome);
  const refreshLocalRegisterReadModelRef = useRef(
    input.refreshLocalRegisterReadModel,
  );
  onAdvisoryOutcomeRef.current = input.onAdvisoryOutcome;
  refreshLocalRegisterReadModelRef.current =
    input.refreshLocalRegisterReadModel;
  const acknowledgeAuthority = useRegisterLifecycleAuthorityAcknowledgement();
  const rolloutPolicy = useMemo(
    () => input.rolloutPolicy ?? getRegisterLifecycleAuthorityRolloutPolicy(),
    [input.rolloutPolicy],
  );

  const retry = useCallback(() => {
    setRetryToken((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSeedReady(false);
    if (!input.storeId || !input.terminal?._id) {
      setTerminalSeed(null);
      setSeedReady(true);
      return () => {
        cancelled = true;
      };
    }

    void input.store.readProvisionedTerminalSeed().then((result) => {
      if (cancelled) return;
      const value = result.ok ? result.value : null;
      setTerminalSeed(
        value &&
          value.storeId === input.storeId &&
          value.cloudTerminalId === input.terminal?._id
          ? value
          : null,
      );
      setSeedReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [input.store, input.storeId, input.terminal?._id, retryToken]);

  const candidates = useMemo<RegisterLifecycleAuthorityCandidateState>(() => {
    if (!seedReady || !input.localRegisterReadModel) {
      return { status: "loading" };
    }
    if (!terminalSeed || !input.storeId) {
      return { candidates: [], status: "empty" };
    }
    return deriveRegisterLifecycleAuthorityCandidates({
      projection: input.localRegisterReadModel,
      registerNumber:
        terminalSeed.registerNumber ?? input.terminal?.registerNumber,
      storeId: input.storeId,
      terminalId: terminalSeed.terminalId,
    });
  }, [
    input.localRegisterReadModel,
    input.storeId,
    input.terminal?.registerNumber,
    seedReady,
    terminalSeed,
  ]);
  const candidatesSignature = JSON.stringify(candidates);
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  const queryArgs = useMemo(() => {
    if (
      !isOnline ||
      !input.storeId ||
      !input.terminal?._id ||
      !terminalSeed?.syncSecretHash ||
      (candidates.status !== "ready" && candidates.status !== "empty") ||
      (candidates.status === "ready" &&
        !shouldSubscribeToRegisterLifecycleAuthority(rolloutPolicy))
    ) {
      return "skip" as const;
    }
    return {
      candidates: candidates.candidates.map((candidate) => ({
        ...(candidate.cloudRegisterSessionId
          ? { cloudRegisterSessionId: candidate.cloudRegisterSessionId }
          : {}),
        localRegisterSessionId: candidate.localRegisterSessionId,
      })),
      storeId: input.storeId,
      syncSecretHash: terminalSeed.syncSecretHash,
      terminalId: input.terminal._id,
    };
  }, [
    candidates,
    input.storeId,
    input.terminal?._id,
    isOnline,
    rolloutPolicy,
    terminalSeed,
  ]);
  const snapshot = useRegisterLifecycleAuthoritySnapshot(queryArgs);
  const snapshotSignature = snapshot
    ? JSON.stringify(snapshot)
    : snapshot === null
      ? "unauthorized"
      : "loading";
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const sendAcknowledgement = useCallback(
    (
      authority: RegisterLifecycleAuthoritySnapshot["results"][number],
      outcome: RegisterLifecycleAuthorityAcknowledgementArgs["outcome"],
    ) => {
      if (
        !input.storeId ||
        !input.terminal?._id ||
        !terminalSeed?.syncSecretHash
      ) {
        return;
      }
      void acknowledgeAuthority({
        ...runtimeBuildMetadata,
        ...(authority.cloudRegisterSessionId
          ? { cloudRegisterSessionId: authority.cloudRegisterSessionId }
          : {}),
        lifecycleRevision: authority.authorityCursor.lifecycleRevision,
        localRegisterSessionId: authority.localRegisterSessionId,
        mappingAuthorityRevision:
          authority.authorityCursor.mappingAuthorityRevision,
        outcome,
        rolloutCohort: resolveRegisterLifecycleAuthorityRolloutCohort(
          rolloutPolicy,
          input.terminal._id,
        ),
        rolloutMode:
          rolloutPolicy.mode === "disabled" ? "shadow" : rolloutPolicy.mode,
        storeId: input.storeId,
        syncSecretHash: terminalSeed.syncSecretHash,
        terminalId: input.terminal._id,
      }).catch(() => undefined);
    },
    [
      acknowledgeAuthority,
      input.storeId,
      input.terminal?._id,
      runtimeBuildMetadata,
      rolloutPolicy,
      terminalSeed?.syncSecretHash,
    ],
  );
  const sendAcknowledgementRef = useRef(sendAcknowledgement);
  sendAcknowledgementRef.current = sendAcknowledgement;

  const authorization =
    useMemo<RegisterLifecycleAuthorityAuthorizationState>(() => {
      if (!isOnline) return { status: "offline" };
      if (queryArgs === "skip") return { status: "not_ready" };
      if (snapshot === undefined) return { status: "loading" };
      if (snapshot === null) return { status: "unauthorized" };
      return { status: "authorized" };
    }, [isOnline, queryArgs, snapshot]);
  const { store, storeId } = input;

  useEffect(() => {
    const currentCandidates = candidatesRef.current;
    if (
      currentCandidates.status === "invalid" &&
      shouldApplyRegisterLifecycleAuthority(
        rolloutPolicy,
        input.terminal?._id ?? "",
      )
    ) {
      setPersistence({ reason: "candidate_invalid", status: "failed" });
    }
  }, [candidatesSignature, input.terminal?._id, rolloutPolicy]);

  useEffect(() => {
    const currentCandidates = candidatesRef.current;
    const currentSnapshot = snapshotRef.current;
    if (
      !currentSnapshot ||
      !terminalSeed ||
      !storeId
    ) {
      return;
    }

    if (currentCandidates.status === "empty") {
      if (!currentSnapshot.bootstrap) {
        return;
      }
      const generation = ++applyGeneration.current;
      let cancelled = false;
      setPersistence({ status: "applying" });
      void seedRegisterSessionAuthorityBootstrap({
        bootstrap: {
          ...currentSnapshot.bootstrap,
          observedAt: Date.now(),
          status: currentSnapshot.bootstrap.cloudStatus,
        },
        store,
        storeId,
        terminalId: terminalSeed.terminalId,
      }).then(async (outcome) => {
        if (cancelled || generation !== applyGeneration.current) return;
        if (
          !outcome.seeded &&
          outcome.seedResult !== "already_seeded"
        ) {
          setPersistence({ reason: "write_failed", status: "failed" });
          onAdvisoryOutcomeRef.current?.({
            appliedCount: 0,
            candidateCount: 0,
            outcome: "persistence_failed",
          });
          return;
        }
        await refreshLocalRegisterReadModelRef.current();
        if (cancelled || generation !== applyGeneration.current) return;
        setPersistence({ status: "ready" });
        onAdvisoryOutcomeRef.current?.({
          appliedCount: 1,
          candidateCount: 0,
          outcome: "applied",
        });
      });
      return () => {
        cancelled = true;
      };
    }

    if (currentCandidates.status !== "ready") return;

    if (
      !shouldApplyRegisterLifecycleAuthority(
        rolloutPolicy,
        input.terminal?._id ?? "",
      )
    ) {
      for (const authority of currentSnapshot.results) {
        sendAcknowledgementRef.current(authority, "shadow_observed");
      }
      setPersistence({ status: "ready" });
      onAdvisoryOutcomeRef.current?.({
        appliedCount: 0,
        candidateCount: currentSnapshot.candidateCount,
        outcome: "shadow_observed",
      });
      return;
    }

    const generation = ++applyGeneration.current;
    let cancelled = false;
    setPersistence({ status: "applying" });

    void applySnapshot({
      candidates: currentCandidates.candidates,
      snapshot: currentSnapshot,
      store,
      storeId,
      terminalId: terminalSeed.terminalId,
      onOutcome: sendAcknowledgementRef.current,
    }).then(async (outcome) => {
      if (cancelled || generation !== applyGeneration.current) return;
      if (outcome.status === "failed") {
        setPersistence({ reason: outcome.reason, status: "failed" });
        onAdvisoryOutcomeRef.current?.({
          appliedCount: outcome.appliedCount,
          candidateCount: currentSnapshot.candidateCount,
          outcome: "persistence_failed",
        });
        return;
      }
      if (outcome.appliedCount > 0) {
        await refreshLocalRegisterReadModelRef.current();
        if (cancelled || generation !== applyGeneration.current) return;
      }
      setPersistence({ status: "ready" });
      onAdvisoryOutcomeRef.current?.({
        appliedCount: outcome.appliedCount,
        candidateCount: currentSnapshot.candidateCount,
        outcome: outcome.acknowledgementOutcome,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    candidatesSignature,
    input.terminal?._id,
    retryToken,
    rolloutPolicy,
    snapshotSignature,
    store,
    storeId,
    terminalSeed,
  ]);

  return { authorization, candidates, persistence, retry };
}

async function applySnapshot(input: {
  candidates: Extract<
    RegisterLifecycleAuthorityCandidateState,
    { status: "ready" }
  >["candidates"];
  snapshot: RegisterLifecycleAuthoritySnapshot;
  store: RegisterLifecycleAuthorityStore;
  storeId: string;
  terminalId: string;
  onOutcome: (
    authority: RegisterLifecycleAuthoritySnapshot["results"][number],
    outcome: RegisterLifecycleAuthorityAcknowledgementArgs["outcome"],
  ) => void;
}): Promise<
  | {
      acknowledgementOutcome:
        "applied" | "already_current" | "stale_ignored" | "repair_required";
      appliedCount: number;
      status: "ready";
    }
  | {
      appliedCount: number;
      reason: Extract<
        RegisterLifecycleAuthorityPersistenceState,
        { status: "failed" }
      >["reason"];
      status: "failed";
    }
> {
  const candidates = new Map(
    input.candidates.map((candidate) => [
      candidate.localRegisterSessionId,
      candidate,
    ]),
  );
  const resultIds = input.snapshot.results.map(
    (authority) => authority.localRegisterSessionId,
  );
  if (
    input.snapshot.candidateCount !== input.candidates.length ||
    input.snapshot.results.length !== input.candidates.length ||
    new Set(resultIds).size !== resultIds.length ||
    resultIds.some(
      (localRegisterSessionId) => !candidates.has(localRegisterSessionId),
    )
  ) {
    return {
      appliedCount: 0,
      reason: "snapshot_invalid",
      status: "failed",
    };
  }
  let appliedCount = 0;
  let sawRepair = false;
  let sawStale = false;
  for (const authority of input.snapshot.results) {
    const candidate = candidates.get(authority.localRegisterSessionId);
    if (!candidate) {
      input.onOutcome(authority, "persistence_failed");
      return { appliedCount, reason: "snapshot_invalid", status: "failed" };
    }
    if (authority.classification === "unmapped") continue;
    if (isRegisterLifecycleRepairClassification(authority.classification)) {
      sawRepair = true;
    }

    let result: Awaited<
      ReturnType<
        RegisterLifecycleAuthorityStore["applyRegisterLifecycleAuthority"]
      >
    >;
    try {
      result = await input.store.applyRegisterLifecycleAuthority({
        expectedMapping: candidate.expectedMapping,
        observation: toObservation(authority, authority.classification),
        storeId: input.storeId,
        terminalId: input.terminalId,
      });
    } catch {
      input.onOutcome(authority, "persistence_failed");
      return { appliedCount, reason: "write_failed", status: "failed" };
    }
    if (!result.ok) {
      input.onOutcome(authority, "persistence_failed");
      return { appliedCount, reason: "write_failed", status: "failed" };
    }
    if (result.value.disposition === "rejected") {
      input.onOutcome(authority, "persistence_failed");
      return {
        appliedCount,
        reason:
          result.value.reason === "mapping_invalidated"
            ? "mapping_invalidated"
            : "snapshot_invalid",
        status: "failed",
      };
    }
    if (result.value.disposition === "applied") {
      appliedCount += 1;
      input.onOutcome(
        authority,
        isRegisterLifecycleRepairClassification(authority.classification)
          ? "repair_required"
          : "applied",
      );
    }
    if (
      result.value.disposition === "noop" &&
      result.value.reason === "stale"
    ) {
      sawStale = true;
      input.onOutcome(authority, "stale_ignored");
    } else if (result.value.disposition === "noop") {
      input.onOutcome(
        authority,
        isRegisterLifecycleRepairClassification(authority.classification)
          ? "repair_required"
          : "already_current",
      );
    }
  }
  return {
    acknowledgementOutcome: sawRepair
      ? "repair_required"
      : appliedCount > 0
        ? "applied"
        : sawStale
          ? "stale_ignored"
          : "already_current",
    appliedCount,
    status: "ready",
  };
}

function toObservation(
  authority: RegisterLifecycleAuthoritySnapshot["results"][number],
  classification: Exclude<
    RegisterLifecycleAuthoritySnapshot["results"][number]["classification"],
    "unmapped"
  >,
) {
  const blocked = authority.classification !== "sale_usable";
  return {
    classification,
    ...(authority.cloudRegisterSessionId
      ? { cloudRegisterSessionId: authority.cloudRegisterSessionId }
      : {}),
    cursor: authority.authorityCursor,
    localRegisterSessionId: authority.localRegisterSessionId,
    observedAt: Date.now(),
    ...(blocked
      ? {
          reason:
            authority.classification === "sale_blocked"
              ? ("cloud_closed" as const)
              : authority.classification === "stale_cloud_subject"
                ? ("cloud_session_missing" as const)
                : ("authority_unknown" as const),
        }
      : {}),
    source: "dedicated_snapshot" as const,
    status: blocked ? ("blocked" as const) : ("healthy" as const),
  };
}

function isRegisterLifecycleRepairClassification(
  classification: RegisterLifecycleAuthoritySnapshot["results"][number]["classification"],
) {
  return (
    classification === "repair_required" ||
    classification === "stale_cloud_subject"
  );
}
