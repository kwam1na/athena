import { internal } from "../_generated/api";
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
