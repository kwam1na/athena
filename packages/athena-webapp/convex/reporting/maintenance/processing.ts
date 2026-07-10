export type ProcessableRow = { id: string; recordedAt: number };

export function processBoundedBatch(input: {
  batchSize: number;
  cursor: string | null;
  frozenCutoff: number;
  rows: ProcessableRow[];
  status: "running" | "paused" | "cancelled";
}) {
  if (input.status !== "running") {
    return {
      nextCursor: input.cursor,
      processedRows: [] as ProcessableRow[],
      scheduleNext: false,
    };
  }
  if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1) {
    throw new Error("batch size must be a positive safe integer");
  }
  const eligible = input.rows.filter(
    (row) =>
      row.recordedAt <= input.frozenCutoff &&
      (input.cursor === null || row.id > input.cursor),
  );
  const processedRows = eligible.slice(0, input.batchSize);
  return {
    nextCursor: processedRows.at(-1)?.id ?? input.cursor,
    processedRows,
    scheduleNext: eligible.length > processedRows.length,
  };
}
