import type {
  OperationReadDefinition,
  OperationScopeResolver,
} from "../types";
import { defineReadOperation } from "./_shapes";

/**
 * U9 - platform/misc modules - read (query/http_read) operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `readDefinitions.ts` never need
 * to change again: the owning unit fills this array and edits nothing else.
 *
 * Intents come from the CLOSED `platform/readIntentCatalog.ts`; this unit is
 * the first consumer of `identity.view`, `intelligence.view`,
 * `remote_assist.view`, and `demo.context.view`, all of which were seeded there
 * in U1c for exactly these reads.
 */

/** organizationId lives on the row this read names, not in the arguments. */
function resolveOrganizationFromRow(
  table: "remoteAssistClient",
  idArg: string,
): OperationScopeResolver {
  return async (ctx, args) => {
    const id = args[idArg];
    if (typeof id !== "string") return {};
    const row = await ctx.db.get(table, id as never);
    return row ? { organizationId: row.organizationId } : {};
  };
}

// --- app ------------------------------------------------------------------
/**
 * "Who am I" is the webapp's bootstrap read: `useAuth` issues it on every page
 * for every actor, and both handlers already answer `null` for a caller with no
 * identity. `public: "admit"` is what preserves that null rather than turning a
 * signed-out page load into a thrown denial, and the demo runtime is the same
 * webapp, so a demo principal is admitted too — `identity.view` observes only
 * the caller's OWN row, so admitting it widens nothing about the demo store.
 */
function identityRead(functionName: string, operationId: string) {
  return defineReadOperation({
    kind: "query" as const,
    functionName,
    operationId,
    access: { kind: "read" as const, intent: "identity.view" as const },
    scope: { kind: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: "admit" as const,
    },
  });
}

export const getCurrentUserReadDefinition = identityRead(
  "app:getCurrentUser",
  "app.getCurrentUser.read",
);

export const getCurrentUserIdentityReadDefinition = identityRead(
  "app:getCurrentUserIdentity",
  "app.getCurrentUserIdentity.read",
);

// --- otp ------------------------------------------------------------------
/**
 * The login form asks this BEFORE any session exists, so it must stay
 * anonymous. It is unreachable from the demo (the demo never renders the Athena
 * login form), so the demo is an explicit denial rather than an admission.
 */
export const checkAppLoginEmailApprovalReadDefinition = defineReadOperation({
  kind: "query",
  functionName: "otp/appLoginEmailAllowlist:checkAppLoginEmailApproval",
  operationId: "otp/appLoginEmailAllowlist.checkAppLoginEmailApproval.read",
  access: { kind: "read", intent: "identity.view" },
  scope: { kind: "none" },
  actors: {
    normalUser: "admit",
    sharedDemo: "deny",
    public: "admit",
  },
});

// --- intelligence ---------------------------------------------------------
// Every one of these keeps its handler-local `requireStoreFullAdminAccess`:
// admission clamps the store, the handler still proves full-admin access to it.
// `intelligence.view` is not demo-granted, so the demo is denied.

function intelligenceRead(functionName: string, operationId: string) {
  return defineReadOperation({
    kind: "query" as const,
    functionName,
    operationId,
    access: { kind: "read" as const, intent: "intelligence.view" as const },
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });
}

export const latestArtifactReadDefinition = intelligenceRead(
  "intelligence/runs:latestArtifact",
  "intelligence/runs.latestArtifact.read",
);

export const latestArtifactBySubjectReadDefinition = intelligenceRead(
  "intelligence/runs:latestArtifactBySubject",
  "intelligence/runs.latestArtifactBySubject.read",
);

export const latestRunDebugReadDefinition = intelligenceRead(
  "intelligence/runs:latestRunDebug",
  "intelligence/runs.latestRunDebug.read",
);

// --- remoteAssist ---------------------------------------------------------

export const getClientByRuntimeReadDefinition = defineReadOperation({
  kind: "query",
  functionName: "remoteAssist/public:getClientByRuntime",
  operationId: "remoteAssist/public.getClientByRuntime.read",
  access: { kind: "read", intent: "remote_assist.view" },
  scope: { kind: "organization", organizationIdArg: "organizationId" },
  actors: {
    normalUser: "admit",
    sharedDemo: "deny",
    public: "deny",
  },
});

/**
 * Scope resolves from the CLIENT row, matching the handler, which reads the
 * client first and then authorizes against `client.organizationId` rather than
 * anything the caller named. A missing client resolves to no constraint so the
 * handler can keep returning `null`.
 */
export const getCurrentSessionByClientReadDefinition = defineReadOperation({
  kind: "query",
  functionName: "remoteAssist/public:getCurrentSessionByClient",
  operationId: "remoteAssist/public.getCurrentSessionByClient.read",
  access: { kind: "read", intent: "remote_assist.view" },
  scope: {
    kind: "organization",
    resolve: resolveOrganizationFromRow("remoteAssistClient", "clientId"),
  },
  actors: {
    normalUser: "admit",
    sharedDemo: "deny",
    public: "deny",
  },
});

// --- sharedDemo/public ----------------------------------------------------
/**
 * These two are how ANY caller discovers whether it is in the demo: both
 * handlers answer `null` when no demo principal is present, and the webapp
 * calls them from normal and signed-out sessions alike. Denying a normal or
 * anonymous caller here would turn that `null` into a thrown denial on every
 * ordinary page load, so all three actors are admitted and the handler's own
 * `requireSharedDemoActorWithCtx` remains what separates a demo answer from
 * `null`. `demo.context.view` is already in the demo read grant set.
 */
function demoContextRead(functionName: string, operationId: string) {
  return defineReadOperation({
    kind: "query" as const,
    functionName,
    operationId,
    access: { kind: "read" as const, intent: "demo.context.view" as const },
    scope: { kind: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: "admit" as const,
    },
  });
}

export const getSharedDemoContextReadDefinition = demoContextRead(
  "sharedDemo/public:getContext",
  "sharedDemo/public.getContext.read",
);

export const getSharedDemoRegisterBootstrapReadDefinition = demoContextRead(
  "sharedDemo/public:getRegisterBootstrap",
  "sharedDemo/public.getRegisterBootstrap.read",
);

export const PLATFORM_READ_DEFINITIONS: readonly OperationReadDefinition[] =
  [
    getCurrentUserReadDefinition,
    getCurrentUserIdentityReadDefinition,
    checkAppLoginEmailApprovalReadDefinition,
    latestArtifactReadDefinition,
    latestArtifactBySubjectReadDefinition,
    latestRunDebugReadDefinition,
    getClientByRuntimeReadDefinition,
    getCurrentSessionByClientReadDefinition,
    getSharedDemoContextReadDefinition,
    getSharedDemoRegisterBootstrapReadDefinition,
  ];
