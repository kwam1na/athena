import type { PosAddItemInput } from "../dto";
import type { PosCommandGateway } from "../ports";
import { mapCommandResult, mapThrownError } from "../results";

export async function addItem(input: {
  gateway: Pick<PosCommandGateway, "addItem">;
  command: PosAddItemInput;
}) {
  try {
    return mapCommandResult(await input.gateway.addItem(input.command));
  } catch (error) {
    return mapThrownError(error);
  }
}
