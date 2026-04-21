import type { PosStartSessionInput } from "../dto";
import type { PosCommandGateway } from "../ports";
import { mapLegacyMutationResult, mapThrownError } from "../results";

export async function startSession(input: {
  gateway: Pick<PosCommandGateway, "startSession">;
  command: PosStartSessionInput;
}) {
  try {
    return mapLegacyMutationResult(await input.gateway.startSession(input.command));
  } catch (error) {
    return mapThrownError(error);
  }
}
