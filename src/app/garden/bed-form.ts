import { Message, msg } from '../core/i18n/i18n';

/** Largest rows/cols value; keeps the grid usable on screen. */
export const MAX_BED_SIZE = 20;

export function validateBedForm(name: string, rows: number | null, cols: number | null): Message | null {
  if (!name.trim()) return msg('bedEditor.errors.nameRequired');
  if (rows == null || cols == null || rows < 1 || cols < 1) return msg('bedEditor.errors.sizeAtLeastOne');
  if (!Number.isInteger(rows) || !Number.isInteger(cols)) return msg('bedEditor.errors.sizeWhole');
  if (rows > MAX_BED_SIZE || cols > MAX_BED_SIZE) return msg('bedEditor.errors.sizeAtMost', { max: MAX_BED_SIZE });
  return null;
}
