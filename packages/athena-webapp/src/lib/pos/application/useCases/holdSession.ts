import type { PosHoldSessionInput } from "../dto";
import type { PosCommandGateway } from "../ports";
import { mapCommandResult, mapThrownError } from "../results";

export async function holdSession(input: {
  gateway: Pick<PosCommandGateway, "holdSession">;
  command: PosHoldSessionInput;
}) {
  try {
    return mapCommandResult(await input.gateway.holdSession(input.command));
  } catch (error) {
    return mapThrownError(error);
  }
}
