import { internal } from "../_generated/api";
import { AGENT_GENERATED_REGISTRY } from "../agentHarness/_generated/registry";
import { createDelegatedAdmission } from "../agentHarness/delegatedAdmission";
import { resolveDurableEnablementWithCtx } from "../agentHarness/deploymentState";
import { createAgentReadPortRegistry } from "../agentHarness/readPorts";
import type { AgentEvidenceExtractor } from "../agentHarness/conformance";
import {
  REGISTER_SESSIONS_EXTRACTOR,
  REGISTER_SESSIONS_MANIFEST,
} from "../cashControls/agentCapabilities/registers";
import { STORE_DAY_EXTRACTOR, STORE_DAY_MANIFEST } from "../operations/agentCapabilities/storeDay";
import { DAY_SALES_EXTRACTOR, DAY_SALES_MANIFEST } from "../reports/agentCapabilities/sales";
import { POSITIONS_EXTRACTOR, POSITIONS_MANIFEST } from "../stockOps/agentCapabilities/inventory";
import { FLEET_STORE_HEALTH_MANIFEST } from "../agentHarness/profiles/syntheticSecondSurface";
import { STORE_HEALTH_UPTIME_EXTRACTOR } from "../agentHarness/profiles/syntheticSecondSurfaceConformance";
import { captureSharedDemoAdmittedActionWithCtx } from "../contextTracking/sharedDemoActionCapture";
import { getStorefrontClaimFromRequest } from "../http/utils";
import { isAthenaUnauthenticatedError } from "../lib/athenaUnauthenticated";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import {
  createNormalUserOperationAdapter,
  createPublicOperationAdapter,
} from "../operationAdmission/adapters";
import {
  HARNESS_WAIVER_BROKER_VERIFIER,
  MARKETING_ORIGIN_VERIFIER,
  MTN_MOMO_CALLBACK_VERIFIER,
  PAYSTACK_SIGNATURE_VERIFIER,
  STOREFRONT_TRACKING_ORIGIN_VERIFIER,
  WHATSAPP_SIGNATURE_VERIFIER,
  createHarnessWaiverBrokerVerifier,
  createMarketingOriginVerifier,
  createMtnMomoCallbackVerifier,
  createPaystackSignatureVerifier,
  createStorefrontTrackingOriginVerifier,
  createWhatsAppSignatureVerifier,
} from "../operationAdmission/ingressVerification";
import { walkthroughAllowedOrigins } from "../marketing/walkthroughConfig";
import { createNormalUserDelegatedAuthorityPort } from "../operationAdmission/delegatedAuthority";
import { createAdmissionRail } from "../operationAdmission/rail";
import {
  createNormalUserReadOperationAdapter,
  createPublicReadOperationAdapter,
} from "../operationAdmission/readAdapters";
import type { MutationCtx } from "../_generated/server";
import type {
  OperationDefinition,
  OperationMutationCtx,
  OperationResourceGuards,
  OperationScopeConstraints,
} from "../operationAdmission/types";
import { createSharedDemoDelegatedAuthorityPort } from "../sharedDemo/delegatedAuthority";
import { createSharedDemoOperationAdapter } from "../sharedDemo/operationAdapter";
import { createSharedDemoReadOperationAdapter } from "../sharedDemo/readOperationAdapter";
import {
  requireNonDemoFoundationExternalRefs,
  requireNonDemoFoundationMutation,
} from "../sharedDemo/foundation";
import {
  createStorefrontCustomerOperationAdapter,
  createStorefrontCustomerReadOperationAdapter,
} from "../storeFront/operationAdapter";

/**
 * Composition root for the operation admission rail.
 *
 * This is the ONLY module that knows both the rail and the policies it
 * enforces. The rail core (`convex/operationAdmission/**`) imports nothing but
 * itself, `_generated`, and the platform catalogs; every adapter, resource
 * guard, capture port, and ingress verifier is registered here, so adding an
 * actor kind later is a registration rather than a change to the rail.
 *
 * Adapter order is trust order: shared demo -> normal user -> storefront
 * customer -> public. The chain falls through only on `unauthenticated` /
 * `not_applicable`; a recognized denial from any adapter is terminal.
 */

/**
 * Identity port for the normal-user adapter.
 *
 * "No Athena identity here" is `null`, so the chain may fall through to a
 * lower-trust adapter; anything else is a failure that propagates.
 */
const resolveAthenaUser = async (
  ctx: Parameters<typeof requireAuthenticatedAthenaUserWithCtx>[0],
) => {
  try {
    return await requireAuthenticatedAthenaUserWithCtx(ctx);
  } catch (error) {
    // Typed, not textual: only "there is no Athena identity here" becomes a
    // fall-through. Every other failure — a broken scope lookup, a database
    // error — propagates, which is what removes the old catch-all that could
    // re-admit any throw as `public`.
    if (isAthenaUnauthenticatedError(error)) return null;
    throw error;
  }
};

