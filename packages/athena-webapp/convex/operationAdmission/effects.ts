import type { OperationEffects } from "./types";

export function declaresProtectedGateway(
  effects: OperationEffects,
  gateway: string,
) {
  return effects.mode === "protected" && effects.gateways.includes(gateway);
}
