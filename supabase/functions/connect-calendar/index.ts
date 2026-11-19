// POST /functions/v1/connect-calendar  { code }  (user JWT required)
// Finishes the Google OAuth flow started on the Settings page. Logic: ./connect.ts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ensureSamwiseCalendar, exchangeCodeForTokens, upsertEvent } from '../_shared/google.ts';
import { corsHeaders, json, requireEnv } from '../_shared/http.ts';
import { TASK_EVENT_SELECT, TaskEventRow } from '../_shared/tasks.ts';
import { connectCalendar } from './connect.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const userClient = createClient(supabaseUrl, requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);
  const userId = userData.user.id;

  const body = await req.json().catch(() => null);
  const code = body?.code;
  if (typeof code !== 'string' || !code) return json({ error: 'missing_code' }, 400);

  // Service role: calendar_credentials is closed to clients, and tasks are updated server-side.
  const db = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const check = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
    if (error) throw new Error(error.message);
    return data;
  };

  try {
    const result = await connectCalendar({
      exchangeCode: (c) =>
        exchangeCodeForTokens(c, {
          clientId: requireEnv('GOOGLE_CLIENT_ID'),
          clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
          redirectUri: requireEnv('GOOGLE_REDIRECT_URI'),
        }),
      getStoredCalendarId: async (uid) =>
        check(await db.from('calendar_credentials').select('calendar_id').eq('user_id', uid).maybeSingle())
          ?.calendar_id ?? null,
      ensureCalendar: ensureSamwiseCalendar,
      saveCredentials: async (credentials) => {
        check(await db.from('calendar_credentials').upsert(credentials));
      },
      clearEventIds: async (uid) => {
        check(await db.from('tasks').update({ google_calendar_event_id: null }).eq('user_id', uid).not('google_calendar_event_id', 'is', null));
      },
      listUnsyncedTasks: async (uid, fromDate) =>
        check(
          await db.from('tasks').select(TASK_EVENT_SELECT)
            .eq('user_id', uid)
            .is('completed_at', null)
            .is('google_calendar_event_id', null)
            .gte('due_date', fromDate)
            .order('due_date'),
        ) as unknown as TaskEventRow[],
      upsertEvent,
      setEventId: async (taskId, eventId) => {
        check(await db.from('tasks').update({ google_calendar_event_id: eventId }).eq('id', taskId));
      },
      today: () => new Date().toISOString().slice(0, 10),
    }, userId, code);
    return json({ connected: true, backfilled: result.backfilled, failed: result.failed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('connect-calendar failed:', message);
    // Don't echo Google's response bodies to the browser; the details are in the function logs.
    const googleRejected = message.startsWith('code exchange');
    return json({ error: googleRejected ? 'google_rejected_code' : 'connect_failed' }, googleRejected ? 400 : 500);
  }
});
