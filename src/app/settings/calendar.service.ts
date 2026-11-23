import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase-client';

/** From the calendar_connection_status RPC; revoked / calendar_deleted mean "reconnect". */
export type CalendarStatus = 'connected' | 'not_connected' | 'revoked' | 'calendar_deleted';

export interface ConnectResult {
  backfilled: number;
  failed: number;
}

export interface DisconnectResult {
  /** False when Samwise had no access left to delete the "Samwise" calendar. */
  calendarDeleted: boolean;
}

/** Thrown by connect()/disconnect(); `code` is the Edge Function's error code (e.g. google_rejected_code). */
export class CalendarError extends Error {
  constructor(readonly code: string) {
    super(`Calendar request failed: ${code}`);
    this.name = 'CalendarError';
  }
}

const STATUSES: readonly CalendarStatus[] = ['connected', 'not_connected', 'revoked', 'calendar_deleted'];

/**
 * Gateway answers meaning the function never ran: not deployed / not served (404),
 * or the gateway couldn't reach it (502-504, e.g. `supabase functions serve` isn't running).
 */
const UNREACHABLE_STATUSES = new Set([404, 502, 503, 504]);

@Injectable({ providedIn: 'root' })
export class CalendarService {
  /** The signed-in user's calendar connection (the credentials themselves stay server-side). */
  async status(): Promise<CalendarStatus> {
    const { data, error } = await supabase.rpc('calendar_connection_status');
    if (error) throw error;
    if (!STATUSES.includes(data)) throw new Error(`Unexpected calendar status: ${data}`);
    return data;
  }

  /** Finishes the OAuth flow: the Edge Function exchanges the code and syncs upcoming tasks. */
  async connect(code: string): Promise<ConnectResult> {
    const data = await this.invoke('connect-calendar', { code }, 'connect_failed');
    return { backfilled: data?.backfilled ?? 0, failed: data?.failed ?? 0 };
  }

  /** Deletes the "Samwise" calendar in Google and forgets the connection. */
  async disconnect(): Promise<DisconnectResult> {
    const data = await this.invoke('disconnect-calendar', {}, 'disconnect_failed');
    return { calendarDeleted: data?.calendarDeleted === true };
  }

  /** Calls an Edge Function; errors become a CalendarError with the function's code, or `unreachable`. */
  private async invoke(name: string, body: object, fallbackCode: string) {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (!error) return data;

    // FunctionsHttpError carries the response; our functions answer { error: '<code>' }.
    const { name: errorName, context } = error as { name?: string; context?: Partial<Response> };
    const response = await context?.json?.().catch(() => null);
    if (typeof response?.error === 'string') throw new CalendarError(response.error);

    // FunctionsFetchError: the request never got an answer (offline, server down).
    // FunctionsRelayError: Supabase's relay couldn't run the function.
    const unreachable =
      errorName === 'FunctionsFetchError' ||
      errorName === 'FunctionsRelayError' ||
      UNREACHABLE_STATUSES.has(context?.status ?? 0);
    throw new CalendarError(unreachable ? 'unreachable' : fallbackCode);
  }
}
