/**
 * Minor/major currency-unit conversion. Browser-safe and dependency-free so
 * the web app and Convex share one definition of the boundary. Convex code
 * should keep importing this through `convex/lib/currency`, which re-exports
 * it.
 */

/**
 * Convert a major currency unit (GHS/USD) to minor unit (pesewas/cents).
 * Use at data-entry boundaries only.
 */
export function toPesewas(ghs: number): number {
  return Math.round(ghs * 100);
}

/**
 * Convert minor unit (pesewas/cents) to major unit for display.
 * Use at display boundaries only.
 */
export function toDisplayAmount(pesewas: number): number {
  return pesewas / 100;
}
