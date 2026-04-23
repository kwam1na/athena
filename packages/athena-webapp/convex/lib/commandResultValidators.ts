import { v } from "convex/values";

export const userErrorValidator = v.object({
  code: v.union(
    v.literal("validation_failed"),
    v.literal("authentication_failed"),
    v.literal("authorization_failed"),
    v.literal("not_found"),
    v.literal("conflict"),
    v.literal("precondition_failed"),
    v.literal("rate_limited"),
    v.literal("unavailable"),
  ),
  title: v.optional(v.string()),
  message: v.string(),
  fields: v.optional(v.record(v.string(), v.array(v.string()))),
  retryable: v.optional(v.boolean()),
  traceId: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.any())),
});

export function commandResultValidator(dataValidator: any) {
  return v.union(
    v.object({
      kind: v.literal("ok"),
      data: dataValidator,
    }),
    v.object({
      kind: v.literal("user_error"),
      error: userErrorValidator,
    }),
  );
}
