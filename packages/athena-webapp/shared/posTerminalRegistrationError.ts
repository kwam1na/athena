export const POS_REGISTER_NUMBER_CONFLICT_KIND =
  "register_number_conflict" as const;

export function isPosRegisterNumberConflict(error: {
  code: string;
  metadata?: Record<string, unknown>;
}) {
  return (
    error.code === "conflict" &&
    error.metadata?.conflictKind === POS_REGISTER_NUMBER_CONFLICT_KIND
  );
}
