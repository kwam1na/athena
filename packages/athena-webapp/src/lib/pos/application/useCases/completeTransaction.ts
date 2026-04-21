import type { PosCompleteTransactionInput } from "../dto";
import type { PosCommandGateway } from "../ports";
import { mapLegacyMutationResult, mapThrownError } from "../results";

export async function completeTransaction(input: {
  gateway: Pick<PosCommandGateway, "completeTransaction">;
  command: PosCompleteTransactionInput;
}) {
  try {
    return mapLegacyMutationResult(
      await input.gateway.completeTransaction(input.command),
    );
  } catch (error) {
    return mapThrownError(error);
  }
}
