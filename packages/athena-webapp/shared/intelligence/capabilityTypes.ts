import { ATHENA_STRUCTURED_TEXT_V1 } from "./providerTypes";
import type { AthenaIntelligenceCapability } from "./providerTypes";

export type AthenaCapabilityDefinition = {
  readonly id: AthenaIntelligenceCapability;
  readonly label: string;
  readonly version: 1;
  readonly outputKind: "json";
};

export const ATHENA_INTELLIGENCE_CAPABILITIES = {
  structuredText: {
    id: ATHENA_STRUCTURED_TEXT_V1,
    label: "Structured text",
    version: 1,
    outputKind: "json",
  },
} as const satisfies Record<string, AthenaCapabilityDefinition>;

export function isAthenaIntelligenceCapability(
  value: string
): value is AthenaIntelligenceCapability {
  return value === ATHENA_STRUCTURED_TEXT_V1;
}

