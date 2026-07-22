import type { OperationActor } from "./types";

export function isSharedDemoOperationActor(actor: OperationActor) {
  return actor.kind === "shared_demo";
}

export function isNormalUserOperationActor(actor: OperationActor) {
  return actor.kind === "normal_user";
}
