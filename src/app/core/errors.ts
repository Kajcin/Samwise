/** Best-effort human-readable message from anything thrown (Error, Supabase PostgrestError, string…). */
export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(e);
}
