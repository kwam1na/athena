import { ok, userError, type CommandResult } from "../../../../shared/commandResult";

export const SUPPORTED_CORRECTION_INTENTS = [
  "opening_float",
  "customer_attribution",
  "payment_method",
] as const;

export const UNSUPPORTED_HIGH_RISK_CORRECTION_INTENTS = [
  "item",
  "quantity",
  "total",
  "discount",
  "inventory",
] as const;

export type SupportedCorrectionIntent =
  (typeof SUPPORTED_CORRECTION_INTENTS)[number];
export type UnsupportedHighRiskCorrectionIntent =
  (typeof UNSUPPORTED_HIGH_RISK_CORRECTION_INTENTS)[number];
export type CorrectionIntent =
  | SupportedCorrectionIntent
  | UnsupportedHighRiskCorrectionIntent
  | (string & {});

export type CorrectionRiskTier =
  | "metadata"
  | "recoverable_drawer_math"
  | "ledger_affecting"
  | "unsupported_high_risk"
  | "unknown";

export type CorrectionAuthorization =
  | "cashier"
  | "staff_auth"
  | "manager_approval"
  | "not_available";

export type RegisterSessionCorrectionStatus =
  | "open"
  | "active"
  | "closing"
  | "closed"
  | "reconciled";

export type CorrectionPolicyDecision = {
  intent: SupportedCorrectionIntent;
  riskTier: Exclude<CorrectionRiskTier, "unsupported_high_risk" | "unknown">;
  authorization: Exclude<CorrectionAuthorization, "not_available">;
  directEditAllowed: boolean;
  auditEventType: `pos.correction.${SupportedCorrectionIntent}`;
  severityRank: number;
};

export type ClassifyCorrectionIntentArgs = {
  intent: CorrectionIntent;
  registerSessionStatus?: RegisterSessionCorrectionStatus;
};

const SUPPORTED_POLICIES: Record<
  SupportedCorrectionIntent,
  Omit<CorrectionPolicyDecision, "intent" | "auditEventType">
> = {
  opening_float: {
    riskTier: "recoverable_drawer_math",
    authorization: "staff_auth",
    directEditAllowed: true,
    severityRank: 2,
  },
  customer_attribution: {
    riskTier: "metadata",
    authorization: "cashier",
    directEditAllowed: true,
    severityRank: 1,
  },
  payment_method: {
    riskTier: "ledger_affecting",
    authorization: "manager_approval",
    directEditAllowed: false,
    severityRank: 3,
  },
};

function isSupportedCorrectionIntent(
  intent: CorrectionIntent
): intent is SupportedCorrectionIntent {
  return SUPPORTED_CORRECTION_INTENTS.includes(
    intent as SupportedCorrectionIntent
  );
}

function isUnsupportedHighRiskCorrectionIntent(
  intent: CorrectionIntent
): intent is UnsupportedHighRiskCorrectionIntent {
  return UNSUPPORTED_HIGH_RISK_CORRECTION_INTENTS.includes(
    intent as UnsupportedHighRiskCorrectionIntent
  );
}

function buildDecision(
  intent: SupportedCorrectionIntent
): CorrectionPolicyDecision {
  return {
    intent,
    auditEventType: `pos.correction.${intent}`,
    ...SUPPORTED_POLICIES[intent],
  };
}

export function classifyCorrectionIntent(
  args: ClassifyCorrectionIntentArgs
): CommandResult<CorrectionPolicyDecision> {
  if (
    args.intent === "opening_float" &&
    args.registerSessionStatus !== undefined &&
    args.registerSessionStatus !== "open" &&
    args.registerSessionStatus !== "active"
  ) {
    return userError({
      code: "precondition_failed",
      title: "Drawer not open",
      message:
        "Drawer not open. Open the drawer before correcting the opening float.",
      retryable: false,
      metadata: {
        intent: args.intent,
        riskTier: "recoverable_drawer_math",
        directEditAllowed: false,
        registerSessionStatus: args.registerSessionStatus,
      },
    });
  }

  if (isSupportedCorrectionIntent(args.intent)) {
    return ok(buildDecision(args.intent));
  }

  if (isUnsupportedHighRiskCorrectionIntent(args.intent)) {
    return userError({
      code: "precondition_failed",
      title: "Correction workflow required",
      message:
        "Correction workflow required. Use the guided correction workflow for item, quantity, total, discount, or inventory changes.",
      retryable: false,
      metadata: {
        intent: args.intent,
        riskTier: "unsupported_high_risk",
        directEditAllowed: false,
      },
    });
  }

  return userError({
    code: "validation_failed",
    title: "Correction unavailable",
    message: "Correction unavailable. Choose a supported correction type.",
    retryable: false,
    metadata: {
      intent: args.intent,
      riskTier: "unknown",
      directEditAllowed: false,
    },
  });
}
