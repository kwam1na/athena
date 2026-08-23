import type { Id, TableNames } from "../_generated/dataModel";

/**
 * Builds a branded Convex document id from a readable literal so fixtures can
 * keep saying `"schedule-1"` instead of scattering `as Id<...>` casts at every
 * construction site. The table name is checked against the generated data
 * model, so a typo in the table — or handing the value to a field of a
 * different table's id type — still fails to compile.
 *
 * The string value is passed through verbatim, so fixtures that assert on the
 * id they supplied keep asserting the same thing.
 *
 * Test-only: real ids come from Convex, never from this helper.
 */
export function testId<Table extends TableNames>(
  _table: Table,
  value: string,
): Id<Table> {
  return value as unknown as Id<Table>;
}
