/** Remove importer prefixes such as "Mã căn:" from names shown to customers and the answer model. */
export function displayListingName(value: string | null | undefined): string {
  return String(value || '').replace(/^\s*mã\s*căn\s*:?\s*/iu, '').trim() || String(value || '').trim();
}
