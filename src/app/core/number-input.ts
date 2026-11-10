/** Number-input value → number, or null when the field is empty (unlike `+value`, which gives 0). */
export function parseNumberInput(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}
