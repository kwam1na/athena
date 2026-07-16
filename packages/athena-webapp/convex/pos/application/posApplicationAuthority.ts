import type { GenericId } from "convex/values";

import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requireServicePrincipalActorWithCtx } from "../../servicePrincipals/actor";
import { STORE_SERVICE_PRINCIPAL_STABLE_KEY } from "../../servicePrincipals/lifecycle";
import {
  POS_APPLICATION_CAPABILITY_ID,
  POS_SERVICE_PRINCIPAL_CONSUMER_ID,
} from "./posServicePrincipal";

type PosApplicationAuthorityCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

const INVALID_POS_APPLICATION_AUTHORITY =
  "The POS application session is no longer authorized.";

function deny(): never {
  throw new Error(INVALID_POS_APPLICATION_AUTHORITY);
}

function terminalLifecycleRevision(terminal: {
  lifecycleRevision?: number;
}) {
  return terminal.lifecycleRevision ?? 1;
}

function terminalProofRevision(terminal: { proofRevision?: number }) {
  return terminal.proofRevision ?? 1;
}

function credentialRevision(credential: { credentialRevision?: number }) {
  return credential.credentialRevision ?? 1;
}

export async function requirePosApplicationAuthorityWithCtx(
  ctx: PosApplicationAuthorityCtx,
  input: {
    now?: number;
    storeId?: GenericId<"store">;
  } = {},
) {
  const now = input.now ?? Date.now();
  const actor = await requireServicePrincipalActorWithCtx(ctx, { now });
  if (
    actor.consumerId !== POS_SERVICE_PRINCIPAL_CONSUMER_ID ||
    actor.requiredCapabilityId !== POS_APPLICATION_CAPABILITY_ID ||
    (input.storeId !== undefined && input.storeId !== actor.storeId)
  ) {
    deny();
  }

  const session = await ctx.db.get(
    "servicePrincipalSession",
    actor.servicePrincipalSessionId,
  );
  if (
    !session ||
    session.status !== "active" ||
    session.authSessionId !== actor.authSessionId ||
    session.authUserId !== actor.authUserId ||
    session.servicePrincipalAuthBindingId !==
      actor.servicePrincipalAuthBindingId ||
    session.servicePrincipalId !== actor.servicePrincipalId ||
    session.organizationId !== actor.organizationId ||
    session.storeId !== actor.storeId ||
    session.consumerId !== POS_SERVICE_PRINCIPAL_CONSUMER_ID ||
    session.requiredCapabilityId !== POS_APPLICATION_CAPABILITY_ID ||
    session.principalLifecycleRevision !== actor.principalLifecycleRevision ||
    session.capabilityRevision !== actor.capabilityRevision ||
    session.revision !== actor.sessionRevision ||
    now >= session.idleExpiresAt ||
    now >= session.absoluteExpiresAt
  ) {
    deny();
  }

  const bindings = await ctx.db
    .query("posApplicationSessionBinding")
    .withIndex("by_servicePrincipalSessionId", (query) =>
      query.eq("servicePrincipalSessionId", session._id),
    )
    .take(2);
  if (bindings.length !== 1) deny();
  const binding = bindings[0];

  const [store, principal, grant, credential, terminal] = await Promise.all([
    ctx.db.get("store", actor.storeId),
    ctx.db.get("servicePrincipal", actor.servicePrincipalId),
    ctx.db.get("servicePrincipalCapability", binding.capabilityGrantId),
    ctx.db.get("posRecoveryCredential", binding.posRecoveryCredentialId),
    ctx.db.get("posTerminal", binding.terminalId),
  ]);

  if (
    !store ||
    store.organizationId !== actor.organizationId ||
    !principal ||
    principal.status !== "active" ||
    principal.stableKey !== STORE_SERVICE_PRINCIPAL_STABLE_KEY ||
    principal.organizationId !== actor.organizationId ||
    principal.storeId !== actor.storeId ||
    principal.lifecycleRevision !== session.principalLifecycleRevision ||
    !grant ||
    grant.status !== "active" ||
    grant.servicePrincipalId !== principal._id ||
    grant.organizationId !== actor.organizationId ||
    grant.storeId !== actor.storeId ||
    grant.consumerId !== POS_SERVICE_PRINCIPAL_CONSUMER_ID ||
    grant.capabilityId !== POS_APPLICATION_CAPABILITY_ID ||
    grant.revision !== session.capabilityRevision ||
    (grant.expiresAt !== undefined && now >= grant.expiresAt) ||
    !credential ||
    credential.status !== "active" ||
    credential.servicePrincipalId !== principal._id ||
    credential.organizationId !== actor.organizationId ||
    credential.storeId !== actor.storeId ||
    credentialRevision(credential) !== binding.credentialRevision ||
    !terminal ||
    terminal.status !== "active" ||
    terminal.storeId !== actor.storeId ||
    (terminal.organizationId !== undefined &&
      terminal.organizationId !== actor.organizationId) ||
    terminalLifecycleRevision(terminal) !==
      binding.terminalLifecycleRevision ||
    terminalProofRevision(terminal) !== binding.terminalProofRevision ||
    binding.status !== "active" ||
    binding.servicePrincipalSessionId !== session._id ||
    binding.servicePrincipalId !== principal._id ||
    binding.organizationId !== actor.organizationId ||
    binding.storeId !== actor.storeId ||
    binding.capabilityGrantId !== grant._id ||
    binding.posRecoveryCredentialId !== credential._id ||
    binding.terminalId !== terminal._id ||
    binding.consumerId !== POS_SERVICE_PRINCIPAL_CONSUMER_ID ||
    binding.capabilityId !== POS_APPLICATION_CAPABILITY_ID ||
    binding.principalLifecycleRevision !== principal.lifecycleRevision ||
    binding.capabilityRevision !== grant.revision ||
    !binding.offlineAuthorityReceipt
  ) {
    deny();
  }

  return {
    actor,
    capabilityGrantId: grant._id,
    credentialId: credential._id,
    organizationId: actor.organizationId,
    offlineAuthorityReceipt: binding.offlineAuthorityReceipt,
    posApplicationSessionBindingId: binding._id,
    servicePrincipalId: principal._id,
    servicePrincipalSessionId: session._id,
    storeId: actor.storeId,
    terminalId: terminal._id,
  };
}
