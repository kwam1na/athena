/**
 * TRANSITIONAL module — retired by U1c.
 *
 * The canonical wrappers live at the composition root
 * (`convex/platform/operationAdmission.ts`). This file exists only so the 134
 * pre-existing call sites keep compiling under their current import path until
 * U1c renames them; it is the reason `publicMutation.ts` appears in the
 * rail-core import-allowlist exemption list, and it is deleted with the legacy
 * names.
 *
 * `withOperationMutationAdmission` is now a thin alias of `admitPublicMutation`
 * with the FULL default adapter chain, so a shared-demo principal is evaluated
 * by the demo adapter on every definition rather than only where the caller
 * remembered to register it.
 */
export {
  admitPublicMutation,
  resolveSharedDemoOperationAdmission,
  withOperationMutationAdmission,
} from "../platform/operationAdmission";