const resourceGuards: OperationResourceGuards = {
  protectDemoFoundation: (target) => {
    requireNonDemoFoundationMutation(target);
  },
  protectDemoFoundationExternalRefs: (refs) => {
    requireNonDemoFoundationExternalRefs([...refs]);
  },
};

export const operationAdmissionRail = createAdmissionRail({
  adapters: [
    createSharedDemoOperationAdapter(),
    createNormalUserOperationAdapter({ resolveAthenaUser }),
    createStorefrontCustomerOperationAdapter(),
    createPublicOperationAdapter(),
  ],
  readAdapters: [
    createSharedDemoReadOperationAdapter(),
    createNormalUserReadOperationAdapter({ resolveAthenaUser }),
    createStorefrontCustomerReadOperationAdapter(),
    createPublicReadOperationAdapter(),
  ],
  resourceGuards,
  capture: captureSharedDemoAdmittedActionWithCtx,
  // Registered signature verifiers. Each one fails closed without its secret
  // and compares in constant time; the rail core only sequences them.
  ingressVerifiers: {
    [HARNESS_WAIVER_BROKER_VERIFIER]: createHarnessWaiverBrokerVerifier(),
    // One resolver for WALKTHROUGH_ALLOWED_ORIGINS, shared with the handler.
    [MARKETING_ORIGIN_VERIFIER]: createMarketingOriginVerifier(
      walkthroughAllowedOrigins,
    ),
    [MTN_MOMO_CALLBACK_VERIFIER]: createMtnMomoCallbackVerifier(),
    [PAYSTACK_SIGNATURE_VERIFIER]: createPaystackSignatureVerifier(),
    [STOREFRONT_TRACKING_ORIGIN_VERIFIER]:
      createStorefrontTrackingOriginVerifier(),
    [WHATSAPP_SIGNATURE_VERIFIER]: createWhatsAppSignatureVerifier(),
  },
  entrypoints: {
    admitOperation: internal.platform.admissionEntrypoints.admitOperation,
    admitReadOperation:
      internal.platform.admissionEntrypoints.admitReadOperation,
  },
  extractIngressClaim: getStorefrontClaimFromRequest,
});

export const admitHttpRead = operationAdmissionRail.admitHttpRead;
export const admitHttpRoute = operationAdmissionRail.admitHttpRoute;
export const admitPublicAction = operationAdmissionRail.admitPublicAction;
export const admitPublicMutation = operationAdmissionRail.admitPublicMutation;
export const admitPublicQuery = operationAdmissionRail.admitPublicQuery;

/** Handlers behind the registered internal admission entry points. */
export const admitOperationWithCtx =
  operationAdmissionRail.admitOperationWithCtx;
export const admitReadOperationWithCtx =
  operationAdmissionRail.admitReadOperationWithCtx;

export type { OperationScopeConstraints };

/*
 * Delegated agent admission (V26-1262) — the second composition here.
 *
 * An agent run never becomes an actor of the rail above. It holds a derived
 * grant: the operator who opened the turn was admitted by the public rail, and
 * every capability read the run triggers re-reads that operator's CURRENT
 * authority through the port registered for their kind (normal user →
 * membership and store scope; shared demo → principal, session, and the demo
 * read-intent grant), intersects it with the grant pinned at run start and the
 * live kill switch, and dispatches only to a read port the generated registry
 * names AND this file binds to an `internal.*` query. Unbound ports are
 * unreachable; a binding whose function name is not the registered path fails
 * here, at composition time.
 *
 * U8 registers a package's ports by appending `{ portKey, handler: internal.<module>.<export> }`
 * entries below after `bun run agent-sdk:generate`; the port module itself is
 * written with `defineAgentReadPortQuery` exported from this file.
 */
export const agentReadPorts = createAgentReadPortRegistry({
  registry: AGENT_GENERATED_REGISTRY,
  bindings: [
    // Synthetic second surface (U2/U3). Placeholder handlers until U10.
    { portKey: "fleet.stores", handler: internal.agentHarness.profiles.syntheticSecondSurfacePorts.listStores },
    { portKey: "fleet.storeHealth", handler: internal.agentHarness.profiles.syntheticSecondSurfacePorts.getStoreHealth },
    { portKey: "directory.teams", handler: internal.agentHarness.profiles.syntheticSecondSurfacePorts.listTeams },
    // Daily Operations (U8). Each port module is written with
    // `defineAgentReadPortQuery` below and colocated with its domain read code.
    { portKey: "operations.storeDay", handler: internal.operations.agentCapabilities.storeDayPorts.getStoreDay },
    { portKey: "operations.attention", handler: internal.operations.agentCapabilities.workPorts.listAttention },
    { portKey: "operations.approvals", handler: internal.operations.agentCapabilities.workPorts.listApprovals },
    { portKey: "operations.activity", handler: internal.operations.agentCapabilities.activityPorts.listActivity },
    { portKey: "reports.daySales", handler: internal.reports.agentCapabilities.salesPorts.getDaySales },
    { portKey: "reports.weekPerformance", handler: internal.reports.agentCapabilities.salesPorts.getWeekPerformance },
    { portKey: "reports.storePulse", handler: internal.reports.agentCapabilities.salesPorts.getStorePulse },
    {
      portKey: "cash.registerSessions",
      handler: internal.cashControls.agentCapabilities.registersPorts.readRegisterSessions,
    },
    {
      portKey: "automation.dailyOperations",
      handler: internal.automation.agentCapabilities.evidencePorts.listAutomationEvidence,
    },
    { portKey: "inventory.positions", handler: internal.stockOps.agentCapabilities.inventoryPorts.readPositions },
    {
      portKey: "inventory.replenishment",
      handler: internal.stockOps.agentCapabilities.inventoryPorts.listReplenishment,
    },
  ],
});

