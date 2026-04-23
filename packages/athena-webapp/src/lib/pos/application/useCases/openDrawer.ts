import type { PosOpenDrawerInput } from "../dto";
import type { PosCommandGateway } from "../ports";
import { mapCommandResult, mapThrownError } from "../results";

export async function openDrawer(input: {
  gateway: Pick<PosCommandGateway, "openDrawer">;
  command: PosOpenDrawerInput;
}) {
  try {
    return mapCommandResult(await input.gateway.openDrawer(input.command));
  } catch (error) {
    return mapThrownError(error);
  }
}
