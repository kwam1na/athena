export function productStockTextClass(quantityAvailable: number | undefined) {
  if ((quantityAvailable ?? 0) <= 0) return "text-danger";
  if ((quantityAvailable ?? 0) <= 2) return "text-warning";
  return "text-success";
}
