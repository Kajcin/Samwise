// POST /functions/v1/disconnect-calendar  (user JWT required)
// Called from the Settings page. Logic: ./disconnect.ts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { deleteCalendar, refreshAccessToken, revokeToken } from '../_shared/google.ts';
import { corsHeaders, json, requireEnv } from '../_shared/http.ts';
import { disconnectCalendar } from './disconnect.ts';

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

  // Service role: calendar_credentials is closed to clients.
  const db = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const check = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
    if (error) throw new Error(error.message);
    return data;
  };
  const google = { clientId: requireEnv('GOOGLE_CLIENT_ID'), clientSecret: requireEnv('GOOGLE_CLIENT_SECRET') };

  try {
    const result = await disconnectCalendar({
      loadCredentials: async (uid) =>
        check(
          await db.from('calendar_credentials').select('refresh_token, calendar_id').eq('user_id', uid).maybeSingle(),
        ),
      refreshAccessToken: (refreshToken) => refreshAccessToken(refreshToken, google),
      deleteCalendar,
      revokeToken,
      deleteCredentials: async (uid) => {
        check(await db.from('calendar_credentials').delete().eq('user_id', uid));
      },
      clearEventIds: async (uid) => {
        check(
          await db.from('tasks').update({ google_calendar_event_id: null })
            .eq('user_id', uid).not('google_calendar_event_id', 'is', null),
        );
      },
    }, userId);
    return json({ connected: false, calendarDeleted: result.calendarDeleted });
  } catch (error) {
    // Don't echo Google's response bodies to the browser; the details are in the function logs.
    console.error('disconnect-calendar failed:', error instanceof Error ? error.message : error);
    return json({ error: 'disconnect_failed' }, 500);
  }
});
