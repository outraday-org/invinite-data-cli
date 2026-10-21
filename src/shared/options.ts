/** A comma-separated option value → trimmed, de-duplicated, non-empty items. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
}
