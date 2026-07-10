import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";

import { api } from "~/convex/_generated/api";

const registerLifecycleAuthorityApi =
  api.pos.public.terminals.getRegisterLifecycleAuthority;
const acknowledgeRegisterLifecycleAuthorityApi =
  api.pos.public.terminals.acknowledgeRegisterLifecycleAuthority;

export type RegisterLifecycleAuthorityQueryArgs = FunctionArgs<
  typeof registerLifecycleAuthorityApi
>;
export type RegisterLifecycleAuthorityQueryCandidate =
  RegisterLifecycleAuthorityQueryArgs["candidates"][number];
export type RegisterLifecycleAuthoritySnapshot = Exclude<
  FunctionReturnType<typeof registerLifecycleAuthorityApi>,
  null
>;
export type RegisterLifecycleAuthorityAcknowledgementArgs = FunctionArgs<
  typeof acknowledgeRegisterLifecycleAuthorityApi
>;

export function useRegisterLifecycleAuthoritySnapshot(
  input: RegisterLifecycleAuthorityQueryArgs | "skip",
): RegisterLifecycleAuthoritySnapshot | null | undefined {
  return useQuery(registerLifecycleAuthorityApi, input);
}

export function useRegisterLifecycleAuthorityAcknowledgement() {
  return useMutation(acknowledgeRegisterLifecycleAuthorityApi);
}
