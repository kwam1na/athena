import type { OperationReadDefinition } from "../types";
import { defineReadOperation, definePosRead } from "./_shapes";

/**
 * U2 - pos/** - read (query/http_read) operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `readDefinitions.ts` never need
 * to change again: the owning unit fills this array and edits nothing else.
 *
 * Every POS read observes the `pos.view` surface, which is in
 * `SHARED_DEMO_ALLOWED_READ_INTENTS`, so shared demo is admitted and then
 * clamped to its own store. The terminal-proof reads (`syncSecretHash`) carry
 * no Athena identity today, so they keep `public: "admit"`; the operator reads
 * that require an authenticated Athena user keep `public: "deny"`.
 */

/** A `pos.view` store read that a terminal reaches with its sync secret only. */
function terminalProofPosRead(functionName: string, operationId: string) {
  return defineReadOperation({
    kind: "query" as const,
    functionName,
    operationId,
    access: { kind: "read" as const, intent: "pos.view" as const },
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: "admit" as const,
    },
  });
}

// --- pos/public/catalog ----------------------------------------------------

export const listPendingCheckoutItemsForReviewReadDefinition = definePosRead(
  "pos/public/catalog:listPendingCheckoutItemsForReview",
  "pos/public/catalog.listPendingCheckoutItemsForReview",
);

export const listPendingCheckoutProductPageBindingReadDefinition =
  definePosRead(
    "pos/public/catalog:listPendingCheckoutProductPageBinding",
    "pos/public/catalog.listPendingCheckoutProductPageBinding",
  );

export const listLinkedPendingCheckoutAliasesBySkuReadDefinition =
  definePosRead(
    "pos/public/catalog:listLinkedPendingCheckoutAliasesBySku",
    "pos/public/catalog.listLinkedPendingCheckoutAliasesBySku",
  );

export const listLinkedPendingCheckoutProvisionalBindingsBySkuReadDefinition =
  definePosRead(
    "pos/public/catalog:listLinkedPendingCheckoutProvisionalBindingsBySku",
    "pos/public/catalog.listLinkedPendingCheckoutProvisionalBindingsBySku",
  );

// --- pos/public/posRecoveryCodes -------------------------------------------

export const getPosRecoveryCodeStatusReadDefinition = definePosRead(
  "pos/public/posRecoveryCodes:getRecoveryCodeStatus",
  "pos/public/posRecoveryCodes.getRecoveryCodeStatus",
);

// --- pos/public/terminals --------------------------------------------------

export const getRegisterLifecycleAuthorityAcknowledgementReadDefinition =
  definePosRead(
    "pos/public/terminals:getRegisterLifecycleAuthorityAcknowledgement",
    "pos/public/terminals.getRegisterLifecycleAuthorityAcknowledgement",
  );

export const previewTerminalRecoveryReadDefinition = definePosRead(
  "pos/public/terminals:previewTerminalRecovery",
  "pos/public/terminals.previewTerminalRecovery",
);

export const getTerminalRuntimeConfigReadDefinition = terminalProofPosRead(
  "pos/public/terminals:getTerminalRuntimeConfig",
  "pos/public/terminals.getTerminalRuntimeConfig",
);

export const getRegisterLifecycleAuthorityShadowReadDefinition =
  terminalProofPosRead(
    "pos/public/terminals:getRegisterLifecycleAuthorityShadow",
    "pos/public/terminals.getRegisterLifecycleAuthorityShadow",
  );

export const getRegisterLifecycleAuthorityReadDefinition = terminalProofPosRead(
  "pos/public/terminals:getRegisterLifecycleAuthority",
  "pos/public/terminals.getRegisterLifecycleAuthority",
);

export const getRuntimeRemoteAssistSessionReadDefinition = terminalProofPosRead(
  "pos/public/terminals:getRuntimeRemoteAssistSession",
  "pos/public/terminals.getRuntimeRemoteAssistSession",
);

export const listTerminalRecoveryCommandsReadDefinition = terminalProofPosRead(
  "pos/public/terminals:listTerminalRecoveryCommands",
  "pos/public/terminals.listTerminalRecoveryCommands",
);

export const POS_READ_DEFINITIONS: readonly OperationReadDefinition[] =
  [
    listPendingCheckoutItemsForReviewReadDefinition,
    listPendingCheckoutProductPageBindingReadDefinition,
    listLinkedPendingCheckoutAliasesBySkuReadDefinition,
    listLinkedPendingCheckoutProvisionalBindingsBySkuReadDefinition,
    getPosRecoveryCodeStatusReadDefinition,
    getRegisterLifecycleAuthorityAcknowledgementReadDefinition,
    previewTerminalRecoveryReadDefinition,
    getTerminalRuntimeConfigReadDefinition,
    getRegisterLifecycleAuthorityShadowReadDefinition,
    getRegisterLifecycleAuthorityReadDefinition,
    getRuntimeRemoteAssistSessionReadDefinition,
    listTerminalRecoveryCommandsReadDefinition,
  ];
