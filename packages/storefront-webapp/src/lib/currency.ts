export function toPesewas(ghs: number): number {
  return Math.round(ghs * 100);
}

export function toDisplayAmount(pesewas: number): number {
  return pesewas / 100;
}

export function formatStoredAmount(
  formatter: Intl.NumberFormat,
  pesewas: number,
): string {
  return formatter.format(toDisplayAmount(pesewas));
}
