// What calendar-sync does with one tasks-table change, with its I/O injected so it
// can be unit-tested (index.ts wires it up).
import { CalendarGoneError, eventIdForTask, GoogleApiError, InvalidGrantError } from '../_shared/google.ts';
import type { EventTask, Language } from '../_shared/google.ts';
import { TaskEventRow, toEventTask } from '../_shared/tasks.ts';

/** The fields of a tasks row that the webhook payload carries and we look at. */
export interface TaskRecord {
  id: string;
  user_id: string;
  due_date: string;
  task_type: string;
  completed_at: string | null;
  google_calendar_event_id: string | null;
}

/**
 * Body posted by the tasks triggers (migration 0007), shaped like a Supabase database
 * webhook; RESYNC (migration 0009) re-syncs an unchanged task, after a language change.
 */
export interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE' | 'RESYNC';
  table: string;
  record: TaskRecord | null;
  old_record: TaskRecord | null;
}

export interface StoredCredentials {
  /** null once Google revoked access. */
  refresh_token: string | null;
  access_token: string | null;
  expires_at: string | null;
  calendar_id: string;
  /** Set when the connection broke; the user has to reconnect (migration 0008). */
  disconnected_reason: 'revoked' | 'calendar_deleted' | null;
}

export interface AccessToken {
  access_token: string;
  expires_at: string;
}

export interface SyncDeps {
  loadCredentials(userId: string): Promise<StoredCredentials | null>;
  /** Cache a refreshed access token, unless the connection changed meanwhile (other refresh token). */
  saveAccessToken(userId: string, refreshToken: string, token: AccessToken): Promise<void>;
  /** Google rejected the refresh token: forget the tokens, keep the calendar id for reconnecting. */
  markRevoked(userId: string, refreshToken: string): Promise<void>;
  /** The Samwise calendar was deleted in Google: stop syncing until the user reconnects. */
  markCalendarDeleted(userId: string, calendarId: string): Promise<void>;
  /** The user's language for event titles (English if they have none yet). */
  loadLanguage(userId: string): Promise<Language>;
  /** The task as it is now, with its plant and bed; null if it no longer exists. */
  loadTask(taskId: string): Promise<TaskEventRow | null>;
  setEventId(taskId: string, eventId: string): Promise<void>;
  refreshAccessToken(refreshToken: string): Promise<AccessToken>;
  upsertEvent(accessToken: string, calendarId: string, task: EventTask): Promise<string>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
  now(): Date;
}

export type SyncOutcome =
  | 'ignored' // not a tasks change
  | 'not_connected' // the user hasn't connected Google Calendar (or must reconnect)
  | 'no_op' // nothing the calendar shows changed
  | 'task_gone' // the task was deleted before we got to it; its DELETE handles the event
  | 'synced'
  | 'deleted'
  | 'disconnected' // Google revoked access or the calendar was deleted
  | 'failed';

/** Constant-time comparison of the webhook secret header; a missing secret never matches. */
export function isAuthorizedWebhook(header: string | null, secret: string | undefined): boolean {
  if (!secret || header === null || header.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= header.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

/** Whether a change touches what the event shows (writing back the event id doesn't). */
export function shouldSync(oldRecord: TaskRecord | null, newRecord: TaskRecord): boolean {
  if (!oldRecord) return true;
  return oldRecord.due_date !== newRecord.due_date ||
    oldRecord.task_type !== newRecord.task_type ||
    (oldRecord.completed_at ?? null) !== (newRecord.completed_at ?? null);
}

/** Reuse the cached access token unless it expires within this margin. */
const TOKEN_MARGIN_MS = 60_000;

export async function handleTaskChange(deps: SyncDeps, payload: WebhookPayload): Promise<SyncOutcome> {
  const changed = payload.record ?? payload.old_record;
  if (payload.table !== 'tasks' || !changed) return 'ignored';
  if (payload.type === 'UPDATE' && !shouldSync(payload.old_record, payload.record!)) return 'no_op';

  const userId = changed.user_id;
  const credentials = await deps.loadCredentials(userId);
  if (!credentials?.refresh_token || credentials.disconnected_reason) return 'not_connected';
  const refreshToken = credentials.refresh_token;

  const freshToken = async (): Promise<string> => {
    const token = await deps.refreshAccessToken(refreshToken);
    await deps.saveAccessToken(userId, refreshToken, token);
    return token.access_token;
  };
  /** Runs `call` with the cached token, or a fresh one if it's expiring or Google rejects it. */
  const withAccessToken = async <T>(call: (accessToken: string) => Promise<T>): Promise<T> => {
    const cached = credentials.access_token && credentials.expires_at &&
        Date.parse(credentials.expires_at) - deps.now().getTime() > TOKEN_MARGIN_MS
      ? credentials.access_token
      : null;
    if (!cached) return call(await freshToken());
    try {
      return await call(cached);
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 401) return call(await freshToken());
      throw e;
    }
  };

  try {
    if (payload.type === 'DELETE') {
      const old = payload.old_record!;
      // No stored id yet (an insert still being synced) still has a predictable one.
      const eventId = old.google_calendar_event_id ?? eventIdForTask(old.id);
      await withAccessToken((token) => deps.deleteEvent(token, credentials.calendar_id, eventId));
      return 'deleted';
    }

    // Sync the task as it is now, not as the payload saw it: webhooks can arrive
    // out of order, and the payload lacks the plant and bed names.
    const task = await deps.loadTask(changed.id);
    if (!task) return 'task_gone';
    const event = toEventTask(task, await deps.loadLanguage(userId));
    const eventId = await withAccessToken((token) => deps.upsertEvent(token, credentials.calendar_id, event));
    if (eventId !== task.google_calendar_event_id) await deps.setEventId(task.id, eventId);
    return 'synced';
  } catch (e) {
    if (e instanceof InvalidGrantError) {
      await deps.markRevoked(userId, refreshToken);
      return 'disconnected';
    }
    if (e instanceof CalendarGoneError) {
      await deps.markCalendarDeleted(userId, credentials.calendar_id);
      return 'disconnected';
    }
    console.error(`calendar-sync failed for task ${changed.id}:`, e instanceof Error ? e.message : e);
    return 'failed';
  }
}
