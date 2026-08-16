import type { OperationDefinition, OperationScopeResolver } from "../types";
import { defineOperation } from "./_shapes";

/**
 * U9 - platform/misc modules - write/action/http operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `definitions.ts` never need to
 * change again: the owning unit fills this array and edits nothing else.
 *
 * Capabilities come from the closed classification already published in
 * `platform/capabilityCatalog.ts` (`PUBLIC_WRITE_MODULE_CAPABILITIES` for these
 * modules), so a migrated definition never re-classifies a write the catalog
 * already named. `actors.sharedDemo` is derived, not chosen: `"admit"` exactly
 * when the capability is demo-granted, otherwise an explicit `"deny"`.
 *
 * Two provider-facing families live here, and both declare the
 * `integration.dispatch` gateway rather than relying on the actor policy alone:
 * the Cloudflare Stream actions and the intelligence/LLM actions reach an
 * external provider, and `integration.dispatch` is classified `denied` for a
 * demo actor, so the effect check stops a demo caller BEFORE any provider call
 * even if the actor policy were ever loosened.
 */

/** organizationId lives on the row this operation names, not in the arguments. */
function resolveOrganizationFromRow(
  table: "remoteAssistClient" | "remoteAssistSession",
  idArg: string,
): OperationScopeResolver {
  return async (ctx, args) => {
    const id = args[idArg];
    if (typeof id !== "string") return {};
    const row = await ctx.db.get(table, id as never);
    return row ? { organizationId: row.organizationId } : {};
  };
}

// --- cloudflare/stream ----------------------------------------------------
// Re-expresses the retired `requireAuthenticatedNonDemoEffect` guard that ran
// at the top of every one of these actions: authenticated Athena user only
// (`normalUser: "admit"`, `public: "deny"`), never a demo principal
// (`sharedDemo: "deny"`), and the provider hop is named as a protected effect.

function streamAction(args: {
  functionName: string;
  operationId: string;
  scope?: OperationDefinition["scope"];
}) {
  return defineOperation({
    kind: "action" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: "integrations.manage" as const,
    scope: args.scope ?? { kind: "none" as const },
    readiness: { kind: "none" as const },
    effects: {
      mode: "protected" as const,
      gateways: ["integration.dispatch"] as const,
    },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });
}

export const streamGetDirectUploadUrlOperationDefinition = streamAction({
  functionName: "cloudflare/stream:getDirectUploadUrl",
  operationId: "cloudflare/stream.getDirectUploadUrl",
});

export const streamGetVideoStatusOperationDefinition = streamAction({
  functionName: "cloudflare/stream:getVideoStatus",
  operationId: "cloudflare/stream.getVideoStatus",
});

export const streamDeleteVideoOperationDefinition = streamAction({
  functionName: "cloudflare/stream:deleteVideo",
  operationId: "cloudflare/stream.deleteVideo",
});

export const streamAddStreamReelVersionOperationDefinition = streamAction({
  functionName: "cloudflare/stream:addStreamReelVersion",
  operationId: "cloudflare/stream.addStreamReelVersion",
  scope: { kind: "store", storeIdArg: "storeId" },
});

export const streamDeleteStreamReelVersionOperationDefinition = streamAction({
  functionName: "cloudflare/stream:deleteStreamReelVersion",
  operationId: "cloudflare/stream.deleteStreamReelVersion",
  scope: { kind: "store", storeIdArg: "storeId" },
});

export const streamSetActiveStreamReelOperationDefinition = streamAction({
  functionName: "cloudflare/stream:setActiveStreamReel",
  operationId: "cloudflare/stream.setActiveStreamReel",
  scope: { kind: "store", storeIdArg: "storeId" },
});

// --- contextTracking ------------------------------------------------------

/**
 * The docs-workspace visit is recorded for signed-out readers too: the retired
 * handler used `getAuthenticatedAthenaUserWithCtx` (the OPTIONAL variant) and
 * attributed an anonymous visit to its session id, so `public: "admit"` is what
 * keeps that behavior. `workspace.telemetry.write` is not demo-granted, so a
 * demo principal is an explicit denial rather than an unattributed write. (The
 * demo reports its own activity through `recordSharedDemoActivity` below,
 * which is the demo-only surface for exactly this.)
 */
export const recordDocsWorkspaceVisitOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "contextTracking/athenaWebappEvents:recordDocsWorkspaceVisit",
  operationId: "contextTracking/athenaWebappEvents.recordDocsWorkspaceVisit",
  capability: "workspace.telemetry.write",
  scope: { kind: "none" },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: {
    normalUser: "admit",
    sharedDemo: "deny",
    public: "admit",
  },
});

/**
 * Demo activity capture is a DEMO-ONLY write: the retired handler resolved the
 * visitor with `getSharedDemoActorWithCtx` and dropped the observation when no
 * demo principal was present. The successor is the shared-demo adapter itself —
 * the store, organization, and per-visitor auth user now arrive as the admitted
 * actor, so the browser can no longer be the source of any of them. No store
 * argument exists, so the clamp is the actor's own store.
 *
 * The capability is `demo.lifecycle` rather than the module's catalog default
 * `workspace.telemetry.write`, for two reasons. First, this write is
 * demo-ONLY: no other actor kind can produce a shared-demo activity event, so
 * classifying it as generic workspace telemetry misnames it. Second,
 * `SHARED_DEMO_ALLOWED_CAPABILITIES` is keyed by capability, so granting
 * `workspace.telemetry.write` to the demo would ALSO hand the demo
 * `recordDocsWorkspaceVisit` above — a real widening of demo reach for no
 * reason. `demo.lifecycle` is the demo's own capability and widens nothing.
 *
 * Readiness is `none` for the same reason `sharedDemo/public:requestManualRestore`
 * carries none: `shared_demo.restore_observed` is one of the events a browser
 * reports, so fencing this write behind a ready store would silence exactly the
 * observation that reports a restore.
 */
export const recordSharedDemoActivityOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "contextTracking/sharedDemoEvents:recordSharedDemoActivity",
  operationId: "contextTracking/sharedDemoEvents.recordSharedDemoActivity",
  capability: "demo.lifecycle",
  scope: { kind: "none" },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: {
    normalUser: "deny",
    sharedDemo: "admit",
    public: "deny",
  },
});

// --- harnessWaiver --------------------------------------------------------
// The waiver ceremony is PRE-AUTH by construction: the harness client holds an
// enrollment token and the reviewer's approval page holds an opaque approval
// token, and neither carries an Athena session. `public: "admit"` preserves
// that; the token checks inside each handler remain the real boundary.

function waiverCeremonyAction(functionName: string) {
  return defineOperation({
    kind: "action" as const,
    functionName: `harnessWaiver/passkeys:${functionName}`,
    operationId: `harnessWaiver/passkeys.${functionName}`,
    capability: "identity.authenticate" as const,
    scope: { kind: "none" as const },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "admit" as const,
    },
  });
}

export const waiverBeginRegistrationOperationDefinition =
  waiverCeremonyAction("beginRegistration");
export const waiverCompleteRegistrationOperationDefinition =
  waiverCeremonyAction("completeRegistration");
export const waiverGetApprovalOptionsOperationDefinition =
  waiverCeremonyAction("getApprovalOptions");
export const waiverCompleteApprovalOperationDefinition =
  waiverCeremonyAction("completeApproval");

/**
 * Authorizing an enrollment is the one waiver write that requires a signed-in
 * reviewer (`requireAuthenticatedAthenaUserWithCtx` + the configured reviewer
 * email), so it stays `public: "deny"`.
 */
export const waiverAuthorizeRegistrationOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "harnessWaiver/registrationAuthorization:authorizeRegistration",
  operationId:
    "harnessWaiver/registrationAuthorization.authorizeRegistration",
  capability: "administration.maintenance",
  scope: { kind: "none" },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: {
    normalUser: "admit",
    sharedDemo: "deny",
    public: "deny",
  },
});

