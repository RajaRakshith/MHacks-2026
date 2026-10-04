/**
 * SQL option<string> for nessie_transfer_id.
 * Named: { some: id } / { none: [] }. Positional SATS: [0, id] / [1, []].
 */
export function hasStoredTransferId(value: unknown): boolean {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) {
    if (value[0] !== 0) return false;
    const id = value[1];
    return id != null && id !== '';
  }
  if (typeof value === 'object') {
    if ('none' in value) return false;
    if ('some' in value) {
      const id = (value as { some: unknown }).some;
      return id != null && id !== '';
    }
  }
  return true;
}
