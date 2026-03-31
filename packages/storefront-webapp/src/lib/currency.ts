export function toPesewas(ghs: number): number {
  return Math.round(ghs * 100);
}

export function toDisplayAmount(pesewas: number): number {
  return pesewas / 100;
}