// --- intelligence + llm ---------------------------------------------------
// Generation reaches an external model provider, so the demo is denied twice
// over: `intelligence.generate` is not demo-granted AND `integration.dispatch`
// is a denied gateway. Both denials land at admission, before the prompt is
// built and before any provider request is issued.

function insightGenerationAction(args: {
  functionName: string;
  operationId: string;
}) {
  return defineOperation({
    kind: "action" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: "intelligence.generate" as const,
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: { kind: "none" as const },
    effects: {
      mode: "protected" as const,
      gateways: ["integration.dispatch"] as const,
    },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });
}

export const generateStoreInsightsOperationDefinition =
  insightGenerationAction({
    functionName: "intelligence/capabilities/actions:generateStoreInsights",
    operationId: "intelligence/capabilities/actions.generateStoreInsights",
  });

export const generateUserInsightsOperationDefinition = insightGenerationAction({
  functionName: "intelligence/capabilities/actions:generateUserInsights",
  operationId: "intelligence/capabilities/actions.generateUserInsights",
});

export const llmStoreInsightsGetStoreInsightsOperationDefinition =
  insightGenerationAction({
    functionName: "llm/storeInsights:getStoreInsightsFromLlm",
    operationId: "llm/storeInsights.getStoreInsightsFromLlm",
  });

export const llmUserInsightsGetUserInsightsOperationDefinition =
  insightGenerationAction({
    functionName: "llm/userInsights:getUserInsightsFromLlm",
    operationId: "llm/userInsights.getUserInsightsFromLlm",
  });

export const llmUserInsightsGetStoreInsightsOperationDefinition =
  insightGenerationAction({
    functionName: "llm/userInsights:getStoreInsightsFromLlm",
    operationId: "llm/userInsights.getStoreInsightsFromLlm",
  });

/**
 * Dismissal is scoped by the ARTIFACT's own store, never by a caller-supplied
 * one — the handler already refused a store-less artifact and re-authorized
 * against `artifact.storeId`, and the resolver reproduces exactly that.
 */
export const dismissIntelligenceArtifactOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "intelligence/runs:dismissArtifact",
  operationId: "intelligence/runs.dismissArtifact",
  capability: "intelligence.manage",
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const artifactId = args.artifactId;
      if (typeof artifactId !== "string") return {};
      const artifact = await ctx.db.get(
        "intelligenceArtifact",
        artifactId as never,
      );
      if (!artifact?.storeId) return {};
      return { storeId: artifact.storeId };
    },
  },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: {
    normalUser: "admit",
    sharedDemo: "deny",
    public: "deny",
  },
});

// --- remoteAssist ---------------------------------------------------------
// Both writes resolve their organization from the TARGET ROW (client/session),
// never from a caller-supplied org, and the handlers keep their own
// `requireOrganizationMemberRoleWithCtx("full_admin")` check. A missing row
// resolves to no constraint so the handler can still return its `user_error`
// CommandResult rather than throwing an admission denial.

export const remoteAssistStartSessionOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "remoteAssist/public:startSession",
  operationId: "remoteAssist/public.startSession",
  capability: "remote_assist.manage",
  scope: {
    kind: "organization",
    resolve: resolveOrganizationFromRow("remoteAssistClient", "clientId"),
  },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: {
    normalUser: "admit",
    sharedDemo: "deny",
    public: "deny",
  },
});

export const remoteAssistEndSupportSessionOperationDefinition = defineOperation(
  {
    kind: "mutation" as const,
    functionName: "remoteAssist/public:endSupportSession",
    operationId: "remoteAssist/public.endSupportSession",
    capability: "remote_assist.manage",
    scope: {
      kind: "organization",
      resolve: resolveOrganizationFromRow("remoteAssistSession", "sessionId"),
    },
    readiness: { kind: "none" },
    effects: { mode: "none" },
    actors: {
      normalUser: "admit",
      sharedDemo: "deny",
      public: "deny",
    },
  },
);