/**
 * Manifest-declared evidence extractors, resolved by capability id.
 *
 * The kernel may never import a product domain, and a domain port module must
 * import THIS file for `defineAgentReadPortQuery`. So the index is built here,
 * from the DECLARATION half of each package (manifests plus extractors, no
 * database access), which imports nothing from this module and therefore
 * creates no cycle. `convex/agentHarness/executorSeams.ts` resolves through it
 * when it mints claim support at completion; an unregistered capability simply
 * yields provenance-only evidence, which is the honest fail-closed default.
 */
const AGENT_EVIDENCE_EXTRACTORS: { readonly [capabilityId: string]: AgentEvidenceExtractor } = {
  [STORE_DAY_MANIFEST.capabilityId]: STORE_DAY_EXTRACTOR,
  [DAY_SALES_MANIFEST.capabilityId]: DAY_SALES_EXTRACTOR,
  [REGISTER_SESSIONS_MANIFEST.capabilityId]: REGISTER_SESSIONS_EXTRACTOR,
  [POSITIONS_MANIFEST.capabilityId]: POSITIONS_EXTRACTOR,
  [FLEET_STORE_HEALTH_MANIFEST.capabilityId]: STORE_HEALTH_UPTIME_EXTRACTOR,
};

export function resolveAgentEvidenceExtractor(capabilityId: string): AgentEvidenceExtractor | undefined {
  return AGENT_EVIDENCE_EXTRACTORS[capabilityId];
}

export const agentDelegatedAdmission = createDelegatedAdmission({
  registry: AGENT_GENERATED_REGISTRY,
  readPorts: agentReadPorts,
  authorityPorts: {
    normal_user: createNormalUserDelegatedAuthorityPort(),
    shared_demo: createSharedDemoDelegatedAuthorityPort(),
  },
  // The live shrink-only overlay (U7): the published baseline narrowed by the
  // durable profile/capability switches, every profile DEFAULT OFF. Read on
  // every delegated check, so a flipped switch denies immediately.
  resolveEnablement: (ctx) => resolveDurableEnablementWithCtx(ctx, AGENT_GENERATED_REGISTRY.enablement),
});

/** Run start (U7): pin the grant. `prepareAgentRunGrantWithCtx` feeds `recordTurnIntentWithCtx`. */
export const prepareAgentRunGrantWithCtx = agentDelegatedAdmission.prepareRunGrantWithCtx;
export const materializeAgentRunGrantWithCtx = agentDelegatedAdmission.materializeRunGrantWithCtx;
/** Any time (U6/U7/U9): re-derive the effective grant for a purpose. */
export const reauthorizeAgentGrantWithCtx = agentDelegatedAdmission.reauthorizeGrantWithCtx;
export const describeAgentGrantForModel = agentDelegatedAdmission.describeGrantForModel;
/** Bridge (U6): before dispatch, then before the result becomes program-visible. */
export const admitAgentCapabilityCallWithCtx = agentDelegatedAdmission.admitCapabilityCallWithCtx;
export const releaseAgentCapabilityResultWithCtx = agentDelegatedAdmission.releaseCapabilityResultWithCtx;
/** Citations (U6) and completion (U6/U7): in the same transaction as the mint/commit. */
export const reauthorizeAgentCitationsWithCtx = agentDelegatedAdmission.reauthorizeCitationsWithCtx;
export const reauthorizeAgentCompletionWithCtx = agentDelegatedAdmission.reauthorizeCompletionWithCtx;
/** Port authors (U8/U10): the only way to define a dispatchable read port. */
export const defineAgentReadPortQuery = agentDelegatedAdmission.defineAgentReadPortQuery;

/*
 * `resolveWriteAdmission` is deliberately NOT re-exported.
 *
 * It existed so a handler could resolve admission, catch the denial, and map
 * it to a `CommandResult`. In practice every call site paired it with a second
 * `admitPublicMutation` call, admitting the same request twice and doing the
 * probe BEFORE the wrapper — so work ran for a caller nobody had admitted yet.
 * The checker now rejects that shape (`wrapper-not-first`), and all nine sites
 * were converted to a single admission with the mapping in a catch around the
 * wrapper call. Exporting it again would re-open the double-admission door.
 */
