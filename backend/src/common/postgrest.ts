/** Escape a PostgREST quoted filter value without allowing reserved syntax to escape the value. */
export function postgrestQuotedValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Build a quoted PostgREST ilike operand, including literal wildcard matching. */
export function postgrestIlike(column: string, value: string): string {
  const escaped = postgrestQuotedValue(value).replace(/[%_]/g, '\\$&');
  return `${column}.ilike."*${escaped}*"`;
}