/**
 * Minting a live-transport credential is an external provider dispatch, hence
 * the `integration.dispatch` gateway.
 *
 * The two callers are NOT the same actor. Support joins as a signed-in
 * full-admin, so that action stays `public: "deny"`. The POS runtime joins with
 * a terminal sync-secret proof and no Athena session at all, so
 * `requestRuntimeCredential` must admit anonymously — its real boundary is the
 * terminal proof re-checked inside `transportInternal.prepareRuntimeCredential`
 * against the row's own `syncSecretHash`.
 */
export const remoteAssistRequestSupportCredentialOperationDefinition =
  defineOperation({
    kind: "action" as const,
    functionName: "remoteAssist/transport:requestSupportCredential",
    operationId: "remoteAssist/transport.requestSupportCredential",
    capability: "remote_assist.manage",
    scope: { kind: "none" },
    readiness: { kind: "none" },
    effects: { mode: "protected", gateways: ["integration.dispatch"] },
    actors: {
      normalUser: "admit",
      sharedDemo: "deny",
      public: "deny",
    },
  });

export const remoteAssistRequestRuntimeCredentialOperationDefinition =
  defineOperation({
    kind: "action" as const,
    functionName: "remoteAssist/transport:requestRuntimeCredential",
    operationId: "remoteAssist/transport.requestRuntimeCredential",
    capability: "remote_assist.manage",
    scope: { kind: "store", storeIdArg: "storeId" },
    readiness: { kind: "none" },
    effects: { mode: "protected", gateways: ["integration.dispatch"] },
    actors: {
      normalUser: "admit",
      sharedDemo: "deny",
      public: "admit",
    },
  });

// --- sharedDemo/admission -------------------------------------------------

/**
 * Minting a demo ticket is the entry point to the demo itself, so every actor
 * kind is admitted: the visitor who opens the demo has no identity yet, and a
 * signed-in Athena user or an existing demo visitor may open it too.
 * `demo.lifecycle` is the demo's own capability, which is why this is the one
 * demo-admitted write that carries no restore fence — the fence protects demo
 * DATA, and this call mints an admission ticket rather than touching store rows.
 */
export const issueSharedDemoTicketOperationDefinition = defineOperation({
  kind: "action" as const,
  functionName: "sharedDemo/admission:issueSharedDemoTicket",
  operationId: "sharedDemo/admission.issueSharedDemoTicket",
  capability: "demo.lifecycle",
  scope: { kind: "none" },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: {
    normalUser: "admit",
    sharedDemo: "admit",
    public: "admit",
  },
});

export const U9_PLATFORM_OPERATION_DEFINITIONS: readonly OperationDefinition[] =
  [
    streamGetDirectUploadUrlOperationDefinition,
    streamGetVideoStatusOperationDefinition,
    streamDeleteVideoOperationDefinition,
    streamAddStreamReelVersionOperationDefinition,
    streamDeleteStreamReelVersionOperationDefinition,
    streamSetActiveStreamReelOperationDefinition,
    recordDocsWorkspaceVisitOperationDefinition,
    recordSharedDemoActivityOperationDefinition,
    waiverBeginRegistrationOperationDefinition,
    waiverCompleteRegistrationOperationDefinition,
    waiverGetApprovalOptionsOperationDefinition,
    waiverCompleteApprovalOperationDefinition,
    waiverAuthorizeRegistrationOperationDefinition,
    generateStoreInsightsOperationDefinition,
    generateUserInsightsOperationDefinition,
    llmStoreInsightsGetStoreInsightsOperationDefinition,
    llmUserInsightsGetUserInsightsOperationDefinition,
    llmUserInsightsGetStoreInsightsOperationDefinition,
    dismissIntelligenceArtifactOperationDefinition,
    remoteAssistStartSessionOperationDefinition,
    remoteAssistEndSupportSessionOperationDefinition,
    remoteAssistRequestSupportCredentialOperationDefinition,
    remoteAssistRequestRuntimeCredentialOperationDefinition,
    issueSharedDemoTicketOperationDefinition,
  ];
