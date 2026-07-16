import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

import {
  POS_APPLICATION_CAPABILITY_ID,
  POS_SERVICE_PRINCIPAL_CONSUMER_ID,
} from "./posServicePrincipal";

const INVALID_MIGRATION_RECOVERY_EVIDENCE =
  "pos_migration_recovery_authority_invalid";

function fail(): never {
  throw new Error(INVALID_MIGRATION_RECOVERY_EVIDENCE);
}

/**
 * Records migration recovery only when the exact activated POS authority tuple
 * is current. Absence is a normal no-op for greenfield stores that were never
 * part of the legacy migration; duplicate or mismatched evidence fails closed.
 */
export async function recordPosTerminalMigrationRecoveryWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    credentialId: Id<"posRecoveryCredential">;
    credentialRevision: number;
    now: number;
    organizationId: Id<"organization">;
    posApplicationSessionBindingId: Id<"posApplicationSessionBinding">;
    recoveryVersion: number;
    servicePrincipalId: Id<"servicePrincipal">;
    servicePrincipalSessionId: Id<"servicePrincipalSession">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const evidenceRows = await ctx.db
    .query("posServicePrincipalMigrationTerminalEvidence")
    .withIndex("by_storeId_terminalId", (query) =>
      query.eq("storeId", args.storeId).eq("terminalId", args.terminalId),
    )
    .take(2);
  if (evidenceRows.length === 0) return null;
  if (evidenceRows.length !== 1) fail();

  const [terminal, principal, credential, serviceSession, applicationBinding] =
    await Promise.all([
      ctx.db.get("posTerminal", args.terminalId),
      ctx.db.get("servicePrincipal", args.servicePrincipalId),
      ctx.db.get("posRecoveryCredential", args.credentialId),
      ctx.db.get("servicePrincipalSession", args.servicePrincipalSessionId),
      ctx.db.get(
        "posApplicationSessionBinding",
        args.posApplicationSessionBindingId,
      ),
    ]);
  const terminalLifecycleRevision = terminal?.lifecycleRevision ?? 1;
  const terminalProofRevision = terminal?.proofRevision ?? 1;
  const evidence = evidenceRows[0];
  if (
    !terminal ||
    terminal.status !== "active" ||
    terminal.storeId !== args.storeId ||
    (terminal.organizationId !== undefined &&
      terminal.organizationId !== args.organizationId) ||
    terminal.servicePrincipalRecoveryVersion !== args.recoveryVersion ||
    !principal ||
    principal.status !== "active" ||
    principal.organizationId !== args.organizationId ||
    principal.storeId !== args.storeId ||
    !credential ||
    credential.status !== "active" ||
    credential.organizationId !== args.organizationId ||
    credential.storeId !== args.storeId ||
    credential.servicePrincipalId !== args.servicePrincipalId ||
    (credential.credentialRevision ?? 1) !== args.credentialRevision ||
    !serviceSession ||
    serviceSession.status !== "active" ||
    serviceSession.organizationId !== args.organizationId ||
    serviceSession.storeId !== args.storeId ||
    serviceSession.servicePrincipalId !== args.servicePrincipalId ||
    serviceSession.consumerId !== POS_SERVICE_PRINCIPAL_CONSUMER_ID ||
    serviceSession.requiredCapabilityId !== POS_APPLICATION_CAPABILITY_ID ||
    serviceSession.principalLifecycleRevision !== principal.lifecycleRevision ||
    !applicationBinding ||
    applicationBinding.status !== "active" ||
    applicationBinding.organizationId !== args.organizationId ||
    applicationBinding.storeId !== args.storeId ||
    applicationBinding.terminalId !== args.terminalId ||
    applicationBinding.servicePrincipalId !== args.servicePrincipalId ||
    applicationBinding.servicePrincipalSessionId !==
      args.servicePrincipalSessionId ||
    applicationBinding.posRecoveryCredentialId !== args.credentialId ||
    applicationBinding.consumerId !== POS_SERVICE_PRINCIPAL_CONSUMER_ID ||
    applicationBinding.capabilityId !== POS_APPLICATION_CAPABILITY_ID ||
    applicationBinding.principalLifecycleRevision !==
      principal.lifecycleRevision ||
    applicationBinding.capabilityRevision !==
      serviceSession.capabilityRevision ||
    applicationBinding.credentialRevision !== args.credentialRevision ||
    applicationBinding.terminalLifecycleRevision !==
      terminalLifecycleRevision ||
    applicationBinding.terminalProofRevision !== terminalProofRevision ||
    !applicationBinding.offlineAuthorityReceipt ||
    evidence.organizationId !== args.organizationId ||
    evidence.storeId !== args.storeId ||
    evidence.terminalId !== args.terminalId ||
    evidence.servicePrincipalId !== args.servicePrincipalId ||
    evidence.status === "dispositioned"
  ) {
    fail();
  }

  if (evidence.status === "recovered") {
    const recoveryTupleChanged =
      evidence.credentialRevision !== args.credentialRevision ||
      evidence.recoveryVersion !== args.recoveryVersion ||
      evidence.servicePrincipalSessionId !== args.servicePrincipalSessionId ||
      evidence.terminalLifecycleRevision !== terminalLifecycleRevision ||
      evidence.terminalProofRevision !== terminalProofRevision;
    if (!recoveryTupleChanged) {
      return evidence;
    }
    if (
      evidence.recoveryVersion === undefined ||
      args.recoveryVersion <= evidence.recoveryVersion
    ) {
      fail();
    }
  }

  await ctx.db.patch(
    "posServicePrincipalMigrationTerminalEvidence",
    evidence._id,
    {
      credentialRevision: args.credentialRevision,
      recoveryVersion: args.recoveryVersion,
      servicePrincipalSessionId: args.servicePrincipalSessionId,
      status: "recovered",
      successfulRecoveryAt: args.now,
      terminalLifecycleRevision,
      terminalProofRevision,
      updatedAt: args.now,
    },
  );
  return ctx.db.get(
    "posServicePrincipalMigrationTerminalEvidence",
    evidence._id,
  );
}
