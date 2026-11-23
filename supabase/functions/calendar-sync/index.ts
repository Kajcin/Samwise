// POST /functions/v1/calendar-sync  (called by the database, never by the browser)
// The tasks trigger (migration 0007) posts every relevant task change here via pg_net.
// JWT verification is off for this function (config.toml); the shared secret in the
// x-webhook-secret header is the authentication. Logic: ./sync.ts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { deleteEvent, refreshAccessToken, upsertEvent } from '../_shared/google.ts';
import { requireEnv } from '../_shared/http.ts';
import { TASK_EVENT_SELECT, TaskEventRow } from '../_shared/tasks.ts';
import { handleTaskChange, isAuthorizedWebhook, StoredCredentials, WebhookPayload } from './sync.ts';

const text = (body: string, status = 200) => new Response(body, { status });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('method not allowed', 405);
  if (!isAuthorizedWebhook(req.headers.get('x-webhook-secret'), Deno.env.get('CALENDAR_SYNC_WEBHOOK_SECRET'))) {
    return text('unauthorized', 401);
  }
  const payload = await req.json().catch(() => null) as WebhookPayload | null;
  if (!payload?.type || !payload.table) return text('bad request', 400);

  // Service role: calendar_credentials is closed to clients, and this runs for any user.
  const db = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const check = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
    if (error) throw new Error(error.message);
    return data;
  };
  const google = { clientId: requireEnv('GOOGLE_CLIENT_ID'), clientSecret: requireEnv('GOOGLE_CLIENT_SECRET') };

  try {
    const outcome = await handleTaskChange({
      loadCredentials: async (userId) =>
        check(
          await db.from('calendar_credentials')
            .select('refresh_token, access_token, expires_at, calendar_id, disconnected_reason')
            .eq('user_id', userId)
            .maybeSingle(),
        ) as StoredCredentials | null,
      // The refresh-token / calendar-id conditions stop a slow sync from overwriting
      // a connection the user re-made in the meantime.
      saveAccessToken: async (userId, refreshToken, token) => {
        check(await db.from('calendar_credentials').update(token).eq('user_id', userId).eq('refresh_token', refreshToken));
      },
      markRevoked: async (userId, refreshToken) => {
        check(
          await db.from('calendar_credentials')
            .update({ refresh_token: null, access_token: null, expires_at: null, disconnected_reason: 'revoked' })
            .eq('user_id', userId)
            .eq('refresh_token', refreshToken),
        );
      },
      markCalendarDeleted: async (userId, calendarId) => {
        check(
          await db.from('calendar_credentials')
            .update({ disconnected_reason: 'calendar_deleted' })
            .eq('user_id', userId)
            .eq('calendar_id', calendarId),
        );
      },
      loadTask: async (taskId) =>
        check(await db.from('tasks').select(TASK_EVENT_SELECT).eq('id', taskId).maybeSingle()) as unknown as
          | TaskEventRow
          | null,
      setEventId: async (taskId, eventId) => {
        check(await db.from('tasks').update({ google_calendar_event_id: eventId }).eq('id', taskId));
      },
      refreshAccessToken: (refreshToken) => refreshAccessToken(refreshToken, google),
      upsertEvent,
      deleteEvent,
      now: () => new Date(),
    }, payload);
    return text(outcome);
  } catch (error) {
    // Database errors; Google errors are handled (and logged) inside handleTaskChange.
    console.error('calendar-sync failed:', error instanceof Error ? error.message : error);
    return text('error', 500);
  }
});
