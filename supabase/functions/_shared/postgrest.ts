// Waiting out PostgREST's schema reload.

/** PostgREST's "Could not find a relationship between … in the schema cache". */
export const RELATIONSHIP_NOT_FOUND = 'PGRST200';

interface QueryResult<T> {
  data: T;
  error: { message: string; code?: string } | null;
}

/**
 * Runs a query, and again (up to `attempts` times, waiting longer each time) while
 * PostgREST doesn't know a table link yet. Right after a migration adds one, the API
 * reloads its schema a moment later; calendar webhooks the migration queued can arrive
 * before that (this happened with migration 0019).
 */
export async function withSchemaRetry<T>(
  query: () => PromiseLike<QueryResult<T>>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 4,
): Promise<QueryResult<T>> {
  for (let attempt = 1; ; attempt++) {
    const result = await query();
    if (result.error?.code !== RELATIONSHIP_NOT_FOUND || attempt >= attempts) return result;
    await wait(1000 * attempt);
  }
}
