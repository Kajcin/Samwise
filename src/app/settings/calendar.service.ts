import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase-client';

export interface ConnectResult {
  backfilled: number;
  failed: number;
}

/** Thrown by connect(); `code` is the Edge Function's error code (e.g. google_rejected_code). */
export class CalendarConnectError extends Error {
  constructor(readonly code: string) {
    super(`Calendar connect failed: ${code}`);
    this.name = 'CalendarConnectError';
  }
}

@Injectable({ providedIn: 'root' })
export class CalendarService {
  /** Whether the signed-in user has a calendar connection (the credentials themselves stay server-side). */
  async isConnected(): Promise<boolean> {
    const { data, error } = await supabase.rpc('has_calendar_connection');
    if (error) throw error;
    return data === true;
  }

  /** Finishes the OAuth flow: the Edge Function exchanges the code and backfills upcoming tasks. */
  async connect(code: string): Promise<ConnectResult> {
    const { data, error } = await supabase.functions.invoke('connect-calendar', { body: { code } });
    if (error) {
      // FunctionsHttpError carries the function's response; its body is { error: '<code>' }.
      const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
      throw new CalendarConnectError(body?.error ?? 'connect_failed');
    }
    return { backfilled: data?.backfilled ?? 0, failed: data?.failed ?? 0 };
  }
}
