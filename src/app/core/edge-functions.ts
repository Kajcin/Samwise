import { supabase } from './supabase-client';

/** An Edge Function call failed; `code` is the function's error code, or `unreachable`. */
export class FunctionError extends Error {
  constructor(readonly code: string) {
    super(`Edge Function request failed: ${code}`);
    this.name = 'FunctionError';
  }
}

/**
 * Gateway answers meaning the function never ran: not deployed / not served (404),
 * or the gateway couldn't reach it (502-504, e.g. `supabase functions serve` isn't running).
 */
const UNREACHABLE_STATUSES = new Set([404, 502, 503, 504]);

/**
 * Calls one of Samwise's Edge Functions (signed in: supabase-js sends the user's JWT).
 * Errors become a FunctionError with the function's own code ({ error: '<code>' }),
 * `unreachable` when no function answered, or `fallbackCode`.
 */
export async function invokeFunction<T = any>(name: string, body: object, fallbackCode: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data as T;

  const { name: errorName, context } = error as { name?: string; context?: Partial<Response> };
  const response = await context?.json?.().catch(() => null);
  if (typeof response?.error === 'string') throw new FunctionError(response.error);

  // FunctionsFetchError: the request never got an answer (offline, server down).
  // FunctionsRelayError: Supabase's relay couldn't run the function.
  const unreachable =
    errorName === 'FunctionsFetchError' ||
    errorName === 'FunctionsRelayError' ||
    UNREACHABLE_STATUSES.has(context?.status ?? 0);
  throw new FunctionError(unreachable ? 'unreachable' : fallbackCode);
}
