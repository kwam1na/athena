export type InventoryMovement = {
  receiptsQuantity: number | null;
  salesQuantity: number | null;
  returnsQuantity: number | null;
  consumedQuantity: number | null;
  adjustmentsQuantity: number | null;
  commitmentQuantity: number | null;
};

const MOVEMENT_LABELS: Array<[keyof InventoryMovement, string]> = [
  ["receiptsQuantity", "Receipts"],
  ["salesQuantity", "Sales"],
  ["returnsQuantity", "Returns"],
  ["consumedQuantity", "Consumed"],
  ["adjustmentsQuantity", "Adjustments"],
  ["commitmentQuantity", "Committed inbound"],
];

export function InventoryMovementSummary({
  movement,
}: {
  movement: InventoryMovement | null | undefined;
}) {
  return (
    <section aria-labelledby="inventory-movement-heading">
      <h3 className="font-display text-xl" id="inventory-movement-heading">
        Selected-period movement
      </h3>
      {movement ? (
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {MOVEMENT_LABELS.map(([key, label]) => (
            <div className="rounded-md border border-border p-3" key={key}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-numeric text-lg tabular-nums">
                {movement[key] ?? "Unavailable"}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Movement is unavailable for this period.
        </p>
      )}
    </section>
  );
}
