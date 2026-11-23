import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase-client';
import { FunctionError, invokeFunction } from '../core/edge-functions';

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

  /** Calls an Edge Function; its errors become a CalendarError with the same code. */
  private async invoke(name: string, body: object, fallbackCode: string) {
    try {
      return await invokeFunction(name, body, fallbackCode);
    } catch (e) {
      throw e instanceof FunctionError ? new CalendarError(e.code) : e;
    }
  }
}
