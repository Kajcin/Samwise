// The connect flow, with its I/O injected so it can be unit-tested (index.ts wires it up).
import type { EventTask } from '../_shared/google.ts';
import { TaskEventRow, toEventTask } from '../_shared/tasks.ts';

export interface Tokens {
  refresh_token: string;
  access_token: string;
  expires_at: string;
}

export interface Credentials extends Tokens {
  user_id: string;
  calendar_id: string;
  /** Always null here: connecting (again) repairs a broken connection. */
  disconnected_reason: null;
}

export interface ConnectDeps {
  exchangeCode(code: string): Promise<Tokens>;
  getStoredCalendarId(userId: string): Promise<string | null>;
  ensureCalendar(accessToken: string, existingCalendarId: string | null): Promise<string>;
  saveCredentials(credentials: Credentials): Promise<void>;
  /** Forget all of the user's event ids (they point into a calendar that's no longer used). */
  clearEventIds(userId: string): Promise<void>;
  /**
   * Tasks due on or after `fromDate` that belong on the calendar: unfinished ones, and
   * finished ones that already have an event (so it shows them as done).
   */
  listTasksToSync(userId: string, fromDate: string): Promise<TaskEventRow[]>;
  upsertEvent(accessToken: string, calendarId: string, task: EventTask): Promise<string>;
  setEventId(taskId: string, eventId: string): Promise<void>;
  /** Today as YYYY-MM-DD (UTC, like the database's current_date). */
  today(): string;
}

export interface ConnectResult {
  calendarId: string;
  backfilled: number;
  failed: number;
}

/**
 * Exchanges the OAuth code, finds or creates the Samwise calendar, stores the
 * credentials, and puts every upcoming task on the calendar.
 */
export async function connectCalendar(deps: ConnectDeps, userId: string, code: string): Promise<ConnectResult> {
  const tokens = await deps.exchangeCode(code);
  const storedCalendarId = await deps.getStoredCalendarId(userId);
  const calendarId = await deps.ensureCalendar(tokens.access_token, storedCalendarId);

  // A different calendar than before: any stored event ids point into the old
  // (deleted or abandoned) one, and the backfill below only picks up tasks
  // without an event id.
  if (calendarId !== storedCalendarId) await deps.clearEventIds(userId);

  await deps.saveCredentials({ user_id: userId, ...tokens, calendar_id: calendarId, disconnected_reason: null });

  // Tasks created before connecting never reached the calendar, and after a broken
  // connection the existing events may be out of date, so upsert every upcoming
  // task (event ids derive from task ids, so this never duplicates an event).
  // Writing the event id back doesn't fire the tasks webhook (migration 0007).
  let backfilled = 0;
  let failed = 0;
  for (const row of await deps.listTasksToSync(userId, deps.today())) {
    try {
      const eventId = await deps.upsertEvent(tokens.access_token, calendarId, toEventTask(row));
      if (eventId !== row.google_calendar_event_id) await deps.setEventId(row.id, eventId);
      backfilled++;
    } catch (error) {
      failed++;
      console.error(`backfill failed for task ${row.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return { calendarId, backfilled, failed };
}
